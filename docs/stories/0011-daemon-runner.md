---
Story: 0011
Status: DONE 2026-07-31
---

# 0011 — The daemon (the running home that closes the loop)

**DONE 2026-07-31.** The third of three integrations that turn "engine on the test stand" into "give
it the token once and walk away." `@secretsminter/daemon` is the **composition root** — the deployable
service an operator runs to stand up their own secretsminter:

- **`config.ts`** — `configFromEnv`: all config from the environment (12-factor). No secrets here.
- **`build.ts`** — `buildBroker(config)`: assembles the core `Broker` from config — the **signed
  manifest** (trust root; a tampered one fails the daemon fast), providers (each `fromEnv`, skipped if
  its bootstrap isn't configured), a `GithubActionsStore` when GitHub is configured, durable
  `FileStateStore`, out-of-band `FileKillSwitch` + `FileApprovalGate`, and `FileAlertSink` /
  hash-chained audit. **Safe defaults:** empty allow-list (nothing placeable), deny-all approvals
  (nothing mutating runs), never-engaged kill switch, in-memory state.
- **`loop.ts`** — `startRotationLoop`: an `InProcessScheduler` that ticks `runScheduledRotations` on an
  interval; each due secret rotates through the full gate and reschedules.
- **`cli.ts`** — the `secretsminter` bin: build the broker, start the loop, **serve the MCP over stdio**.

Tested: config defaults/parsing; `buildBroker` builds a safe empty broker, loads + verifies a signed
manifest, **fails fast on a tampered one**, and wires a provider when its env is present; the loop
ticks. **It stores no secrets and has no CI of its own** — bootstraps are injected at runtime.

## The loop is now closed
With durable state (0010) + a real Store (0004) + this daemon, an operator can: inject the bootstrap
once → the daemon serves the MCP + runs the rotation loop → minted secrets get placed into a target
repo → they rotate on schedule → state survives restarts. The remaining live runs (GitHub 0004,
Supabase 0005) just need the operator's real vendor credentials.
