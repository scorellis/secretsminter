# secretsminter — your own value-blind secrets broker, as a container.
# Multi-stage: build the workspace, then a slim runtime that runs the daemon.
# The image contains NO secrets — bootstraps are injected at runtime (env / secret manager).

# ---- build ----
FROM node:20-slim AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build && npm prune --omit=dev

# ---- runtime ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
# Copy the built workspace (dist + production node_modules). Value-free; no secrets.
COPY --from=builder /app .
# Durable, value-free state (mount a volume here in production).
RUN mkdir -p /var/lib/secretsminter && chown -R node:node /var/lib/secretsminter /app
USER node
ENV SECRETSMINTER_STATE=/var/lib/secretsminter/state.json
# Rotation loop + MCP over stdio. Set SECRETSMINTER_SERVE=loop for a loop-only persistent service,
# or run `docker run -i ... ` so an MCP client can attach over stdio.
CMD ["node", "packages/daemon/dist/cli.js"]
