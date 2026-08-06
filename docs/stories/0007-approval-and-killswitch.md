---
Story: 0007
Status: DONE 2026-07-31
---

# 0007 — Out-of-band approval + fail-closed kill switch

**DONE 2026-07-31.** The **`FileApprovalGate`** (`file-approval.ts`) reads an operator-written,
action-hash-bound, expiring approval store the agent has no tool to write — approval is genuinely
out-of-band, default-deny on a missing/unparseable/unreadable store. The **`FileKillSwitch`**
(`kill-switch.ts`) is **fail-closed**: present+non-empty ⇒ halt, absent ⇒ live, **unreadable ⇒ halt**.
The broker checks the kill switch as the outermost gate on every mutating op and refuses with
`kill-switch-engaged`. The earlier `ApprovalGate` interface + `actionHash` binding + `DenyAllGate` were
the seam these plug into. Tested: fail-closed behaviour, expiry, replay-refusal, broker halt.

## Goal
Build the approval and kill-switch mechanisms as **out-of-band, agent-unreachable** controls (ADR-0005)
— never MCP tools.

## Tasks
- Approval: a separate channel where a human confirms a specific **action hash**
  (provider+action+destination+scope), with expiry and default-deny for unknown destinations.
- Bind approval to the exact action so it cannot be replayed for a different one.
- Kill switch: env/file/admin endpoint with separate auth; **fail-closed** (if kill-state can't be
  read, refuse to mint); halts the rotation scheduler too; not agent-resettable.
- Rate limits / circuit breaker on all mutating actions.

## Done when
- A mutating call with no matching approval is refused; an approval for action A cannot authorize B.
- With kill-state unreadable, the broker refuses to mint (fail-closed test).
