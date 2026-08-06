# 0004 — Store abstraction: placement is a pluggable write step

Status: Accepted
Date: 2026-07-29

## Context

"Provision a secret" is really two acts with different privileges and different failure modes: **minting** a fresh credential at a vendor, and **placing** that credential where a consumer will read it. The same minted R2 token might be written into a GitHub Actions secret, a Cloudflare Pages environment variable, or a local file — the mint is identical; only the destination write differs. If placement is folded into each provider, every provider re-implements every destination, and minting authority gets bundled with write authority that a placement step does not need.

Destinations also do not behave uniformly. A GitHub Actions secret is effective immediately. A Cloudflare Pages environment variable is **not**: it takes effect only on the *next deploy*. A naive `place` that returns success the instant the API accepts the value would report a secret as live while the running deployment still holds the old one — a silent, dangerous drift, especially mid-rotation.

## Decision

Model placement as a separate, pluggable `Store` interface — `place(target, secret)` — distinct from `Provider` (`packages/core/src/provider.ts`). The core calls `assertAllowed` (ADR-0008) against the signed manifest *before* any `Store.place` runs; a store never sees a destination the allow-list has not already cleared.

v1 stores, keyed by `StoreId` in `packages/core/src/types.ts` (`"github-actions" | "cloudflare-pages" | "file"`):

- **github-actions** — libsodium sealed-box write to `/repos/{owner}/{repo}/actions/secrets/{name}` (ADR-0003). Effective immediately.
- **cloudflare-pages** — writes an environment variable via the API/wrangler. **The env is effective on the *next deploy*, so placement is not complete until a redeploy is triggered and awaited.** A `cloudflare-pages` placement that does not reconcile against a fresh deploy is considered unfinished, not merely un-optimized.
- **file** — writes to a local path; the simplest store, useful for self-hosted consumers and tests.

`PlaceTarget` carries the destination identity (`store`, optional `repo`/`project`/`environment`, `name`) and is the exact shape the allow-list matches, so free-form target args are never trusted.

## Consequences

Minting authority and placement authority are granted and audited independently — a component can be allowed to place into one repo without holding any token-minting key. A new destination is a new `Store` implementation; providers are untouched. The Pages "effective on next deploy" rule is encoded as a placement obligation (trigger + await redeploy), preventing the false-fresh state that would otherwise appear during rotation. The `verify` step of the rotation state machine (ADR-0010) probes the *consumer-visible* credential, which for Pages means after the redeploy — catching any placement that reported success prematurely.
