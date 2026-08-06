---
Story: 0008
Status: DONE 2026-07-31
---

# 0008 — Hash-chained audit + drift reconciliation

**DONE 2026-07-31.** `HashChainedAuditSink` (`audit.ts`) chains each value-free entry to the previous
one; `verifyAuditChain` detects any tamper or deletion and reports where. Alerts flow through a
pluggable **sink** (`alert.ts`): `FileAlertSink` (JSONL → `secretsminter.log`), `ConsoleAlertSink`,
`NullAlertSink`, `MultiSink`; the broker emits value-free alerts on mint/rotate success and failure.
Drift `reconcile()` (`drift.ts`) flags credentials that exist at a provider but aren't managed (and
vice-versa) → warn alerts. Operational conventions documented in `AGENTS.md`. **Note:** writing the
chain to an *external* store is a deployment choice (inject the writer); feeding drift from a *live*
provider inventory arrives with the provider stories (0003–0005).

## Goal
Build the tamper-evident, value-free audit trail and the drift detector (ADR-0011).

## Tasks
- Hash-chain each audit entry (chains the prior entry's hash) → tamper-evident.
- Write to an **external store with separate credentials** so a broker compromise can't rewrite history.
- Store only `auditFingerprint` (crypto.ts), provider, scope, destination, requester, approval ref,
  outcome — never a value.
- Out-of-band alert on every high-privilege mint.
- Periodic reconciliation: flag any credential that exists at a provider but not in the manifest.

## Done when
- Editing/deleting an audit entry is detectable via the chain.
- A provider-side token absent from the manifest raises a drift alert.
