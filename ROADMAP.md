# Roadmap

secretsminter is built in phases. The ordering is deliberate: **the security controls that make live
minting safe land before live minting is enabled.** Nothing touches a real credential until the P0
controls in [`SECURITY.md`](SECURITY.md) are in place.

## P0 — Charter + scaffold + the security core ✅ (done 2026-07-29)

The repository, the planning bundle (charter, ADRs, spikes, stories, this roadmap), the monorepo
scaffold (`@secretsminter/core`, `@secretsminter/providers`, `@secretsminter/mcp`), and the **pure-logic P0
security core** with a passing test suite:

- value-blind serialization + secret-scrubber (`value-blind.ts`)
- destination allow-list matcher, strict default-deny (`allowlist.ts`)
- `NEVER_ROTATE` by name **and** class (`never-rotate.ts`)
- self-lockout dependency guard (`guard.ts`)
- the rotation state machine, verify-before-revoke structural (`rotation.ts`)

See story [`0001`](docs/stories/0001-charter-and-scaffold.md).

## P1 — Two-tier contract + the P0 controls live — ✅ DONE (2026-07-30/31)

- ✅ **MCP server serves** ([`0002`](docs/stories/0002-mcp-live-serving.md)) — six tools wired to the
  broker, integration-tested.
- ✅ **Signed-manifest loader + live allow-list enforcement** ([`0006`](docs/stories/0006-manifest-and-allowlist-enforcement.md)).
- ✅ **Out-of-band approval + fail-closed kill switch** ([`0007`](docs/stories/0007-approval-and-killswitch.md)).

## P2 — Providers + the general rotation loop

- ✅ **Hash-chained audit + alert sinks + drift reconciliation** ([`0008`](docs/stories/0008-audit-and-drift.md)).
- ✅ **Self-maintaining rotation loop + scheduler** ([`0009`](docs/stories/0009-scheduler-and-rotation-loop.md)) — the loop logic; runs against fakes today.
- ⬜ **The live providers** — Cloudflare ([`0003`](docs/stories/0003-cloudflare-provider-live.md)),
  GitHub ([`0004`](docs/stories/0004-github-provider-live.md)), Supabase
  ([`0005`](docs/stories/0005-supabase-provider-live.md)). **This is the only remaining work, and it
  needs live credentials.** The Cloudflare R2 slice is the shortest path to a first real
  mint → place → verify → revoke.

## P3 — Config-as-code manifest + status/drift + the "just works" pipeline

The values-free, signed manifest of the desired (self-maintaining) secret topology, convergence + a
drift report, and the first real pipeline that calls secretsminter to provision a service hands-free.

## Later

Generalize the provider plugin model; community docs; a Cloudflare Worker + Durable Object deployment
(the ephemeral-first, alarm-scheduled variant); optional formal alignment with the CB4A IETF draft; a
dedicated GitHub org if the project graduates.
