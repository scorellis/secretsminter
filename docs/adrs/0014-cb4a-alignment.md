---
Status: Accepted
Date: 2026-07-31
---

# 0014 — Align with the CB4A IETF draft (credential broker for agents)

## Context

secretsminter is a community security tool, and its core architecture — a broker that mediates an AI
agent's access to credentials — is exactly the problem the IETF draft **`draft-hartman-credential-
broker-4-agents`** (CB4A, "Credential Broker for Agents") sets out to standardize. That draft
formalizes a model in which an **agent never holds long-lived credentials**; instead a **broker**
issues short-lived, scoped credentials on the agent's behalf, so the agent's authority is bounded,
mediated by policy, and auditable.

Aligning with an emerging standard, rather than inventing private vocabulary, buys three things for a
community project: **credibility** (reviewers can map secretsminter onto a known model), a **shared
vocabulary** (broker, agent, mediated credential issuance), and a **north star** for future interop.

## Decision

**Align secretsminter's architecture and documentation with the CB4A broker/agent separation model**, and
cite the draft in `SECURITY.md` and the README. The alignment is concrete, not cosmetic — it is how the
existing decisions already map:

- **Agent holds no long-lived authority.** The agent-facing MCP tier holds no master keys; the
  key-holding broker core is separate (ADR-0009, two-tier isolation). This is CB4A's central tenet.
- **The broker issues short-lived, scoped credentials.** Ephemeral-first (ADR-0012): R2 Temporary
  Credentials and GitHub App installation tokens are minted with a TTL and self-expire — the broker
  mediates issuance rather than handing over standing authority.
- **Mediation is policy-bounded and auditable.** The destination allow-list + signed manifest
  (ADR-0008), out-of-band approval + kill switch (ADR-0005), and the hash-chained audit (ADR-0011)
  provide exactly the policy-mediation and auditability CB4A calls for.
- **Value-blindness** (ADR-0001) is an additional guarantee beyond the draft: the broker returns *no*
  credential value to the agent at all.

**Scope of the claim:** secretsminter aligns with CB4A in **architecture and spirit** for v1. It does
**not** claim conformance to any CB4A wire protocol — the draft is evolving, and a conformant transport
is future work, not a v1 gate. Docs must say "aligned with," never "conformant to."

## Consequences

- Reviewers and adopters can place secretsminter on a recognized map; the design reads as principled
  rather than ad hoc.
- A future CB4A-conformant transport has a clear home (alongside the planned Cloudflare Worker
  transport, ADR-0013) without reworking the core.
- Cost: the draft may change; we track it and update this ADR if the model shifts. Because we claim
  alignment (not conformance), draft churn does not break a promise we made.
- Honesty guard: never advertise conformance. Alignment is the accurate, defensible claim.
