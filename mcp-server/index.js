import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// Configuration (pulled from the environment)
// ---------------------------------------------------------------------------
const OPENPROJECT_URL = process.env.OPENPROJECT_URL || "http://openproject:80";
const OPENPROJECT_API_TOKEN = process.env.OPENPROJECT_API_TOKEN;
const PORT = Number(process.env.PORT) || 3000;

if (!OPENPROJECT_API_TOKEN) {
  console.warn(
    "[warn] OPENPROJECT_API_TOKEN is not set. Tool calls to OpenProject will fail until it is provided."
  );
}

// HTTP Basic Auth: username "apikey", password is the API token.
const authHeader =
  "Basic " +
  Buffer.from(`apikey:${OPENPROJECT_API_TOKEN ?? ""}`).toString("base64");

// ---------------------------------------------------------------------------
// Tool logic: create a Work Package (Kanban task) in OpenProject
// ---------------------------------------------------------------------------
async function createKanbanTask({ project_name, user_id, subject, description }) {
  const endpoint = `${OPENPROJECT_URL}/api/v3/work_packages`;

  // OpenProject HAL+JSON payload.
  const payload = {
    subject,
    description: {
      format: "markdown",
      raw: description,
    },
    _links: {
      project: { href: `/api/v3/projects/${project_name}` },
      assignee: { href: `/api/v3/users/${user_id}` },
      type: { href: "/api/v3/types/1" },
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      const apiMessage =
        data?.message ||
        data?._embedded?.errors?.map((e) => e.message).join("; ") ||
        text ||
        "Unknown error";
      return {
        isError: true,
        message: `OpenProject returned ${response.status} ${response.statusText}: ${apiMessage}`,
      };
    }

    const taskId = data.id;
    const taskHref = data?._links?.self?.href;
    return {
      isError: false,
      message: `Successfully created Work Package #${taskId} "${data.subject ?? subject}" in project "${project_name}".${
        taskHref ? ` (${taskHref})` : ""
      }`,
    };
  } catch (err) {
    return {
      isError: true,
      message: `Failed to reach OpenProject at ${endpoint}: ${err?.message ?? String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// MCP server factory — registers the create_kanban_task tool
// ---------------------------------------------------------------------------
function createMcpServer() {
  const server = new McpServer({
    name: "openproject-mcp-server",
    version: "1.0.0",
  });

  server.tool(
    "create_kanban_task",
    "Create a Kanban task (Work Package) in the external OpenProject instance.",
    {
      project_name: z
        .string()
        .describe("The project identifier/slug, e.g. 'bci-vr-console'."),
      user_id: z
        .number()
        .describe("The numeric ID of the user to assign the task to."),
      subject: z.string().describe("The title of the task."),
      description: z
        .string()
        .describe("The task description (Markdown supported)."),
    },
    async (args) => {
      const result = await createKanbanTask(args);
      return {
        isError: result.isError,
        content: [{ type: "text", text: result.message }],
      };
    }
  );

  return server;
}

// ---------------------------------------------------------------------------
// Express + Streamable HTTP transport
// ---------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

// Standard REST health check.
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Map of active transports keyed by MCP session id.
const transports = {};

// Client -> server messages (and the initial initialize request).
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  let transport;

  if (sessionId && transports[sessionId]) {
    // Reuse an existing session.
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    // New initialization request — create a fresh transport + server.
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        delete transports[transport.sessionId];
      }
    };

    const server = createMcpServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: No valid session ID provided.",
      },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

// Server -> client notifications (SSE stream) and session termination.
const handleSessionRequest = async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
};

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

app.listen(PORT, () => {
  console.log(`OpenProject MCP server listening on port ${PORT}`);
  console.log(`  Health:   GET  http://localhost:${PORT}/health`);
  console.log(`  MCP:      POST http://localhost:${PORT}/mcp`);
  console.log(`  OpenProject target: ${OPENPROJECT_URL}`);
});
