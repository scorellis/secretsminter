/**
 * The live MCP server (story 0002).
 *
 * The agent-facing tier (docs/adrs/0009). It holds NO keys: each tool handler simply validates its
 * arguments and calls the injected {@link Broker}, which is where allow-list, approval, NEVER_ROTATE,
 * and value-blindness are enforced. Every response carries only the broker's value-blind result plus a
 * safe reason code — never a secret value.
 *
 * Note what is deliberately absent: there is no tool for the kill switch or approval, and no tool
 * accepts a secret value. Mint-only, dry-run-first.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Broker, MintAndPlaceRequest } from "@secretsminter/core";
import { z } from "zod";

const SERVER_INFO = { name: "secretsminter", version: "0.1.0" } as const;

const placeTargetShape = {
  store: z.enum(["github-actions", "cloudflare-pages", "file"]),
  repo: z.string().optional(),
  project: z.string().optional(),
  environment: z.string().optional(),
  name: z.string(),
};

const secretClassEnum = z.enum([
  "api-token",
  "ephemeral-cred",
  "jwt-signing-key",
  "app-secret",
  "updater-signing-key",
]);

const mintShape = {
  provider: z.enum(["cloudflare", "github", "supabase", "local"]),
  name: z.string(),
  secretClass: secretClassEnum,
  target: z.object(placeTargetShape),
  scopes: z.array(z.string()).optional(),
};

function text(value: unknown, isError: boolean) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }], isError };
}

/**
 * Build an MCP server wired to a broker. `server.connect(transport)` starts it (stdio in production,
 * an in-memory transport in tests).
 */
export function createServer(broker: Broker): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "list_secrets",
    { description: "Inventory of managed secrets (names, providers, destinations) — never values." },
    async () => text({ secrets: broker.listSecrets() }, false),
  );

  server.registerTool(
    "status",
    { description: "Count + inventory of managed secrets. Read-only." },
    async () => text(broker.status(), false),
  );

  server.registerTool(
    "plan",
    {
      description: "Dry-run: what a mint+place would do, checked against the signed allow-list. No mutation.",
      inputSchema: mintShape,
    },
    async (args) => text(broker.plan(args as unknown as MintAndPlaceRequest), false),
  );

  server.registerTool(
    "mint_and_place",
    {
      description: "Mint a fresh secret and place it at an allow-listed destination. Requires approval.",
      inputSchema: mintShape,
    },
    async (args) => {
      const res = await broker.mintAndPlace(args as unknown as MintAndPlaceRequest);
      return text({ ...res.toolResult, reason: res.reason }, !res.toolResult.ok);
    },
  );

  server.registerTool(
    "rotate",
    {
      description: "Rotate a managed secret by id (mint → place → verify → revoke). Refuses NEVER_ROTATE.",
      inputSchema: { secretId: z.string() },
    },
    async (args) => {
      const res = await broker.rotate(args.secretId);
      return text({ ...res.toolResult, reason: res.reason }, !res.toolResult.ok);
    },
  );

  server.registerTool(
    "revoke",
    {
      description: "Revoke a managed secret by id. Refuses NEVER_ROTATE and broker dependencies.",
      inputSchema: { secretId: z.string() },
    },
    async (args) => {
      const res = await broker.revoke(args.secretId);
      return text({ ...res.toolResult, reason: res.reason }, !res.toolResult.ok);
    },
  );

  return server;
}
