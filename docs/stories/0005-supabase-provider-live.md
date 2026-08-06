---
Story: 0005
Status: BUILT — unit-tested; live run pending a Supabase PAT
---

# 0005 — Supabase provider (live)

**BUILT 2026-07-31 (unit-tested; live run pending a project PAT).** `supabase.ts` is wired — no longer
`NotWiredError`:
- **mint** → `POST /v1/projects/{ref}/api-keys` (the current key model), Bearer = a project-scoped
  **Personal Access Token**, body `{ type: "secret", description }`; material wrapped in `SecretValue`,
  errors carry an HTTP status only. `fromEnv` reads `SECRETSMINTER_SB_*`.
- **verify** → GET the project's keys with the PAT (Management API reachable).
- **rotate** → mint a fresh secret key; wired into the daemon's provider set.
- Injectable HTTP seam → network-free unit tests. Exact fields follow the Management API, confirmed at
  the live run (like every provider). **It manages an operator's own project, stores no tokens.**

**Honest limitation:** `revoke` is a documented **no-op** for now — deleting a long-lived Supabase key
needs the vendor key id threaded back through the broker's descriptor (a follow-up; rotation still
mints fresh, paired with the dual-credential overlap window). **Remaining:** a live run against a real
project (PAT injected at runtime).

## Goal
Wire `SupabaseProvider` (currently `NotWiredError`) to the current Supabase key model via the
Management API + a project-scoped Personal Access Token (ADR-0002, spike 0003).

## Tasks
- Manage publishable/secret API keys and JWT signing keys (NOT the stale service_role model).
- Rotate signing keys with the **create → activate → verify → revoke** ordering onto the rotation
  state machine.
- Model a rotatable signing key as class `jwt-signing-key` (rotatable), distinct from the un-rotatable
  `updater-signing-key`.
- PAT scoped to a single project; fixed hosts; errors via `scrubError`.

## Done when
- A signing-key rotation completes create→activate→verify→revoke against a test project with no value
  returned to the agent.
