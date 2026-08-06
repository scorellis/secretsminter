# 0005 — Approval and kill switch are out-of-band and agent-unreachable

Status: Accepted
Date: 2026-07-29

## Context

Two controls stand between an agent's request and a live mint: **approval** (a human confirms a high-privilege action) and the **kill switch** (an operator halts all minting). Both are worthless if the agent can reach them. secretsminter is deliberately exposed to a possibly prompt-injected agent (OWASP LLM01). If approval were an MCP tool, an injected agent would call it to self-approve; if the kill switch were a tool or a readable token, the same agent would disable it before exfiltrating. A control the adversary can operate is not a control. The threat here is Excessive Agency (LLM08): the agent must not be able to expand its own authority.

## Decision

Neither approval nor the kill switch is an MCP tool. The tool catalog (`packages/mcp/src/tools.ts`) exposes only `list_secrets`, `status`, `plan`, `mint_and_place`, `rotate`, `revoke` — and every mutating tool defaults to a dry run (`defaultsToDryRun: true`); `apply:true` alone does nothing.

**Approval** is a human confirm on a separate channel, and:

- **Action-hash-bound.** An approval authorizes exactly one action, identified by a hash over `provider + action + destination + scope`. It cannot be replayed for a different action — approving a rotation of secret A never authorizes placing a token into repo B.
- **Expiring.** Approvals have a bounded lifetime; a stale approval is not honored.
- **Default-deny for unknown destinations.** An action whose destination is not in the signed allow-list (ADR-0008) is refused before approval is even solicited.

**The kill switch** is an env/file/admin-endpoint with **separate authentication**, and:

- **Fail-closed.** If the kill-state cannot be read, the core refuses to mint. Unavailability is treated as "stopped," never "go."
- **Halts the scheduler too.** It stops the rotation loop, not just interactive calls, so an engaged kill switch cannot be worked around by a background tick.
- **Not agent-resettable.** Only an operator on the separate channel can clear it.

## Consequences

The residual attack surface for privilege escalation collapses to "who holds the out-of-band channel" — a human, by construction, not the agent. An injected agent can *request* but never *approve* or *silence*. The cost is friction: high-privilege actions block on a human confirm, and a misconfigured/unreadable kill-state fails safe by stopping all minting (an availability trade the design accepts deliberately). This pairs with ADR-0009's two-tier isolation: even a fully compromised MCP tier can only ask the core, and the core still demands an out-of-band, action-hash-bound approval it cannot forge.
