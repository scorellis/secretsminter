---
Story: 0002
Status: DONE 2026-07-30
---

# 0002 — MCP live serving

**DONE 2026-07-30.** `createServer(broker)` (`packages/mcp/src/server.ts`) builds a live MCP server over
`@modelcontextprotocol/sdk`, registering all six tools wired to the `Broker`; `secretsminter-mcp` serves on
stdio (demo mode). An in-memory-transport integration test proves the client lists the tools, read-only
tools work, `mint_and_place` succeeds end-to-end with no value on the wire, and refusals propagate with
safe reason codes. Depends on the real out-of-band approval channel (0007) for production use.

## Goal
Wire the defined tool catalog (`packages/mcp/src/tools.ts`) to a live MCP server that delegates to a
`@secretsminter/core` client — the agent-facing tier that holds **no master keys** (ADR-0009).

## Tasks
- Add `@modelcontextprotocol/sdk`; implement `createServer()` (currently throws) over stdio transport.
- Register the six tools; enforce `plan`/`status` as read-only and `plan` as the default dry run.
- Route mutating tools to the core over the two-tier boundary; never hold keys in this process.
- Require the out-of-band, action-hash-bound approval (story 0007) before any mutating call executes.
- Ensure every tool response is produced by `whitelistSerialize` — no other return path.

## Done when
- A local MCP client can call `list_secrets`/`status`/`plan` and receives value-free results.
- A mutating call with no approval is refused; with a valid approval it reaches the core.
- No tool exposes the kill switch or approval mechanism.
