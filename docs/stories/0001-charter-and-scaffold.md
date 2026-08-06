---
Story: 0001
Status: DONE 2026-07-29
---

# 0001 — Charter, planning bundle, scaffold, and the security core

## Goal
Stand up the repository with a comprehensive planning bundle and a monorepo scaffold whose **pure-logic
security core is real and tested**, so that every later feature is built against enforced invariants
rather than good intentions.

## What shipped
- **Planning bundle** — README/charter, `SECURITY.md` (threat model), `AI_REVIEW.md` (open invitation
  to human and AI reviewers), `ROADMAP.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, `NOTICE`, 13 ADRs, and 3
  capability spikes.
- **Monorepo** — `@secretsminter/core`, `@secretsminter/providers`, `@secretsminter/mcp` (npm workspaces, strict
  TypeScript, vitest, CI workflow).
- **The security core** (`@secretsminter/core`), unit-tested:
  - `value-blind.ts` — whitelist serialization + secret-scrubber (+ cause-chain)
  - `secret-value.ts` — the self-redacting `SecretValue` wrapper
  - `allowlist.ts` — destination allow-list matcher, strict default-deny
  - `never-rotate.ts` — `NEVER_ROTATE` by name and class
  - `guard.ts` + `policy.ts` — self-lockout guard and the composed `assertMayRotate` gate
  - `rotation.ts` — the state machine with structural verify-before-revoke
  - `crypto.ts` — R2 S3-secret derivation + keyed audit fingerprint
- **Provider + MCP scaffolds** — plugins and the MCP tool catalog, all live network paths honestly
  stubbed with `NotWiredError`.

## Done when
- [x] `npm test` green (37 tests) and `npm run build` clean under strict TypeScript.
- [x] No secret value can be emitted by `whitelistSerialize` or a `SecretValue` under serialization
  (adversarial tests present).
- [x] The bundle documents the two invariants and the honest build status.
