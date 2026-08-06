---
Story: 0014
Status: active — NOT BUILT
---

# 0014 — Split the core into its own process (real two-tier trust boundary)

**NOT BUILT.** Today the agent-facing MCP tier (`@secretsminter/mcp`) and the key-holding core
(`@secretsminter/core`) ship in a **single process** (the `daemon` composition root). That is a **module
boundary, not a process/trust boundary**: it contains a prompt-injected agent (which can only invoke
tools that transit the core's gates) but does NOT contain code-execution/RCE of the MCP tier, which runs
alongside the keys. ADR-0009 describes the intended property; this story makes it real.

## Goal
Run the minting core in its **own process (or a Cloudflare Worker / Durable Object)**, with the MCP tier
talking to it over a narrow, authenticated internal transport. A compromised MCP process must not have
in-memory access to the bootstrap credentials, and must be able to *request* only the pre-defined
actions the core re-validates.

## Tasks
- Define the internal transport (local socket / HTTP over loopback / Worker binding) and its message
  schema (the same request shapes the broker methods take today).
- Move bootstrap-credential custody entirely into the core process; the MCP process holds none.
- Authenticate the internal channel so a third party on the host can't impersonate the MCP tier.
- Keep the core's independent re-enforcement of allow-list / approval / NEVER_ROTATE (unchanged).
- Update ADR-0009 and the README from "module boundary" to the achieved boundary.

## Done when
- The MCP tier runs in a process with no access to bootstrap credentials, and an RCE of that process
  cannot mint/place/rotate beyond what the manifest already permits.
- An integration test drives `mint_and_place` across the process boundary and proves the MCP process
  memory never holds a bootstrap key.
