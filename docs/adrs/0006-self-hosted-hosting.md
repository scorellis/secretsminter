# 0006 — v1 is self-hosted, behind an egress allow-list

Status: Accepted
Date: 2026-07-29

## Context

secretsminter's core holds the master credentials for every provider it manages: a Cloudflare token-minting token, a GitHub App private key, a Supabase Personal Access Token. This makes the broker a higher-value target than any single secret it manages. Where that core runs is therefore a security decision, not an operations convenience. A hosted/multi-tenant deployment would put these master keys on a third party's infrastructure, expanding the trust boundary to include that provider's operators, tenancy isolation, and breach exposure. It would also make the crown-jewel custody guidance (NIST SP 800-57) something we assert about someone else's system rather than control directly.

Separately, the provider plugins pin their outbound hosts as fixed constants to prevent SSRF — but code-level constants are only as trustworthy as the running process. A prompt-injected or RCE'd process could, in principle, attempt an outbound connection the constants did not intend. Defense should not end at the code.

## Decision

v1 ships as a **self-hostable service/container** that the operator runs on infrastructure they control. The master keys never leave that boundary, are sourced from host env or a secret manager, and are never written to disk or logs.

Around it, require an **egress allow-list / firewall**: the host permits outbound connections only to the specific provider API hosts the broker legitimately needs (Cloudflare, GitHub, Supabase). This is defense *beyond* the code-level fixed-host constants — a network control the compromised process cannot rewrite — aligning with NIST SP 800-207 zero-trust (verify every flow; deny by default at the network, not only in application logic). A process that is talked into reaching an attacker host is stopped at the firewall even if it got past the code.

Design the **transport to be deployment-agnostic** so a future **Cloudflare Worker + Durable Object** deployment is possible (the Durable Object also being the natural home for the rotation scheduler and its alarm-based clock). v1 does not depend on that; it is left as a forward-compatible seam, not a v1 capability.

## Consequences

Master-key custody stays entirely within the operator's control — the strongest posture for a tool of this kind, and the one that lets us make the SECURITY.md crown-jewel claims truthfully. The cost is operational: the operator runs and hardens the container and configures the egress firewall themselves; there is no turnkey hosted option in v1. The two-tier split (ADR-0009) still applies within the self-hosted deployment — the agent-facing MCP tier holds no master keys even though everything runs on the operator's own infrastructure. The Worker/Durable-Object path remains open for a later, more managed offering without a transport rewrite.
