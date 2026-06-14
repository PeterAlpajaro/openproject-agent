# OpenProject AI Agent

A microservices architecture that connects a conversational AI (Claude) to an OpenProject instance via an MCP server, enabling natural-language task management. A floating React chat widget is injected directly into the OpenProject UI by an Nginx reverse proxy, so users can chat with the assistant without leaving their project board.

## Architecture

```
                    ┌──────────────────────────────────────────────┐
   Browser  ───────▶│                 Nginx  :8080                  │
                    │  /            → OpenProject (widget injected)  │
                    │  /widget/     → compiled React assets          │
                    │  /llm-api/    → Orchestrator                   │
                    └───────┬───────────────────────┬───────────────┘
                            │                        │
                            ▼                        ▼
                    ┌─────────────┐          ┌──────────────┐     ┌──────────────┐     ┌─────────────┐
                    │ OpenProject │          │ Orchestrator │────▶│  MCP Server  │────▶│ OpenProject │
                    │  web:8080   │          │  :4000       │     │  :3000       │     │   API       │
                    └─────────────┘          └──────┬───────┘     └──────────────┘     └─────────────┘
                                                    │
                                                    ▼
                                             ┌──────────────┐     ┌──────────────┐
                                             │ Kiro Gateway │────▶│  Claude API  │
                                             │  :8000       │     │  (via AWS)   │
                                             └──────────────┘     └──────────────┘
```

| Service | Port | Description |
|---------|------|-------------|
| Nginx | 8080 (host) | Reverse proxy. Serves OpenProject, injects the chat widget, routes API calls |
| OpenProject | web:8080 (internal) | Project management UI and API (not exposed to host directly) |
| MCP Server | 3000 | Exposes OpenProject tools via Model Context Protocol |
| Orchestrator | 4000 | Bridges user messages → Claude → MCP tool calls |
| Kiro Gateway | 8000 | Proxies Anthropic-shaped requests through Kiro/AWS credentials |

### How the widget injection works

Nginx proxies all `/` traffic to OpenProject and uses `sub_filter` to inject a `<link>` and `<script>` tag for the compiled React widget right before the closing `</body>` tag. The widget is built into static `widget.js` / `widget.css` files (no content hashing) and served from `/widget/`. When the user sends a message, the widget POSTs to `/llm-api/chat`, which Nginx routes to the orchestrator's `/api/chat`.

## Prerequisites

- Docker & Docker Compose (v2+)
- A Kiro account (free tier works) — either via [Kiro IDE](https://kiro.dev/) or [kiro-cli](https://kiro.dev/cli/)
- The Kiro auth token file on the host machine
- A running OpenProject stack (see "OpenProject Setup" below)

---

## OpenProject Setup

This project assumes you have a separate OpenProject docker-compose stack running on the same machine, connected to a shared Docker network named `openproject_backend`. The MCP server and Nginx both join that network to reach OpenProject internally at `web:8080`.

**Important — port and hostname:** Because Nginx now sits in front of OpenProject and owns host port `8080`, OpenProject itself should **not** bind to host port `8080`. In OpenProject's own `.env`, change the host binding so it only listens internally:

```env
# OpenProject .env
PORT=127.0.0.1:8082        # was 127.0.0.1:8080 — free up 8080 for Nginx
OPENPROJECT_HOST__NAME=localhost:8080   # the hostname users access via Nginx
```

OpenProject validates the incoming `Host` header against `OPENPROJECT_HOST__NAME`. Nginx forwards the browser's full `Host` header (including the port) using `$http_host`, so as long as you reach the app at `localhost:8080` the hostnames match and there's no "Invalid host_name" warning.

OpenProject stays reachable on the Docker network at `web:8080` for the MCP server and Nginx regardless of the host binding.

---

## Local Development Setup (Mac/Linux)

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd openproject-agent
```

### 2. Authenticate with Kiro

Log in through Kiro IDE (just open it and sign in), or use the CLI:

```bash
kiro-cli login
```

Verify your credentials exist:

```bash
# Auth token (created by Kiro login)
ls ~/.aws/sso/cache/kiro-auth-token.json

# Profile ARN (find it here on Mac)
cat ~/Library/Application\ Support/Kiro/User/globalStorage/kiro.kiroagent/profile.json
```

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENPROJECT_API_TOKEN=your_openproject_api_token
ANTHROPIC_API_KEY=my_local_dev_key
PROFILE_ARN=arn:aws:codewhisperer:us-east-1:ACCOUNT_ID:profile/PROFILE_ID
CLAUDE_MODEL=claude-sonnet-4-20250514
```

> `ANTHROPIC_API_KEY` is just a passphrase you make up — it must match `PROXY_API_KEY` in the gateway. The docker-compose wires this automatically.

### 4. Start the stack

```bash
docker compose up --build
```

This single command also builds the React widget. The `nginx/Dockerfile` is a multi-stage build: it compiles the frontend with Node, then bakes the static assets and Nginx config into the final image. You do **not** need to run `npm run build` yourself or mount a `dist/` folder.

### 5. Open the app

Navigate to **http://localhost:8080**. You should see your normal OpenProject UI with a floating chat bubble in the bottom-right corner. Click it, type a request, and the assistant will create tasks for you.

### 6. (Optional) Test the API directly

```bash
curl -X POST http://localhost:8080/llm-api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Create a task in the test-llm-interface project called Phase 4 Test, assign it to user ID 5."
  }'
```

---

## Frontend Development

The widget lives in `frontend/` (React + Vite). For fast iteration on the UI alone:

```bash
cd frontend
npm install
npm run dev      # Vite dev server with hot reload
```

Build configuration notes:

- `vite.config.js` disables asset hashing so the output is always `widget.js` and `widget.css` — predictable filenames that Nginx's `sub_filter` injection and `/widget/` route depend on.
- The widget mounts itself into a `#llm-chat-widget` div, creating one on the fly if it doesn't already exist. This lets it run both standalone (Vite dev) and injected into OpenProject's DOM.
- API calls use the relative path `/llm-api/chat`, so they work behind Nginx without any CORS configuration or hardcoded hostnames.

When you change frontend code for the full stack, rebuild the Nginx image:

```bash
docker compose up nginx --build -d
```

> **Node version note:** The project pins Vite 5 + React 18, which build cleanly on Node 20.18. Newer Vite (8.x) requires Node 20.19+, so stick with the pinned versions unless you upgrade Node.

---

## Cloud Deployment (Oracle Cloud / Any VPS)

### 1. Provision a server

- Ubuntu 22.04+ or any Linux with Docker support
- Minimum 2 CPU / 4 GB RAM (OpenProject is the heaviest service)
- Open port: 8080 (Nginx — the only public entry point)
- Keep 3000, 4000, and 8000 internal to Docker; they don't need host exposure in production

### 2. Install Docker

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
sudo usermod -aG docker $USER
# Log out and back in for group to take effect
```

### 3. Clone the project

```bash
git clone <your-repo-url>
cd openproject-agent
```

### 4. Transfer Kiro credentials to the server

On your local Mac, copy the auth token to the server:

```bash
# From your Mac:
scp ~/.aws/sso/cache/kiro-auth-token.json user@your-server:/home/user/.aws/sso/cache/kiro-auth-token.json
```

On the server, make sure the directory exists:

```bash
mkdir -p ~/.aws/sso/cache
# The scp above places the file there
```

### 5. Configure environment

```bash
cp .env.example .env
nano .env
```

Fill in the same values as local, plus a real production secret:

```env
OPENPROJECT_API_TOKEN=your_openproject_api_token
ANTHROPIC_API_KEY=my_local_dev_key
PROFILE_ARN=arn:aws:codewhisperer:us-east-1:ACCOUNT_ID:profile/PROFILE_ID
CLAUDE_MODEL=claude-sonnet-4-20250514
OPENPROJECT_SECRET_KEY_BASE=a_long_random_string_for_production
```

> **Important:** Generate a real secret for `OPENPROJECT_SECRET_KEY_BASE` in production:
> ```bash
> openssl rand -hex 64
> ```

### 6. Reproducibility — why local matches cloud

The deployment is identical across environments because every service builds from a pinned Dockerfile and committed `package-lock.json`. The only thing that differs between local and cloud is environment variable values, not code. The same `docker compose up --build` builds the frontend, bakes it into Nginx, and starts the whole stack everywhere.

For a production hardening pass, consider:
- Pinning base images more tightly (e.g. `node:20.18-alpine3.19` instead of `node:20-alpine`)
- Replacing `kiro-gateway` with a direct Anthropic API key (`ANTHROPIC_BASE_URL=https://api.anthropic.com`) if you don't need the Kiro proxy
- Putting Nginx behind a load balancer that terminates TLS

### 7. Start the stack

```bash
docker compose up -d --build
```

Check logs:

```bash
docker compose logs -f
```

### 8. Verify

```bash
# End-to-end test through Nginx
curl -X POST http://localhost:8080/llm-api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a task called Cloud Deploy Test in my-project, assign to user 5."}'

# Widget assets are being served
curl -I http://localhost:8080/widget/widget.js
curl -I http://localhost:8080/widget/widget.css
```

Then open `http://your-server:8080` in a browser to confirm the widget appears in OpenProject.

---

## Token Refresh

Kiro auth tokens expire. When they do:

**Locally:** Just open Kiro IDE or run `kiro-cli login` again. The token file refreshes automatically.

**On the cloud:** You'll need to re-authenticate locally and `scp` the fresh token file to the server:

```bash
# On your Mac after re-auth:
scp ~/.aws/sso/cache/kiro-auth-token.json user@your-server:/home/user/.aws/sso/cache/kiro-auth-token.json
```

Then restart the gateway:

```bash
docker compose restart kiro-gateway
```

> The gateway handles token refresh internally as long as the refresh token in the file is still valid. You typically only need to re-copy when the refresh token itself expires (varies by account type).

---

## Environment Variables Reference

| Variable | Used By | Description |
|----------|---------|-------------|
| `OPENPROJECT_API_TOKEN` | mcp-server | API token from OpenProject admin panel |
| `ANTHROPIC_API_KEY` | orchestrator, kiro-gateway | Shared passphrase between orchestrator and gateway |
| `PROFILE_ARN` | kiro-gateway | AWS profile ARN from your Kiro account |
| `CLAUDE_MODEL` | orchestrator | Which Claude model to use |
| `OPENPROJECT_SECRET_KEY_BASE` | openproject | Rails secret key (use a random string in production) |

---

## Project Structure

```
openproject-agent/
├── docker-compose.yml          # Full stack orchestration
├── .env.example                # Template for environment variables
├── README.md                   # This file
├── mcp-server/                 # Phase 2: MCP server exposing OpenProject tools
│   ├── index.js
│   ├── Dockerfile
│   └── package.json
├── orchestrator/               # Phase 3: LLM orchestration backend
│   ├── index.js
│   ├── Dockerfile
│   └── package.json
├── frontend/                   # Phase 4: React + Vite chat widget
│   ├── src/
│   │   ├── ChatWidget.jsx      # Floating chat UI component
│   │   ├── main.jsx            # Mounts the widget into #llm-chat-widget
│   │   └── widget.css          # Widget styling
│   ├── index.html
│   ├── vite.config.js          # Predictable output: widget.js / widget.css
│   └── package.json
└── nginx/                      # Phase 4: Reverse proxy + widget injection
    ├── default.conf            # Routing, sub_filter injection
    └── Dockerfile              # Multi-stage: builds frontend + bakes into Nginx
```

---

## Troubleshooting

**Port 8080 already allocated:**
- OpenProject's own stack is probably still binding 8080. Change `PORT=127.0.0.1:8082` (or remove the host binding) in OpenProject's `.env`, then restart it. Nginx owns host port 8080 now.

**"Invalid host_name configuration" warning in OpenProject:**
- This means the `Host` header Nginx forwards doesn't match `OPENPROJECT_HOST__NAME`. The proxy uses `$http_host` (which keeps the port) rather than `$host` (which strips it). Confirm you're accessing the app at the same host:port set in `OPENPROJECT_HOST__NAME` (`localhost:8080`).

**"host not found in upstream" when Nginx starts:**
- Nginx can't resolve the OpenProject container. The upstream is `web:8080` (OpenProject's service name on the `openproject_backend` network), not `openproject`. Make sure both stacks share that external network.

**Widget doesn't appear in OpenProject:**
- Check the assets load: `curl -I http://localhost:8080/widget/widget.js` should return 200.
- OpenProject may be gzipping HTML. The config sends `proxy_set_header Accept-Encoding ""` so `sub_filter` can match the uncompressed `</body>` — confirm that line is present.
- `sub_filter_once on;` means only the first `</body>` is replaced; that's intentional.

**Widget loads but messages do nothing / empty reply:**
- Check the orchestrator logs: `docker compose logs orchestrator`. A successful run logs the discovered tools, the tool call args, and the tool result.
- Make sure you typed a non-empty message — an empty submit returns a 400.

**Gateway returns 401/403:**
- Check that `ANTHROPIC_API_KEY` in `.env` matches what the orchestrator sends (they share the same variable)
- Verify `~/.aws/sso/cache/kiro-auth-token.json` exists and is mounted correctly

**MCP connection fails on orchestrator startup:**
- The orchestrator will still start — it retries on each request
- Make sure the mcp-server container is healthy: `docker compose logs mcp-server`

**OpenProject returns 401 on tool calls:**
- Regenerate the API token in OpenProject (Administration → API → Generate)
- Update `OPENPROJECT_API_TOKEN` in `.env` and restart: `docker compose restart mcp-server`

**"Name or service not known" from gateway:**
- If you're in a region with restricted AWS access, add `VPN_PROXY_URL` to the gateway environment
- See the [kiro-gateway docs](https://github.com/jwadow/kiro-gateway#-vpnproxy-support)

---

## Security Notes for Production

- Never commit your `.env` file (it's in `.gitignore`)
- In production only Nginx (8080) needs host exposure — keep 3000, 4000, and 8000 internal to the Docker network via a firewall
- Put Nginx behind HTTPS (a load balancer or nginx + Let's Encrypt) before exposing it publicly
- The `ANTHROPIC_API_KEY` is just a local passphrase — it never leaves your network
- Kiro credentials are mounted read-only into the gateway container
