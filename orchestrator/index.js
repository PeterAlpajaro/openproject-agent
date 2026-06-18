import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || "http://localhost:3000/mcp";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL || "http://localhost:8000";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514";
const PORT = Number(process.env.PORT) || 4000;

// Agent loop / memory tuning
const MAX_AGENT_ITERATIONS = Number(process.env.MAX_AGENT_ITERATIONS) || 10;
const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES) || 40;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 60 * 60 * 1000; // 1 hour

const SYSTEM_PROMPT =
  "You are a helpful project management assistant. You have access to tools that can create tasks in OpenProject. " +
  "When the user asks you to create a task, use the available tools. Always confirm what you did after completing an action. " +
  "You remember the current conversation, so you can refer back to tasks and details mentioned earlier.";

if (!ANTHROPIC_API_KEY) {
  console.error("[error] ANTHROPIC_API_KEY is required. Exiting.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Conversation Memory — in-memory session store
// ---------------------------------------------------------------------------
// Map<sessionId, { messages: Anthropic.MessageParam[], lastAccess: number }>
const sessions = new Map();

function getSession(sessionId) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { messages: [], lastAccess: Date.now() };
    sessions.set(sessionId, session);
  }
  session.lastAccess = Date.now();
  return session;
}

// Keep the conversation from growing without bound. We trim from the front,
// but never start the retained history on an "assistant"/tool turn, since the
// Anthropic API requires tool_use and tool_result blocks to stay paired.
function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) return messages;

  let start = messages.length - MAX_HISTORY_MESSAGES;
  while (start < messages.length && messages[start].role !== "user") {
    start++;
  }
  // Also avoid starting on a user turn that only carries tool_result blocks.
  while (
    start < messages.length &&
    Array.isArray(messages[start].content) &&
    messages[start].content.some((b) => b.type === "tool_result")
  ) {
    start++;
  }
  return messages.slice(start);
}

// Periodically evict idle sessions so memory doesn't leak.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// MCP Client Setup
// ---------------------------------------------------------------------------
let mcpClient = null;

async function connectMcp() {
  const client = new Client({
    name: "orchestrator-client",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL));

  await client.connect(transport);
  console.log(`[mcp] Connected to MCP server at ${MCP_SERVER_URL}`);

  mcpClient = client;
  return client;
}

// ---------------------------------------------------------------------------
// Anthropic Client
// ---------------------------------------------------------------------------
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
  baseURL: ANTHROPIC_BASE_URL,
});

// ---------------------------------------------------------------------------
// Helper: Map MCP tool definitions to Anthropic tool schema
// ---------------------------------------------------------------------------
function mapMcpToolsToAnthropic(mcpTools) {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  }));
}

// ---------------------------------------------------------------------------
// Agent loop — keeps calling the model and executing tools until the model
// produces a final answer (stop_reason !== "tool_use") or we hit the cap.
// `messages` is mutated in place so the full turn (including tool calls) is
// persisted into the session history.
// ---------------------------------------------------------------------------
async function runAgentLoop(messages, anthropicTools) {
  let finalText = "";

  for (let i = 0; i < MAX_AGENT_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
      tools: anthropicTools,
    });

    console.log(`[agent] Iteration ${i + 1} — stop_reason: ${response.stop_reason}`);

    // Record the assistant's turn in the conversation.
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      // The model is done — extract its final text and exit the loop.
      finalText = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      return finalText;
    }

    // Otherwise, execute every requested tool and feed the results back.
    const toolUseBlocks = response.content.filter((block) => block.type === "tool_use");
    const toolResults = [];

    for (const toolUse of toolUseBlocks) {
      console.log(`[agent] Calling MCP tool: ${toolUse.name} with args:`, JSON.stringify(toolUse.input));

      try {
        const mcpResult = await mcpClient.callTool({
          name: toolUse.name,
          arguments: toolUse.input,
        });

        const resultText = mcpResult.content
          .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
          .join("\n");

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultText,
          is_error: mcpResult.isError ?? false,
        });

        console.log(`[agent] Tool result for ${toolUse.name}: ${resultText}`);
      } catch (err) {
        const errText = `Tool execution failed: ${err?.message || String(err)}`;
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: errText,
          is_error: true,
        });
        console.error(`[agent] ${errText}`);
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Safety cap reached without a natural stop.
  console.warn(`[agent] Hit MAX_AGENT_ITERATIONS (${MAX_AGENT_ITERATIONS}).`);
  return (
    finalText ||
    "I wasn't able to finish that within the allowed number of steps. Could you rephrase or break it into smaller requests?"
  );
}

// ---------------------------------------------------------------------------
// Express App
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    mcpConnected: mcpClient !== null,
    model: CLAUDE_MODEL,
    activeSessions: sessions.size,
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat — Main orchestration endpoint (agentic + conversational)
// ---------------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { message, sessionId: rawSessionId } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Request body must include a 'message' string." });
  }

  if (!mcpClient) {
    return res.status(503).json({ error: "MCP client is not connected. Try again shortly." });
  }

  // Use the provided session id, or mint a new one so the client can keep
  // sending it on subsequent turns to preserve conversation memory.
  const sessionId = typeof rawSessionId === "string" && rawSessionId ? rawSessionId : randomUUID();
  const session = getSession(sessionId);

  // Append the new user message to this session's running history.
  session.messages.push({ role: "user", content: message });

  try {
    // Discover tools from the MCP server.
    const { tools: mcpTools } = await mcpClient.listTools();
    const anthropicTools = mapMcpToolsToAnthropic(mcpTools);

    console.log(
      `[chat] session=${sessionId} history=${session.messages.length} tools=${anthropicTools
        .map((t) => t.name)
        .join(", ")}`
    );

    // Run the agent loop against the full conversation history.
    const reply = await runAgentLoop(session.messages, anthropicTools);

    // Trim and persist the updated history for next time.
    session.messages = trimHistory(session.messages);

    return res.json({ reply, sessionId });
  } catch (err) {
    console.error("[chat] Error:", err);
    // Roll back the user message we optimistically appended so a failed turn
    // doesn't poison the conversation history.
    session.messages.pop();
    return res.status(500).json({
      error: "An error occurred during processing.",
      details: err?.message || String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/chat/:sessionId — clear a conversation's memory
// ---------------------------------------------------------------------------
app.delete("/api/chat/:sessionId", (req, res) => {
  const existed = sessions.delete(req.params.sessionId);
  res.json({ cleared: existed });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function start() {
  try {
    await connectMcp();
  } catch (err) {
    console.error(`[mcp] Failed to connect to MCP server: ${err.message}`);
    console.error("[mcp] The orchestrator will start, but /api/chat will fail until MCP is available.");
  }

  app.listen(PORT, () => {
    console.log(`Orchestrator listening on port ${PORT}`);
    console.log(`  Health:  GET  http://localhost:${PORT}/health`);
    console.log(`  Chat:    POST http://localhost:${PORT}/api/chat`);
    console.log(`  MCP target:      ${MCP_SERVER_URL}`);
    console.log(`  LLM target:      ${ANTHROPIC_BASE_URL}`);
    console.log(`  Model:           ${CLAUDE_MODEL}`);
    console.log(`  Agent max iterations: ${MAX_AGENT_ITERATIONS}`);
  });
}

start();
