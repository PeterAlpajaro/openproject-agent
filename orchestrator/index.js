import "dotenv/config";
import express from "express";
import cors from "cors";
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

if (!ANTHROPIC_API_KEY) {
  console.error("[error] ANTHROPIC_API_KEY is required. Exiting.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// MCP Client Setup
// ---------------------------------------------------------------------------
let mcpClient = null;

async function connectMcp() {
  const client = new Client({
    name: "orchestrator-client",
    version: "1.0.0",
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_SERVER_URL)
  );

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
  });
});

// ---------------------------------------------------------------------------
// POST /api/chat — Main orchestration endpoint
// ---------------------------------------------------------------------------
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Request body must include a 'message' string." });
  }

  if (!mcpClient) {
    return res.status(503).json({ error: "MCP client is not connected. Try again shortly." });
  }

  try {
    // Step 1: Discover tools from MCP server
    const { tools: mcpTools } = await mcpClient.listTools();
    const anthropicTools = mapMcpToolsToAnthropic(mcpTools);

    console.log(`[chat] Discovered ${anthropicTools.length} tool(s): ${anthropicTools.map((t) => t.name).join(", ")}`);

    // Build the initial conversation
    const messages = [{ role: "user", content: message }];

    // Step 2: First LLM call with tool definitions
    const firstResponse = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: "You are a helpful project management assistant. You have access to tools that can create tasks in OpenProject. When the user asks you to create a task, use the available tools. Always confirm what you did after completing an action.",
      messages,
      tools: anthropicTools,
    });

    console.log(`[chat] First LLM response — stop_reason: ${firstResponse.stop_reason}`);

    // Step 3: Handle tool use if requested
    if (firstResponse.stop_reason === "tool_use") {
      // Extract all tool_use blocks
      const toolUseBlocks = firstResponse.content.filter((block) => block.type === "tool_use");

      // Append assistant response to conversation
      messages.push({ role: "assistant", content: firstResponse.content });

      // Execute each tool call via MCP and collect results
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        console.log(`[chat] Calling MCP tool: ${toolUse.name} with args:`, JSON.stringify(toolUse.input));

        const mcpResult = await mcpClient.callTool({
          name: toolUse.name,
          arguments: toolUse.input,
        });

        // Flatten the MCP content array into a string
        const resultText = mcpResult.content
          .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
          .join("\n");

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultText,
        });

        console.log(`[chat] Tool result for ${toolUse.name}: ${resultText}`);
      }

      // Append tool results to conversation
      messages.push({ role: "user", content: toolResults });

      // Step 4: Second LLM call with tool results
      const secondResponse = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: "You are a helpful project management assistant. You have access to tools that can create tasks in OpenProject. When the user asks you to create a task, use the available tools. Always confirm what you did after completing an action.",
        messages,
        tools: anthropicTools,
      });

      // Step 5: Return the final text response
      const finalText = secondResponse.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");

      return res.json({ reply: finalText });
    }

    // No tool use — return the direct text response
    const directText = firstResponse.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    return res.json({ reply: directText });
  } catch (err) {
    console.error("[chat] Error:", err);
    return res.status(500).json({
      error: "An error occurred during processing.",
      details: err?.message || String(err),
    });
  }
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
  });
}

start();
