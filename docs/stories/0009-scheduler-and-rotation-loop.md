---
Story: 0009
Status: DONE 2026-07-31 (logic; live rotation needs the providers)
---

# 0009 — Scheduler + the live self-maintaining rotation loop

**DONE 2026-07-31 (the loop logic; live rotation is gated on the providers).** A rotation cadence is set
at mint (`rotateEveryMs`); the broker tracks each secret's next-due time, `dueForRotation()` reports
what's due, and `runScheduledRotations()` rotates each **through the full gate** (kill switch → approval
→ NEVER_ROTATE → self-lockout) and reschedules on success. `InProcessScheduler` (`scheduler.ts`) ticks
the loop, suppressing overlapping ticks and `unref`-ing its timer. The broker owns the clock (ADR-0013).
Tested with an injected clock + fake providers. **The only thing between this and hands-free live
rotation is the live provider paths (0003–0005);** a Durable-Object-alarm scheduler for a Worker
deployment remains future work.

## Goal
Make rotation actually hands-free: a Scheduler abstraction that owns the clock, driving the live
`mint → place → verify → revoke` loop (ADR-0010, ADR-0013). This is the heart of the product objective.

## Tasks
- `Scheduler` abstraction: `InProcessScheduler`/systemd-timer for v1; a `DurableObjectAlarmScheduler`
  (at-least-once) for the later Worker deployment.
- Two-tier cadence: placed long-lived secrets rotate daily/on-drift; ephemeral creds by TTL expiry.
- Drive the persisted rotation state machine with a **dual-credential overlap window** and a
  **server-enforced minimum rotation interval**.
- Every rotate/revoke passes `assertMayRotate` (NEVER_ROTATE + self-lockout).
- Crash-resume: a tick that died mid-rotation resumes from the persisted state, never re-mints blindly.

## Done when
- A secret, once minted+placed with a rotation policy, stays fresh across scheduler ticks with zero
  human/AI action, and a killed mid-rotation tick resumes cleanly.
