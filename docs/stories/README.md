# Stories

secretsminter tracks every feature as a story. Honest status is a hard rule: a `DONE` story has working,
tested code behind it; everything else says `NOT BUILT`. A capability is never claimed before it ships.

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-charter-and-scaffold.md) | Charter, planning bundle, scaffold, and the security core | **DONE 2026-07-29** |
| [0002](0002-mcp-live-serving.md) | MCP live serving | **DONE 2026-07-30** |
| [0003](0003-cloudflare-provider-live.md) | Cloudflare provider (live) | **DONE — live-verified 2026-07-31** |
| [0004](0004-github-provider-live.md) | GitHub provider (live) | **BUILT — unit-tested; live run pending a GitHub App** |
| [0005](0005-supabase-provider-live.md) | Supabase provider (live) | **BUILT — unit-tested; live run pending a PAT** |
| [0006](0006-manifest-and-allowlist-enforcement.md) | Signed manifest loader + live allow-list enforcement | **DONE 2026-07-30** |
| [0007](0007-approval-and-killswitch.md) | Out-of-band approval + fail-closed kill switch | **DONE 2026-07-31** |
| [0008](0008-audit-and-drift.md) | Hash-chained audit + drift reconciliation | **DONE 2026-07-31** |
| [0009](0009-scheduler-and-rotation-loop.md) | Scheduler + the self-maintaining rotation loop | **DONE 2026-07-31** (logic; live rotation needs providers) |
| [0010](0010-durable-state.md) | Durable broker state (survive a restart) | **DONE 2026-07-31** |
| [0011](0011-daemon-runner.md) | The daemon (composition root + rotation loop + MCP serving) | **DONE 2026-07-31** |
| [0012](0012-deployable-docker.md) | Deployable — Dockerfile + operator README | **DONE 2026-07-31** (image build not yet validated on a Docker host) |
| [0013](0013-cloudflare-pages-place.md) | Cloudflare Pages env-var place | **DONE 2026-08-05 — env-write + daemon-wired + live-run + redeploy-and-reconcile (ADR 0004: trigger + await deploy, verify after)** |
| [0014](0014-core-process-isolation.md) | Split the core into its own process (real two-tier trust boundary) | **active — NOT BUILT** |
| [0015](0015-provider-scope-enforcement.md) | Enforce requested scopes at the providers | **active — NOT BUILT** |
| [0016](0016-single-use-approvals-and-rate-limit.md) | Single-use approvals + rate limit / circuit breaker | **active — NOT BUILT** |
| [0017](0017-hmac-audit-chain.md) | HMAC the audit chain + detect truncation | **active — NOT BUILT** |
| [0018](0018-wire-rotation-place-revoke-and-drift.md) | Wire rotation place/revoke + re-assert allow-list + drift | **active — NOT BUILT** |
| [0019](0019-live-verify-github-actions-place.md) | Live-verify a GitHub Actions place end-to-end | **active — NOT BUILT** |
| [0020](0020-local-random-secret-mint.md) | Local random-secret mint provider (app HMAC/signing secrets, value-blind) | **BUILT 2026-08-05 — unit-tested; no vendor path by design** |
| [0021](0021-direct-upload-redeploy.md) | Direct-upload Pages redeploy (project-type detection + RedeployHook + githubWorkflowDispatchHook; extends ADR 0004) | **DONE 2026-08-06** |
| [0022](0022-secretclass-app-secret.md) | A `SecretClass` for symmetric app/HMAC secrets (retire the `api-token` stopgap) | **DONE 2026-08-06 — `app-secret` class added + MCP enum + local provider relabeled + rotatable-by-class tested** |
| [0023](0023-init-and-allow-cli.md) | `secretsminter init` + `allow` — first-run manifest scaffolding (keypair, sign, add-destination-and-re-sign) | **DONE 2026-08-06 — init + allow subcommands; `signManifest`/`STORE_IDS` in core; self-verify; 14 tests** |
| [0024](0024-onboarding-guide.md) | Onboarding guide (`docs/USING.md`) — the "read this repo and set me up" flow, ephemeral-first | **DONE 2026-08-06 — AI-followable clone-to-first-mint guide + README pointer; env-var names code-verified** |

**Roadmap:** every control that can be built without live credentials is now **done** — the MCP server
serves (0002), the signed manifest + allow-list are enforced (0006), the out-of-band approval + fail-
closed kill switch (0007), the hash-chained audit + alert sinks + drift (0008), and the self-maintaining
rotation loop + scheduler (0009). The remaining live provider network paths — Cloudflare (0003),
GitHub (0004), Supabase (0005) — need real credentials. A set of **credibility follow-ups (0014–0019)**
tracks the honest gaps surfaced by the 2026-08-05 pre-release audit: real process isolation (0014),
provider-side scope enforcement (0015), single-use approvals + rate limit (0016), an HMAC audit chain
with truncation detection (0017), fully wired rotation place/revoke + drift (0018), and a live GitHub
Actions place (0019). See [`../../ROADMAP.md`](../../ROADMAP.md). **Nothing is production-ready until
these land AND an independent security review signs off** (see [`../../SECURITY.md`](../../SECURITY.md)).
