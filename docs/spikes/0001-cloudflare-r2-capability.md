---
Date: 2026-07-29
---

# Spike 0001 — Can Cloudflare mint scoped R2 credentials via API?

**Question.** Can secretsminter mint, scope, and revoke R2 (object storage) credentials entirely through
an API — and is there a short-lived variant that removes the need to rotate at all?

**Findings — CONFIRMED.**

1. **Minting an R2 API token.** Create an R2 API token via the Cloudflare API. The response carries
   the token's `value` **exactly once**. The S3-compatible credential pair a consumer actually uses is
   *derived*, and the derivation is the non-obvious part:
   - `accessKeyId` = the token's **id**
   - `secretAccessKey` = **`sha256_hex(token.value)`**

   We encode this once so no caller re-derives it by hand:
   `r2SecretAccessKeyFromToken` (`packages/core/src/crypto.ts`) and `r2S3Credentials`
   (`packages/providers/src/cloudflare.ts`, which returns the secret half wrapped in `SecretValue`).
   Both are pure and unit-tested — the piece of the Cloudflare flow that needs no network.

2. **Ephemeral-first: R2 Temporary Credentials.** Where a consumer can fetch credentials at use-time,
   Cloudflare issues **temporary credentials** — a scoped `accessKeyId` / `secretAccessKey` /
   `sessionToken` triple with a TTL. For these there is nothing to rotate; they self-expire. This is
   the honest path to "frequent rotation without upkeep" (ADR-0012) and the default we prefer.

3. **Bootstrap scope.** Minting requires a parent credential with `User → API Tokens → Edit`. That is a
   crown-jewel (SECURITY.md); least-privilege it to *create R2 tokens for allow-listed buckets only*,
   not account-wide.

**Consequences for the design.** Cloudflare is a first-class v1 provider. `CloudflareProvider`
(currently `NotWiredError`) will wire mint → the R2 token or temporary-credential path, `verify` → a
HEAD against the target bucket with the new credentials, and `revoke` → delete the old token. See
story 0003.
