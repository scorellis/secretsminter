# 0002 — Provider plugin architecture

Status: Accepted
Date: 2026-07-29

## Context

secretsminter must work across heterogeneous cloud vendors — Cloudflare, GitHub, Supabase in v1, more later — each with its own minting API, credential shape, and rotation semantics. If vendor logic is inlined into the core's flows, every new vendor forces a change to the crown-jewel minting code, and the core accumulates a tangle of special cases. We need a stable seam that lets a vendor be added as a package without touching the security invariants.

There are also two genuinely different privileges hiding under "handle a secret": the authority to **mint/rotate/revoke** a credential at a vendor (crown-jewel) and the authority to **place** an already-minted value at a destination. Conflating them over-grants: a component that only needs to write a GitHub Actions secret should not also hold token-minting authority.

## Decision

Define a `Provider` interface distinct from a `Store` interface (`packages/core/src/provider.ts`).

`Provider` owns credential lifecycle: `mint`, `rotate`, `revoke`, **`verify`**, `describe`. `Store` owns placement: a single `place(target, secret)`. The core enforces the invariants (value-blindness, allow-list, `NEVER_ROTATE`, self-lockout) around these interfaces so a plugin cannot bypass them; a plugin implements only vendor mechanics.

**`verify` is first-class, not an afterthought.** It is a functional health probe *with the new credential* — HEAD an R2 bucket, call an authenticated GitHub API, hit a Supabase endpoint — that MUST pass before the old credential is revoked. The rotation state machine (ADR-0010, `rotation.ts`) cannot reach `REVOKED` except from `VERIFIED`, so verify-before-revoke is structural. "The PUT returned 200" is explicitly not verification; the point is to prove the new credential actually works before destroying the working one.

v1 providers, all confirmed feasible by the architecture review, are stubbed with `NotWiredError` until each one's story lands so the package never claims a capability it lacks:

- **Cloudflare** (`packages/providers/src/cloudflare.ts`) — mints R2 API tokens; the pure S3-secret derivation `r2S3Credentials` is real and tested.
- **GitHub** (`packages/providers/src/github.ts`) — App installation tokens + sealed-box Actions secrets (ADR-0003).
- **Supabase** (`packages/providers/src/supabase.ts`) — publishable/secret keys + JWT signing keys via the Management API.

## Consequences

Adding a vendor is a new package implementing two small interfaces; the core and its security tests are untouched. `describe()` surfaces per-provider capability (e.g. `supportsEphemeral`) so the scheduler can choose the ephemeral-first path where available. `NotWiredError` keeps the honest line between a real capability and a documented, not-yet-built one. The Provider/Store split lets minting authority and placement authority be granted and audited separately (ADR-0004).
