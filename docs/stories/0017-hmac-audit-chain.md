---
Story: 0017
Status: active — NOT BUILT
---

# 0017 — HMAC the audit chain + detect truncation

**NOT BUILT.** The audit chain (`audit.ts`) is **interior-tamper-evident** — editing or deleting an
interior entry breaks the chain and `verifyAuditChain` reports where. But it is **unkeyed** (a plain
SHA-256) with a **public genesis constant**, so **tail-truncation and a wholesale rewrite from genesis
are NOT detected**: an attacker who can rewrite the file can recompute a shorter valid chain. Today this
is mitigated only operationally, by writing the chain to an external append-only store with separate
credentials.

## Goal
Make the chain **self-defending**, so truncation and rewrite are detected by verification alone, not
only by where the file is stored.

## Tasks
- Key the chain with an **HMAC** using a secret held separately from the broker (so a broker compromise
  can't forge a valid chain).
- Track and verify a **pinned head hash + length** (a high-water mark persisted out-of-band), so a
  shorter-but-internally-valid chain is rejected.
- Extend `verifyAuditChain` to take the pinned head/length and the HMAC key and report truncation
  distinctly from interior tamper.
- Tests: tail-truncation and a from-genesis rewrite are both detected.

## Done when
- `verifyAuditChain` flags a truncated chain and a rewritten-from-genesis chain, not just interior edits.
- The HMAC key and pinned head live outside the broker's own credential set.
