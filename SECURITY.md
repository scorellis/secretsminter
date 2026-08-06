# Security model & threat model

secretsminter mints and places **live cloud credentials** on behalf of an AI agent. This document is the
threat model it is built against. It is written to be attacked — if you find a gap, see
[`AI_REVIEW.md`](AI_REVIEW.md) for how to report it.

## Reporting a vulnerability

For a sensitive finding (value exfiltration, allow-list bypass, kill-switch defeat, authority
escalation), use GitHub's **private security advisory** ("Report a vulnerability") on this repository
rather than a public issue, so a fix can land before the detail is public. Non-sensitive concerns can
be normal issues.

## The core reframing

**Value-blindness prevents the agent from *reading* a secret. It does nothing to prevent the agent
from *directing* a live secret to an attacker.** A prompt-injected agent that mints a token and places
it into a destination it controls has exfiltrated a working credential without ever seeing its value.

Therefore the trust root of secretsminter is **not** "the agent never sees values." It is:

- the **server-side destination allow-list**, declared in a **signed, agent-un-writable manifest**
  (the control for OWASP LLM08, Excessive Agency), plus
- a **module boundary** between the agent-facing tool layer and the key-holding core. Note: today both
  run in **one process**, so this is a module boundary — it contains a prompt-injected agent (which can
  only invoke the registered tools, all of which transit the core's gates), but it is **not** a process
  boundary against code-execution/RCE of the MCP tier. A real process split is roadmap (story 0014); see
  **Known limitations (v1)** below.

Value-blindness (OWASP LLM06) is a necessary second layer, not the model.

## Threats (OWASP LLM Top 10 mapping)

- **LLM01 — Prompt injection.** The assumed default: a poisoned issue, document, or tool result steers
  an agent holding `mint_and_place` / `rotate` / `revoke`. Every control below assumes the agent is
  adversarial.
- **LLM06 — Sensitive-information disclosure.** Addressed by value-blindness as a mechanism (below).
- **LLM08 — Excessive agency.** The dangerous one. Addressed by the destination allow-list + signed
  manifest + out-of-band approval. This is the trust root. (Rate-limiting / a circuit breaker is
  roadmap — story 0016; see Known limitations.)
- **Crown-jewel concentration.** The broker holds a Cloudflare token-mint credential, a GitHub App
  private key, and a Supabase Personal Access Token — making it a higher-value target than any single
  secret it manages. Addressed by least privilege + out-of-band custody of the bootstraps (env, never in
  the managed registry). A full process boundary — real two-tier isolation — is roadmap (story 0014; see
  Known limitations).

## Controls, prioritized

**P0 — required before any live mint/place path is enabled:**

1. **Value-blindness as a mechanism** — positive-whitelist serialization at the tool boundary
   (`whitelistSerialize`), a secret-scrubber on every error/log path (`scrub`/`scrubError`),
   stdin-only secret transit, mint-only (no caller-supplied values), fingerprint-only audit.
2. **Server-side destination allow-list** enforced in the core against the signed manifest
   (`assertAllowed`, strict default-deny). Without it, `mint+place` is a general-purpose exfiltration
   primitive.
3. **Out-of-band, agent-unreachable kill switch + approval** — action-hash-bound, fail-closed,
   default-deny. Never exposed as MCP tools.
4. **`NEVER_ROTATE` by name AND class** at the core (`assertRotatable`); broker/bootstrap creds
   self-excluded (`assertNotSelfLockout`).

**P1:**

5. **Two-tier isolation** — the agent-facing MCP server holds no master keys; the internal core
   enforces policy.
6. **Verify-before-revoke** as a functional health check + a **dual-credential overlap window** + a
   server-enforced minimum rotation interval.
7. **Rate limits / circuit breaker** on all mutating tools.
8. **Hash-chained, external, value-free audit** + out-of-band alerting on high-privilege mints.
9. **Mint-only v1**; signed/pinned, agent-un-writable manifest.

**P2:**

10. Egress firewall beyond the code-level fixed-host constants.
11. Reconciliation/drift alerting (a token that exists at a provider but not in the manifest signals an
    out-of-band mint or compromise).
12. Least-privilege scoping + out-of-band rotation of each provider master credential.

## Crown-jewel inventory

These are the ultimate agent-un-rotatable credentials. They are sourced from the host environment or a
secret manager, never on disk, never logged, and rotated out-of-band by a human/hardware path:

- **Cloudflare** — the token-mint credential (parent scope `User → API Tokens → Edit`), least-privileged
  to create R2 tokens for allow-listed buckets only.
- **GitHub** — the App private key (installation tokens are derived from it), the App installed only on
  allow-listed repos.
- **Supabase** — the Management API Personal Access Token, scoped to a single project.

> **Operator note — your editor can leak these even though the broker won't.** Bootstrap creds placed in
> a local `.env` are gitignored, but `.gitignore` does not stop an AI-enabled IDE from injecting the
> file (or a save-time diff) into an assistant's transcript. Before editing a real `.env`, block it at
> the agent layer (deny-list `.env`/`*.key`/`*.pem`), or keep the values off disk entirely. See
> [`AI_REVIEW.md`](AI_REVIEW.md) → "A trap to avoid" for the specifics and a ready-made deny-list.

## Known limitations (v1)

These are the honest gaps in the current build. None is hidden; each has a tracked follow-up story. Do
not rely on a property this list says is not yet enforced.

- **Single process — module boundary, not a trust boundary.** The agent-facing MCP tier and the
  key-holding core ship in **one process** (the `daemon`). This contains a *prompt-injected agent* (it
  can only invoke tools that transit the core's gates) but does **not** contain *code-execution/RCE of
  the MCP tier*, which would run alongside the keys. *Roadmap:* split the core into its own
  process/Worker — [story 0014](docs/stories/0014-core-process-isolation.md).
- **Requested scopes are not enforced at the providers.** The signed manifest pins **destinations**; a
  request's `scopes` are recorded but not applied — a minted credential currently carries the
  bootstrap's scope (e.g. Cloudflare hardcodes `object-read-write`, GitHub hands out the installation's
  permissions, Supabase ignores scopes). "Scope-limited minting" is not yet true. *Roadmap:*
  [story 0015](docs/stories/0015-provider-scope-enforcement.md).
- **Approvals are replayable within their expiry window; no rate limit.** An approval authorizes an
  action hash until it expires, and the same approved action can be requested repeatedly in that window;
  there is no rate limit or circuit breaker on mutating tools. *Roadmap:* single-use approvals + a
  rate-limit/circuit-breaker — [story 0016](docs/stories/0016-single-use-approvals-and-rate-limit.md).
- **Audit truncation is not detected.** `verifyAuditChain` catches *interior* edits/deletes, but the
  chain is unkeyed with a public genesis, so **tail-truncation and a from-genesis rewrite are not
  detected** by the hash alone — mitigated operationally by an external append-only store with separate
  credentials. *Roadmap:* HMAC-keyed chain + pinned head/length —
  [story 0017](docs/stories/0017-hmac-audit-chain.md).
- **Rotation does not yet place/revoke, and drift is not wired.** `rotate` re-mints and verifies but does
  not re-`place` the new credential or `revoke` the old one at the store, and de-allow-listing does not
  interrupt an in-flight rotation; the `drift` reconciler is present but not wired into the running loop.
  *Roadmap:* wire rotation place/revoke + drift, or narrow the advertisement —
  [story 0018](docs/stories/0018-wire-rotation-place-revoke-and-drift.md).

## Standards referenced

- **CB4A** — the IETF draft `draft-hartman-credential-broker-4-agents` (broker/agent separation).
- **OWASP LLM Top 10** — LLM01 / LLM06 / LLM08.
- **NIST SP 800-57** — master-key custody and rotation.
- **NIST SP 800-207** — zero-trust egress and isolation.

## Current verification status — honest

**This repository now has every control that can be built without live credentials — a tested security
core, a live MCP server, out-of-band approval + a fail-closed kill switch, a tamper-evident audit + alert
sinks, and the self-maintaining rotation loop. It is still NOT production-ready: nothing has yet minted a
real credential, and no independent review has been done.** Concretely:

**Built + unit-tested** (`@secretsminter/core`, `@secretsminter/mcp`):

- Value-blind serialization + scrubber + the `SecretValue` self-redacting wrapper.
- The destination allow-list matcher (strict default-deny) **and** enforcement on the live broker path.
- The **Ed25519 signed-manifest loader** — refuses a tampered / unsigned / wrong-key manifest.
- `NEVER_ROTATE` by name and class, the self-lockout guard, and the composed rotation gate.
- The rotation state machine (verify-before-revoke is structural).
- The **out-of-band `FileApprovalGate`** (action-hash-bound, expiring, default-deny) and the
  **fail-closed `FileKillSwitch`** (unreadable ⇒ halt), enforced by the broker.
- **Hash-chained, value-free audit** (`verifyAuditChain` detects *interior* tamper/deletion; tail-
  truncation and a from-genesis rewrite are NOT detected by the unkeyed chain alone — see Known
  limitations), pluggable **alert sinks** (`FileAlertSink` → `secretsminter.log` JSONL / Console /
  Multi), and **drift reconciliation**.
- The **self-maintaining rotation loop** + `InProcessScheduler` (rotation through the full gate on a
  cadence).
- The **live MCP server** (six narrow tools wired to the broker; value-blind results end to end).

**Live-verified against the real vendor:**

- The **Cloudflare provider** (story 0003) — on 2026-07-31 it minted real **R2 Temporary Credentials**
  from an Admin bootstrap and **verified them with a signed S3 HEAD (PASS)** against actual Cloudflare;
  the minted material self-redacted under serialization (value-blindness proven live). The throwaway
  bootstrap was burned after. This is one green run, not a security audit — still get an independent
  review before trusting it with real, standing credentials.

**Built, but NOT yet run against the live vendor:**

- The **GitHub** (0004) and **Supabase** (0005) provider paths are implemented (real network `mint`/
  `place`/`rotate`, no `NotWiredError`) and unit-tested against injected fakes — but have **not** had a
  live run against the real vendor. Until a provider has a real live run, treat its guarantees as
  exercised only against fakes.

**Do not deploy secretsminter against real credentials** until the provider stories are done AND an
independent security review has signed off. See [`docs/stories/`](docs/stories/) for per-feature status.
