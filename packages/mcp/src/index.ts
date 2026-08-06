/**
 * @secretsminter/mcp — the agent-facing MCP server (two-tier isolation, docs/adrs/0009).
 *
 * This tier holds NO master keys. It validates requests and asks @secretsminter/core (the Broker) to act;
 * a fully compromised MCP layer can only *request* within the core's policy. Build a server with
 * {@link createServer} and start it by connecting a transport (stdio in production, an in-memory
 * transport in tests).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Broker } from "@secretsminter/core";
import { createServer } from "./server.js";

export { createServer } from "./server.js";
export { TOOLS, TOOL_NAMES, type ToolSpec, type ToolMutation } from "./tools.js";

/** Build the MCP server for a broker and serve it over stdio (blocks). Used by the daemon. */
export async function serveStdio(broker: Broker): Promise<void> {
  const server = createServer(broker);
  await server.connect(new StdioServerTransport());
}
