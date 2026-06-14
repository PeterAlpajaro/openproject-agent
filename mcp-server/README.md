# OpenProject MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes a single tool, `create_kanban_task`, allowing an LLM to create a Kanban
task (Work Package) in an external OpenProject instance.

Built with Express + the `@modelcontextprotocol/sdk` Streamable HTTP transport so
it is reachable over an internal Docker network port (no stdio).

## Endpoints

| Method        | Path      | Purpose                                      |
| ------------- | --------- | -------------------------------------------- |
| `GET`         | `/health` | Health check, returns `{"status":"ok"}`      |
| `POST`        | `/mcp`    | MCP client → server messages (JSON-RPC)      |
| `GET`         | `/mcp`    | Server → client SSE notification stream      |
| `DELETE`      | `/mcp`    | Terminate an MCP session                     |

## Environment variables

| Variable                | Default                  | Description                                            |
| ----------------------- | ------------------------ | ------------------------------------------------------ |
| `OPENPROJECT_URL`       | `http://openproject:80`  | Base URL of the OpenProject instance                   |
| `OPENPROJECT_API_TOKEN` | _(required)_             | API token; used as Basic Auth password (`apikey:<token>`) |
| `PORT`                  | `3000`                   | Port the server listens on                             |

Copy `.env.example` to `.env` and fill in your token for local runs.

## Run locally

```bash
npm install
OPENPROJECT_URL=http://localhost:8080 \
OPENPROJECT_API_TOKEN=your-token \
npm start
```

## Run with Docker

```bash
docker build -t openproject-mcp-server .
docker run --rm -p 3000:3000 \
  -e OPENPROJECT_URL=http://openproject:80 \
  -e OPENPROJECT_API_TOKEN=your-token \
  openproject-mcp-server
```

## Verify

1. Health check:

   ```bash
   curl http://localhost:3000/health
   # {"status":"ok"}
   ```

2. Open the MCP Inspector:

   ```bash
   npx @modelcontextprotocol/inspector http://localhost:3000/mcp
   ```

   In the UI (http://localhost:5173) choose **Streamable HTTP** transport, connect,
   open **Tools**, select `create_kanban_task`, fill in the arguments
   (`project_name`, `user_id`, `subject`, `description`) and **Run Tool**.
