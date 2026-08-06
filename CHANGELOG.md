# Changelog

All notable changes to secretsminter are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/); this project adheres to semantic versioning once it
publishes packages.

## [Unreleased]

### Added — P0: charter, scaffold, and the security core (2026-07-29)

- **Planning bundle** — charter/README, `SECURITY.md` (threat model), `AI_REVIEW.md` (open invitation
  to human and AI reviewers), `docs/USING.md` (the intended operator experience — run-it-yourself
  model, marked forthcoming), `ROADMAP.md`, `CONTRIBUTING.md`, 13 ADRs, 3 capability spikes, and 9
  stories.
- **Monorepo scaffold** — `@secretsminter/core`, `@secretsminter/providers`, `@secretsminter/mcp` (npm
  workspaces, strict TypeScript, vitest).
- **The pure-logic security core** (`@secretsminter/core`), unit-tested:
  - value-blind serialization + secret-scrubber (`value-blind.ts`)
  - destination allow-list matcher, strict default-deny (`allowlist.ts`)
  - `NEVER_ROTATE` by name and class (`never-rotate.ts`)
  - self-lockout dependency guard (`guard.ts`)
  - the rotation state machine with structural verify-before-revoke (`rotation.ts`)
  - the R2 S3-secret derivation + keyed audit fingerprint (`crypto.ts`)
- **Provider + MCP scaffolds** — Cloudflare/GitHub/Supabase plugins and the MCP tool catalog, with all
  live network paths honestly stubbed (`NotWiredError`) pending their stories.

### Hardened — combative review pass (2026-07-29)

- **`SecretValue` self-redacting wrapper** (`secret-value.ts`) — live material can no longer leak via
  an accidental `JSON.stringify`, `console.log`, or template interpolation; the raw value is reachable
  only through `.expose()`. `MintedSecret.material` and `extra` now use it.
- **Action-enum whitelisting** — `whitelistSerialize` validates the `action` field against a closed
  set; an unrecognized action falls back to read-only `status` instead of passing through verbatim.
- **Cause-chain scrubbing** — `scrubError` now follows an error's `cause` chain (where a wrapped
  provider client error can hide a token) and the scrubber accepts `SecretValue` inputs directly.
- Test suite grew from 24 to 33, including adversarial serialization tests.

### Added — P1 (no-creds slice): live MCP server + signed manifest + broker pipeline (2026-07-30)

- **Signed-manifest loader** (`manifest.ts`, story 0006) — verifies a detached **Ed25519** signature
  over the raw manifest bytes; refuses a tampered, unsigned, or wrong-key manifest. Manifest now
  carries the allow-list plus `neverRotate` and `brokerDependencies`.
- **The `Broker` pipeline** (`broker.ts`) — the internal tier that enforces, on the real request path:
  destination allow-list (default-deny, checked first), the approval gate, `NEVER_ROTATE`
  (name+class, incl. manifest additions), and the self-lockout guard — returning only value-blind
  results, with failures collapsed to safe reason codes (never a raw message).
- **Approval gate** (`approval.ts`, story 0007 partial) — the `ApprovalGate` interface, a deterministic
  action-hash binding, and a `DenyAllGate` default; enforced by the broker.
- **The live MCP server** (`@secretsminter/mcp`, story 0002) — `createServer(broker)` over
  `@modelcontextprotocol/sdk` with all six tools; `secretsminter-mcp` serves on stdio. In-memory-transport
  integration test proves serving, value-blind success, and safe refusals.
- Test suite grew to **62**.

### Added — every no-creds security control (2026-07-31)

- **Out-of-band approval + fail-closed kill switch** (story 0007) — `FileApprovalGate` (operator-written,
  action-hash-bound, expiring, default-deny) and `FileKillSwitch` (fail-closed: unreadable ⇒ halt),
  enforced by the broker as the outermost gate.
- **Audit + alert sinks + drift** (story 0008) — hash-chained tamper-evident `AuditSink`
  (`verifyAuditChain`), pluggable `AlertSink` (`FileAlertSink` → `secretsminter.log` JSONL / Console /
  Multi), value-free broker alerts, and pure drift `reconcile()`. `AGENTS.md` onboarding documents the
  log-cleanup convention.
- **Self-maintaining rotation loop + scheduler** (story 0009) — per-secret rotation cadence,
  `dueForRotation()` / `runScheduledRotations()` (rotation through the full gate + reschedule), and
  `InProcessScheduler`.
- Test suite grew to **86**.

### Hardened — adversarial suite + coverage gate (2026-07-31)

- **18-test adversarial suite** (`adversarial.test.ts`) that actively tries to defeat each invariant and
  asserts it can't: value exfiltration (odd keys, nesting, `SecretValue` introspection, a provider
  error that *inlines the token*), allow-list bypass (case, trailing space, newline, wrong store —
  all fail closed), kill-switch defeat (halts rotate + revoke), approval replay (action-hash
  distinctness), audit tamper (reorder + forged append), self-lockout through the broker, and a failing
  scheduled rotation (doesn't throw, doesn't advance the schedule, alerts an error). No gap surfaced —
  every invariant held.
- **Coverage gate** — `@vitest/coverage-v8` with thresholds (90% statements/lines, 85% branch, 88%
  functions) on the real logic (barrels, type-only, the stdio bootstrap, and `NotWired` provider stubs
  excluded), wired into CI. Current: **98% statements, 92% branch. 109 tests.**

### Added — Cloudflare provider + manual-steps ledger + CB4A alignment (2026-07-31)

- **Cloudflare provider, live code** (story 0003) — `CloudflareProvider` mints **R2 Temporary
  Credentials** (ephemeral-first), verifies with a signed **S3 HEAD** (`aws4fetch`), rotates by
  re-minting, and revokes as a no-op (self-expiry). HTTP + S3 are injectable seams → network-free unit
  tests; `fromEnv` reads the bootstrap; `scripts/live-cloudflare.mjs` proves it end to end once a
  throwaway token is in `.env`. **Not yet run against real Cloudflare.**
- **Manual-steps ledger** (`docs/MANUAL-STEPS.md`) + an **executable** version
  (`no-manual-steps.test.ts`): every human-touch point classified `ELIMINATED` (each backed by a named
  test proving the automation), `IRREDUCIBLE BOOTSTRAP` (secret zero, minimized/out-of-band), or
  `DELIBERATE CONTROL` (approval, kill switch). A regression that reintroduces manual toil fails CI.
- **ADR-0014** — align with the CB4A IETF draft (`draft-hartman-credential-broker-4-agents`): aligned
  in architecture/spirit (broker/agent separation), not wire-protocol conformant.
- Coverage gate now includes `cloudflare.ts`. **127 tests**, 96.6% statements.

### Not yet built (see `docs/stories/`)

The **GitHub** (0004) and **Supabase** (0005) provider paths, and a real live run of Cloudflare (0003).
Until a provider has a real live run, treat its guarantees as exercised only against fakes. **Do not
deploy against real credentials, and get an independent security review first.**
