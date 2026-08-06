#!/usr/bin/env node
/**
 * `secretsminter-mcp` — starts the MCP server on stdio.
 *
 * Demo / no-config mode: this entry builds a broker with an EMPTY allow-list, a deny-all approval gate,
 * and NO providers. The server genuinely runs and exposes the full tool surface, but every mutating
 * action is refused by policy — because nothing has been configured yet. Wiring a signed manifest, an
 * approval channel, and live providers is stories 0006 / 0007 / 0003-0005. This is honest: it serves,
 * and it refuses, exactly as designed.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Broker, DenyAllGate, type Manifest } from "@secretsminter/core";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const manifest: Manifest = { version: 1, allow: [] };
  const broker = new Broker({
    manifest,
    providers: new Map(),
    stores: new Map(),
    approvals: new DenyAllGate(),
  });
  const server = createServer(broker);
  // stdout is the MCP protocol channel — every human-readable line goes to stderr only.
  process.stderr.write(
    "secretsminter MCP serving on stdio — demo mode (empty allow-list, deny-all, no providers). " +
      "Mutating actions are refused until configured.\n",
  );
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`secretsminter MCP failed to start: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
