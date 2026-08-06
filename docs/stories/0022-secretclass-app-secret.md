---
Story: 0022
Status: DONE 2026-08-06
---

# 0022 — A `SecretClass` for symmetric app/HMAC secrets

**DONE 2026-08-06 — built + tested.** Added a first-class `SecretClass` (`app-secret`) for a **symmetric app/HMAC secret** (e.g. a
download-signing secret), so the local mint provider (story 0020) can label what it mints precisely
instead of borrowing `api-token`.

## The gap
The `SecretClass` union (`packages/core/src/types.ts`) is today:

- `api-token` — e.g. a Cloudflare R2 API token.
- `ephemeral-cred` — short-lived, self-expiring (R2 Temporary Credentials, GH installation token).
- `jwt-signing-key` — rotatable asymmetric signing key (e.g. Supabase): create → activate → revoke.
- `updater-signing-key` — crown jewel: public half baked into shipped builds. **NEVER rotate.**

There is **no class for a symmetric app/HMAC secret** — a shared random secret an app uses for HMAC
signing (a download-link signing secret, a webhook secret, a cookie/session key). Yet
`LocalSecretProvider` (story 0020) exists precisely to **mint exactly those** — random symmetric material
from the CSPRNG, value-blind. Today such a secret is labeled **`api-token`** as a stopgap: honest that
it's an opaque credential, but **imprecise** — it isn't a vendor API token, and mislabeling it muddies
audit-by-class and rotation-by-class semantics (a report or policy that reasons over `SecretClass` can't
distinguish a real vendor token from a locally-minted HMAC secret).

## Proposal
Add a class such as **`app-secret`** (or `hmac-signing-key`) to the `SecretClass` union to name symmetric
app/HMAC material, and thread it through everywhere `SecretClass` is enumerated/validated:

- `packages/core/src/types.ts` — extend the union with the new class + a doc comment ("symmetric
  app/HMAC secret minted locally, e.g. a download-signing secret; rotatable").
- `packages/mcp/src/server.ts` — add it to the `secretClass` Zod enum so `mint`/`plan` accept it.
- **Rotation-by-class logic** (`packages/core/src/never-rotate.ts`, `NEVER_ROTATE_CLASSES`) — decide and
  encode its rotation posture. A symmetric app/HMAC secret is **rotatable** by default (rotate = mint
  fresh + overwrite at the destination, the story-0020 flow), so it should **not** join
  `NEVER_ROTATE_CLASSES`. The one nuance: a symmetric secret that is baked into shipped artifacts (an
  updater-style crown jewel) would still be gated — but that is captured by `updater-signing-key` /
  `NEVER_ROTATE_NAMES`, not by this class. This story's job is to make the class exist and enforce it
  where class-based policy is relevant, so `NEVER_ROTATE_CLASSES` explicitly does the right (rotatable)
  thing for it.

## Why it matters
- **Audit-by-class:** an audit that groups secrets by class can distinguish vendor API tokens from
  locally-minted app secrets — a real difference in blast radius and revocation semantics (a `local`
  secret has no vendor to revoke at; see story 0020's honest `revoke` = no-op).
- **Rotation-by-class:** policy that keys on `SecretClass` (the `NEVER_ROTATE_CLASSES` path) can reason
  about app/HMAC secrets on their own terms instead of inheriting `api-token`'s.
- **Honesty:** removes the `api-token` stopgap that story 0020 has to lean on to describe download-signing
  and webhook secrets.

## Done when
- The new `SecretClass` exists in the core union with a doc comment, and is accepted by the MCP
  `secretClass` enum (`mint`/`plan`).
- The `NEVER_ROTATE_CLASSES` decision for it is encoded (rotatable — not in the never-rotate class set)
  and covered by a test alongside the existing `jwt-signing-key` (rotatable) and `updater-signing-key`
  (never-rotate) cases.
- Story 0020's local-minted app/HMAC secrets are labeled with the new class instead of `api-token`.
