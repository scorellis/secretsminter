# AGENTS.md — onboarding for anyone (human or AI) working in this repo

This is the tool-agnostic onboarding file. Read it before touching code, running the server, or
consuming the repo. It captures the operational conventions that aren't obvious from the code alone.

## What secretsminter is

A **value-blind secrets-minter** exposed to AI agents over MCP: it mints, places, and rotates cloud
credentials without ever returning a secret value to the calling agent. Read [`README.md`](README.md)
for the pitch and [`SECURITY.md`](SECURITY.md) for the threat model. The two invariants that govern
*everything*:

1. **Value-blind** — no secret value crosses the tool boundary, an error string, or a log line.
2. **Destination allow-list** — a placement is refused unless it matches the signed manifest. This, not
   value-blindness, is the real trust root.

If a change you make could violate either, stop and re-read [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Layout

- `packages/core` (`@secretsminter/core`) — the key-holding internal tier: all security invariants, the
  broker pipeline, sinks. Everything network-free here is unit-tested.
- `packages/mcp` (`@secretsminter/mcp`) — the agent-facing MCP server; holds **no** master keys.
- `packages/providers` — Cloudflare/GitHub/Supabase plugins (all have real network paths; live-run
  status varies per story — Cloudflare live-verified, GitHub/Supabase unit-tested against fakes).
- `docs/adrs`, `docs/spikes`, `docs/stories` — decisions, capability findings, and honest per-feature
  status.

## Build & test

```bash
npm install
npm run build          # tsc --build, strict
npm test               # vitest
npm run test:coverage  # vitest + the coverage gate (90/85/88/90 on real logic)
```

The coverage gate runs **locally** (`npm run test:coverage`), not in CI — see the isolation principle.

## Isolation — secretsminter is self-contained, stores nothing, manages *other* repos

secretsminter deploys as **pure, isolated code** someone stands up to run their own broker. Non-negotiable:

- **It stores no tokens.** Bootstrap credentials are injected at runtime (env / secret manager); nothing
  secret is ever committed. `.env` is git-ignored. Durable state is **value-free** (descriptors +
  schedule, no material).
- **It has no GitHub Actions / CI of its own.** No `.github/workflows`. It must not depend on a CI
  pipeline to function, and it never manages *its own* repo. Tests + the coverage gate run locally.
- **It manages *other* repos.** A `GithubActionsStore` places secrets into a **target** repo the
  operator configures (e.g. `owner/app`) — never into secretsminter's repo.

## Operational conventions

### The log / alert sink — `secretsminter.log`

secretsminter emits **alerts** (attention-worthy events: a rotation failed, a high-privilege mint, drift
detected) through a pluggable **sink** (`AlertSink`). If an operator wires the `FileAlertSink`, alerts
are appended to a file — conventionally **`secretsminter.log`** — as **JSON-lines (JSONL)**: one JSON
object per line.

**What you need to know as a consumer/operator:**

- The log is **append-only**. secretsminter never truncates or rotates it — **that is your job.** Rotate
  or truncate `secretsminter.log` periodically (logrotate, a cron, or your platform's log pipeline) so it
  doesn't grow unbounded.
- The log is **value-free by design** — it contains levels, kinds, timestamps, ids, destination
  labels, and safe reason codes, **never a secret value.** It is safe to read, grep, and ship to a log
  aggregator.
- It's just a sink. Prefer `ConsoleAlertSink` (stderr), a `MultiSink` (fan-out), or your own
  `AlertSink` implementation (webhook, syslog, PagerDuty) if a file isn't what you want. The emitting
  code doesn't change.
- The full audit trail is a *separate* sink (`AuditSink`, hash-chained) — see
  [`docs/adrs/0011`](docs/adrs/). Don't conflate the alert log (attention subset) with the audit trail
  (everything).

### No vaporware

A capability that isn't built **says so** — it throws `NotWiredError` and its story in `docs/stories/`
is marked `NOT BUILT` or `PARTIAL`. Don't write a doc line or comment that describes an unbuilt feature
in the present tense. Match claims to what actually runs.

### Never put a secret anywhere it could be read

No secret value in code, a commit, a log line, an error message, an `argv`, or a test fixture. Live
material lives only in a `SecretValue` (which self-redacts) and is read only via `.expose()`.
`grep -rn "\.expose(" packages/` enumerates every read site — keep that list short and deliberate.
