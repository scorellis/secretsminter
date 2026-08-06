# Architecture Decision Records

Write-once records of the decisions behind secretsminter, in [Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
format. Supersede a decision with a new ADR rather than editing an old one.

**Start with [`0001`](0001-value-blind-mechanism.md) and [`0008`](0008-destination-allowlist-trust-root.md)** —
together they state the two invariants, and 0008 is the load-bearing one.

| # | Title | Summary |
| --- | --- | --- |
| [0001](0001-value-blind-mechanism.md) | Value-blind mechanism | Value-blindness is an enforced boundary (whitelist serialization + error/log scrubber + stdin-only + mint-only + fingerprint audit) — necessary, but it stops *reading* a secret (LLM06), not *exfiltration* (that's 0008). |
| [0002](0002-provider-plugin-architecture.md) | Provider plugin architecture | A `Provider` (mint/rotate/revoke/verify/describe) split from a `Store` (place), with `verify()` first-class as a functional health probe before revoke. |
| [0003](0003-github-app-not-pat.md) | GitHub App, not PAT | Authenticate via short-lived (~1h) App installation tokens scoped to allow-listed repos; place secrets via libsodium sealed box. |
| [0004](0004-store-abstraction.md) | Store abstraction | Placement is a pluggable write step distinct from minting; Cloudflare Pages env takes effect on the next deploy, so placement triggers + awaits a redeploy. |
| [0005](0005-approval-and-kill-switch.md) | Approval + kill switch | Both are out-of-band and agent-unreachable (never MCP tools); approval is action-hash-bound with expiry; the kill switch fails closed and halts the scheduler. |
| [0006](0006-self-hosted-hosting.md) | Self-hosted hosting | v1 is a self-hostable container so master keys never touch a third party, behind an egress allow-list; forward-compatible with a later Worker + Durable Object deployment. |
| [0007](0007-apache-2-and-ip-posture.md) | Apache-2.0 + IP posture | Apache-2.0 for its explicit patent grant; records a LOW-patent-risk scan against dense prior art. |
| [0008](0008-destination-allowlist-trust-root.md) | Destination allow-list is the trust root | The real containment against a prompt-injected agent directing a live credential to an attacker (LLM08): strict default-deny `assertAllowed` against a signed, agent-un-writable manifest. |
| [0009](0009-two-tier-broker-isolation.md) | Two-tier broker isolation | Split the no-keys agent-facing MCP server from the key-holding core that re-enforces policy; a compromised MCP tier can only *request*. Mirrors the CB4A IETF draft. |
| [0010](0010-rotation-safety.md) | Rotation safety | Persisted resumable state machine (revoke unreachable before a functional verify) + dual-credential overlap + min interval + `NEVER_ROTATE` by name and class + self-lockout guard. |
| [0011](0011-audit-immutability.md) | Audit immutability | Hash-chained, value-free audit in an external store with separate credentials; keyed fingerprints, not values; out-of-band alerting + drift reconciliation. |
| [0012](0012-ephemeral-first-credentials.md) | Ephemeral-first credentials | Mint short-lived, self-expiring credentials where a consumer can fetch at use-time — the rotation problem dissolves. The honest path to frequent rotation without upkeep. |
| [0013](0013-scheduler-owns-the-clock.md) | The scheduler owns the clock | The broker holds the keys, so it holds the schedule; two-tier cadence (placed daily/on-drift, ephemeral by TTL); Actions cron only a secondary self-trigger. |
| [0014](0014-cb4a-alignment.md) | Align with the CB4A IETF draft | Map secretsminter onto `draft-hartman-credential-broker-4-agents` (broker/agent separation) for credibility + shared vocabulary; aligned in architecture/spirit, not wire-protocol conformant. |
