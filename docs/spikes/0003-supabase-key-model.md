---
Date: 2026-07-29
---

# Spike 0003 — Supabase key model (and a correction to an outdated assumption)

**Question.** How does secretsminter mint and rotate Supabase credentials through an API?

**Findings — CONFIRMED, with an explicit correction.**

**The stale assumption.** Early planning referred to "rotating the `service_role` key." That model is
**out of date.** Do not build against it.

**The current (2026) model:**

1. **API keys** come in two kinds — **publishable** keys (safe to expose in a client) and **secret**
   keys (server-only). These replace the older anon/service_role split.
2. **JWT signing keys** are asymmetric and rotate through a **create → activate → revoke** lifecycle.
   That lifecycle maps cleanly onto secretsminter's rotation state machine
   (`mint → place/activate → verify → revoke`, ADR-0010): the new key is created and activated, the
   consumer verified against it, and only then is the old key revoked.
3. **Management surface.** Both are managed via the **Supabase Management API**, authenticated with a
   **Personal Access Token (PAT)**. The PAT is a crown-jewel bootstrap credential (SECURITY.md);
   scope it to a **single project**, never an org-wide token.

**A note on `NEVER_ROTATE`.** A JWT signing key is *rotatable* here (that's the point of the
create/activate/revoke lifecycle), so it is class `jwt-signing-key`, **not** the un-rotatable
`updater-signing-key` class. Only a key whose public half is baked into already-shipped artifacts is
`NEVER_ROTATE` (never-rotate.ts). Keep that distinction sharp when modelling Supabase keys.

**Consequences for the design.** `SupabaseProvider` (currently `NotWiredError`) wires the Management
API + PAT path in story 0005, using the create/activate/revoke ordering for signing keys.
