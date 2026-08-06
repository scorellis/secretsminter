---
Story: 0018
Status: active — NOT BUILT
---

# 0018 — Wire rotation place/revoke + re-assert the allow-list + drift

**NOT BUILT.** The rotation path is incomplete relative to what the docs imply:

- `rotate` (`broker.ts`) re-mints and verifies but does **not** re-`place` the new credential at the
  store or `revoke` the old one — it lacks the place/revoke steps the `mint_and_place` path has.
- `rotate`/`revoke` do **not re-assert the current allow-list**, so de-allow-listing a destination does
  not interrupt an in-flight rotation.
- The `drift` reconciler (`drift.ts`) exists but is **not wired** into the running loop, even though
  `status` advertises drift.
- The dedicated rotation state machine (`rotation.ts`) is present but not driven by the live loop.

## Goal
Rotation that fully **mints → places → verifies → revokes** through the same gates as a first placement,
re-asserting the allow-list each cycle, with drift reconciliation actually running — OR, where a piece is
deliberately deferred, narrow the docs/advertisement so nothing over-claims.

## Tasks
- Add the place step to `rotate` (place the new credential at the destination store) and the revoke of
  the superseded credential, preserving verify-before-revoke.
- Re-run `assertAllowed` at the start of every rotate/revoke so a de-allow-listed destination halts it.
- Wire `drift.ts` into the scheduler loop and surface real drift through `status`.
- Where the state machine (`rotation.ts`) is the intended driver, connect it; otherwise remove the dead
  module and the `status` drift advertisement.

## Done when
- A scheduled rotation places the new credential, verifies it, and revokes the old one, all gated.
- De-allow-listing a destination stops its next rotation.
- `status` reports drift computed by a wired reconciler, or the advertisement is removed.
