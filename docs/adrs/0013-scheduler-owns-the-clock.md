---
Status: Accepted
Date: 2026-07-29
---

# 0013 — The scheduler owns the clock

## Context

Rotation must happen on a schedule with **zero** human or AI action — the loop the AI builds once has to run itself. That raises the question of *what holds the clock*: what process decides "it is time to rotate this secret" and actually triggers the mint.

The answer is constrained by a fact already established in ADR-0009: only the internal core holds the master keys, so only the core can mint. Any scheduler that lives elsewhere (a CI cron, an external timer service) can at most *ask* the core to act — it cannot be the authority, and wiring authority into an agent-reachable or externally-writable trigger reintroduces the excessive-agency problem the whole design exists to prevent.

## Decision

**The broker owns the rotation schedule.** Because it holds the keys and is the only thing that can mint, the clock lives with it. Scheduling is a `Scheduler` abstraction with swappable backends:

- **v1:** `InProcessScheduler` (a tick loop) or a **systemd timer** on the self-hosted host — simple, local, no external dependency.
- **Worker era:** `DurableObjectAlarmScheduler` — **at-least-once with automatic retry**, so a missed or crashed tick is re-fired rather than silently dropped. Rotation is idempotent through the persisted state machine (ADR-0010), so at-least-once is safe: a resumed tick continues mid-rotation instead of re-minting.

**Two-tier cadence**, following directly from ADR-0012:

- **Placed long-lived secrets** (a GitHub Actions secret, a Cloudflare Pages env var) rotate **daily**, or immediately on detected drift. Sub-daily churn is wasteful and needlessly widens the swap window.
- **Ephemeral / JIT credentials** (R2 Temporary Credentials, GitHub App installation tokens) "rotate" by **TTL expiry** — minutes to about an hour. The scheduler does not rotate these at all; expiry does.

That split is how the project delivers genuinely frequent rotation without churn: the long-lived tail rotates slowly and safely, and the ephemeral bulk refreshes continuously for free.

**GitHub Actions cron is a secondary self-trigger target, never the scheduler of record.** The broker may *emit* a cron workflow as one "place" output for a consumer that must self-trigger, but that cron is a downstream artifact — it holds no keys and does not decide the broker's schedule. The authoritative clock is always the broker's own `Scheduler`.

The scheduler also honors the safety envelope: it never enqueues a `NEVER_ROTATE` secret and never enqueues a self-lockout dependency (ADR-0010), and it halts on the fail-closed kill switch.

## Consequences

- The one thing that can mint is also the one thing that decides *when* to mint — no external or agent-reachable trigger can drive a live rotation.
- Swapping `InProcessScheduler` for `DurableObjectAlarmScheduler` is a backend change behind one interface; the rotation logic and its safety checks are unchanged.
- A self-hosted single-process scheduler is a single point of failure; the at-least-once Durable Object backend is the durability answer for the Worker era, not v1.
- Because the schedule lives in the broker, an AI-authored cadence change is subject to the same out-of-band human arming as any rotation policy (ADR-0010) — it cannot hot-apply a new clock.
