---
Story: 0006
Status: DONE 2026-07-30
---

# 0006 — Signed manifest loader + live allow-list enforcement

**DONE 2026-07-30.** `verifyAndLoadManifest` (`packages/core/src/manifest.ts`) verifies a detached
**Ed25519** signature over the raw manifest bytes and refuses a tampered, unsigned, or wrong-key
manifest; `parseManifest` shape-validates it. The manifest carries the allow-list plus `neverRotate`
and `brokerDependencies`. `assertAllowed` is wired into the live `Broker` place/rotate path
(`broker.ts`), default-deny, before any provider is consulted. Tests cover tamper/unsigned/wrong-key
rejection and end-to-end refusal of a non-allow-listed destination through the MCP stack.

## Goal
Turn the pure allow-list matcher (DONE in `allowlist.ts`) into a live trust root: a **signed, pinned,
values-free manifest** the agent cannot write, enforced on every place/rotate path (ADR-0008).

## Tasks
- Define the manifest file format (destinations + scopes + `NEVER_ROTATE` set + broker-dependency set).
- Load + **verify a signature** on the manifest; refuse to run on an unsigned/altered manifest.
- Wire `assertAllowed` into the live place/rotate path in the core (before any store write).
- Ensure manifest changes are out-of-band only — no tool mutates it.

## Done when
- A tampered or unsigned manifest is rejected at load.
- A live placement to a destination absent from the manifest is refused (adversarial test).
