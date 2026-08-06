---
Status: Accepted
Date: 2026-07-29
---

# 0010 — Rotation safety

## Context

Rotation is the point of secretsminter, not a bolt-on: the AI stands a secret up *and* wires its recurring freshness, then walks away. That makes rotation a hands-free, unattended operation — which is exactly where a naive implementation is most dangerous. A fire-and-forget "mint new, revoke old" call can revoke a working credential before the replacement is proven, brick a consumer that self-rotates a key baked into shipped builds, be driven as a denial-of-service by over-rotation, or turn the broker's own dependencies off mid-flight.

## Decision

Rotation safety is enforced structurally, in `rotation.ts`, `never-rotate.ts`, and `guard.ts`, not by convention:

**A persisted, resumable state machine** (`rotation.ts`):
`PENDING → MINTED → PLACED → VERIFIED → REVOKED → DONE`. The transition table has **no edge that revokes before verify** — `revoke` is only reachable from `VERIFIED`, so verify-before-revoke is a property of the graph, not something a caller might forget. `VERIFIED` is a **real functional health probe** (HEAD an R2 bucket with the new creds, hit a live API), never "the PUT returned 200." `fail` drops any non-terminal state to `FAILED` and leaves the **old credential working**. State persists to the store/audit, so a crashed tick resumes mid-rotation instead of re-minting or leaving a consumer broken.

**A dual-credential overlap window.** The old credential stays valid through a grace period after the new one verifies — never a hard cutover. Consumers mid-request against the old credential are not severed.

**A server-enforced minimum rotation interval.** Rotations closer together than the floor are refused, blocking an over-rotation denial-of-service (each rotation widens the swap window and burns provider quota).

**`NEVER_ROTATE` by name AND by class** (`never-rotate.ts`). Ported from the reference `rotate_secrets.py` frozenset: unconditional, case-insensitive, and a **committed constant** — a prompt-injected agent cannot edit it via a tool call. The security review found the name-only gap: a signing key minted under a *fresh name* evades a name list, so the **class** (`updater-signing-key`) is the real guard. `assertRotatable` hard-fails at **both** the scheduler level (never enqueued) and the executor level (`rotate`/`revoke` refuse). Such a key is mint/place-able but never rotate/revoke-able.

**A self-lockout dependency guard** (`guard.ts`). The broker refuses to rotate any credential *it itself depends on* in the naive way — its own store-writer cred, the GitHub App private key, the approval-signing key, any bootstrap cred (`assertNotSelfLockout` → `SelfLockoutError`). Otherwise the scheduler could cut off its own hands. **This does not freeze the root** — it enforces the ordering. The bootstrap/crown credential rotates from the crown down via **make-before-break**: mint a new equal-privilege credential → plant it → verify the broker works on it → *then* roll/revoke the old. The guard blocks only the revoke-first ordering that self-bricks. The single truly irreducible secret is the human account login; everything below rotates (see [`../MANUAL-STEPS.md`](../MANUAL-STEPS.md)).

These two refusals — `NEVER_ROTATE` and self-lockout — are composed into a single mandatory gate, `assertMayRotate(descriptor, brokerDeps)` (`policy.ts`), which every `rotate`/`revoke` path calls instead of the two checks by hand. This is defense against a *wiring* mistake: a future caller cannot enforce one guard and silently forget the other.

**AI-authored rotation config is proposed, not hot-applied.** A new cadence/policy is `plan`-diffed and **human-armed out-of-band** before it activates — same posture as the manifest (ADR-0008). The AI builds the automation; a human gate arms it.

## Consequences

- An unattended rotation can never leave a consumer holding only a dead credential: the old one survives until the new one *functionally* works, plus a grace window.
- Crown-jewel signing keys and broker dependencies are structurally un-rotatable regardless of what name a request uses.
- Rotation is slower and chattier (verify probes, overlap windows, interval floors). Accepted — the whole value is unattended safety.
- All of it is pure, injectable logic, unit-tested adversarially (rotating a signing-key-class secret must hard-fail).
