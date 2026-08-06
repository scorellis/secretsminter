---
Story: 0010
Status: DONE 2026-07-31
---

# 0010 — Durable broker state (survive a restart)

**DONE 2026-07-31.** For "give it the token once and walk away," the broker must survive a restart —
otherwise a restart forgets what it manages and the self-maintaining loop stops. Built:

- **`state-store.ts`** — a `StateStore` (`load`/`save`) over a **value-free** `BrokerState` (managed
  `SecretDescriptor`s + the rotation schedule; **no secret material** — so persisting it doesn't
  violate value-blindness). `FileStateStore` (JSON, injectable fs seam, defensive load → `null` on
  missing/unparseable/malformed) + a non-durable `InMemoryStateStore` default.
- **Broker wiring** — loads state on construction (`#restore`) and persists after every registry/
  schedule change (`#persist` on mint / rotate / revoke).

Tested: a fresh broker on the same store **restores the managed-secret registry + schedule** (a
restart keeps rotating); the persisted file **never contains secret material**; the in-memory default
does not survive across instances.

## Why it matters
This is one of the three integrations that turn "engine on the test stand" into "set it and forget
it": **durable state** (this), a concrete **Store** to place into (0004), and a **running daemon**
(the runner). With state durable, the scheduler can tick across restarts without losing the loop.
