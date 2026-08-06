---
Story: 0012
Status: DONE 2026-07-31 (Dockerfile build not yet validated on a Docker host)
---

# 0012 — Deployable: Dockerfile + operator README

**DONE 2026-07-31.** Makes secretsminter genuinely "point an AI at the repo and stand up your own Docker
MCP." Built:

- **`Dockerfile`** — multi-stage (build the workspace → slim `node:20-slim` runtime running the
  `secretsminter` daemon). Contains **no secrets**; bootstraps injected at runtime. Runs as non-root, with
  a volume mount point for durable state.
- **`docker-compose.yml`** — one-command always-on service (`docker compose up -d`), state on a named
  volume, `restart: unless-stopped`, `SECRETSMINTER_SERVE=loop`.
- **`.dockerignore`** — excludes `node_modules`/`dist`/`.env`/`.git`/CI.
- **README refresh** — a **"Run your own secretsminter (Docker)"** operator front door: configure `.env`,
  `docker compose up -d`, and an MCP-client config snippet (`docker run -i --rm --env-file .env
  secretsminter`). Status table updated to the real state (loop closed, all 3 providers, CF live-verified).
- **Daemon keep-alive** — `InProcessScheduler` gained a `keepAlive` option; the daemon's rotation loop
  uses it so a persistent container **stays up** even with no MCP client attached. The CLI gained a
  `SECRETSMINTER_SERVE=loop|stdio` mode and serves MCP best-effort (a stdio failure never stops the loop).
  Tested.

**Honest caveat:** Docker is not available in the build environment, so the **image build itself has
not been run here** — the Dockerfile is standard but unvalidated. Follow-up: `docker build` + a smoke
`docker run` on a host with Docker before relying on it.

## Interface note
The container serves MCP over **stdio** (agent launches it) and runs the rotation loop persistently. A
**network (HTTP) MCP transport** for a fully-remote always-on MCP is the roadmap item (ADR-0013) that
would let a remote agent reach an always-on daemon without launching it.
