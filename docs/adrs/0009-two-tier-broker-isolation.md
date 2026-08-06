---
Status: Accepted
Date: 2026-07-29
---

# 0009 — Two-tier broker isolation

## Context

secretsminter's bootstrap credentials are its crown jewels: a Cloudflare token-mint token, a GitHub App private key, a Supabase Personal Access Token. Any one of them can mint or place live secrets across a real multi-service deployment the author operates.

If a single process holds all of them **and** is the surface the AI agent talks to over MCP, that process becomes a **higher-value target than any individual secret it manages.** The agent-facing surface is also the most exposed one — it parses model-influenced input and is the natural landing spot for prompt injection (OWASP LLM01) or, worst case, remote code execution. Concentrating the master keys in the same process that is most likely to be compromised is backwards.

The IETF draft **CB4A** (`draft-hartman-credential-broker-4-agents`) frames exactly this: a *credential broker* should be separated from the *agent* it serves, so that compromising the agent side does not hand over the broker's authority.

## Decision

Split the system into two tiers with a policy boundary between them:

1. **The agent-facing MCP server (`@secretsminter/mcp`) holds NO master keys.** It exposes the narrow, pre-defined tools (`plan`, `status`, `mint_and_place`, `rotate`, `revoke`), validates input, and forwards *requests* to the core. It cannot mint anything itself because it has nothing to mint with.

2. **The internal minting core (`@secretsminter/core`) holds the keys and independently re-enforces policy.** It does not trust the MCP tier. On every request it re-runs the destination allow-list against the signed manifest (`assertAllowed`, ADR-0008), the `NEVER_ROTATE` name/class checks and self-lockout guard (ADR-0010), out-of-band approval binding, and rate limits — as if the caller were hostile.

The intended property: a **compromised MCP tier can only *request actions within the core's policy.*** It cannot mint freely, cannot place outside the allow-list, and cannot rotate a protected credential, because the tier that *can* do those things re-checks every one of them and never delegates the check upward.

**Honest status (2026-08-05):** in v1 both tiers ship in a **single process** (the `daemon` composition root), so the boundary between them is a **module boundary, not a process/trust boundary.** That is enough to contain a **prompt-injected agent** — it can only invoke the registered tools, and every one of them transits the core's gates. It is **NOT** enough to contain **code-execution/RCE of the MCP tier**, because in one process the attacker already sits alongside the keys. The RCE-containment property above is therefore the *target* of this ADR, realized only once the core runs in its **own process/Worker** (see the "Consequences" note below and the follow-up story). Until then, do not read this ADR as claiming RCE resistance.

This mirrors the CB4A broker/agent separation and is the structural answer to crown-jewel concentration.

## Consequences

- The blast radius of an MCP-tier compromise is bounded to "what the manifest already permits" — the same envelope a well-behaved agent operates in. Compromise buys the attacker nothing the honest path did not already allow.
- Policy is enforced **twice** (thin tier as an early filter, core as the authority). Duplication is deliberate: the core's copy is the one that counts and never assumes the front tier ran.
- Two deployable units instead of one: more moving parts and an internal transport to secure. Accepted — the alternative concentrates all authority behind the most-attacked surface.
- The core's own transport and host must be hardened separately (egress allow-list, ADR-0006); this ADR isolates the keys but does not by itself firewall the core.
- v1 ships both tiers self-hosted; the boundary is designed so the core can later move behind a Worker/Durable Object without the MCP tier gaining key custody.
