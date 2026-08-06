---
Story: 0003
Status: DONE 2026-07-31 — live-verified against real Cloudflare
---

# 0003 — Cloudflare provider (live)

**DONE 2026-07-31 — live-verified.** A real end-to-end run passed against actual Cloudflare R2: from an
Admin R2 bootstrap token, secretsminter **minted R2 Temporary Credentials → verified them with a signed S3
HEAD → PASS**, and the minted material self-redacted (`JSON.stringify` → `[REDACTED]`) — value-blindness
proven live, no credential returned to the caller. (Also confirmed the crown-down containment: an
`Object Read & Write` leaf token can use the bucket but returns 403 on minting — only an Admin/tier-up
token can mint.) The throwaway bootstrap was burned after the run.

`CloudflareProvider`
(`cloudflare.ts`) is wired — no longer `NotWiredError`:
- **mint** → `POST /accounts/{id}/r2/temp-access-credentials` (ephemeral-first): Bearer = the R2 API
  token value, `parentAccessKeyId` = its Access Key ID, returns scoped temp creds; material wrapped in
  `SecretValue`, errors carry a status code only (never the body).
- **verify** → a real signed **S3 HEAD** against the bucket (aws4fetch SigV4) with the minted creds.
- **rotate** → mint fresh temp creds; **revoke** → no-op (they self-expire).
- HTTP + S3 steps are injectable seams → 11 network-free unit tests; `CloudflareProvider.fromEnv`
  reads the bootstrap from `SECRETSMINTER_CF_*`.

**Remaining:** a real end-to-end run. `node scripts/live-cloudflare.mjs` does mint→verify against a live
bucket once a `.env` with a throwaway bucket-scoped R2 token is present (see [`../USING.md`](../USING.md)).
Honest line: the code + fakes are proven; **it has not yet minted a real credential.**

## Goal
Wire `CloudflareProvider` (currently `NotWiredError`) to mint/rotate/revoke/verify R2 credentials,
preferring ephemeral R2 Temporary Credentials where a consumer can fetch at use-time (ADR-0012, spike
0001).

## Tasks
- `mint` — create an R2 API token (or temporary credentials); return material wrapped in `SecretValue`,
  the S3 pair derived via `r2S3Credentials`.
- `verify` — a real HEAD against the target bucket with the new credentials (not "the API returned 200").
- `revoke` — delete the old token; non-fatal terminal step of the rotation machine.
- Fixed outbound host constants (no SSRF); all errors passed through `scrubError`.

## Done when
- An end-to-end mint → place → verify → revoke against a throwaway token succeeds, and the broker
  returns no value at any step.
- Temporary-credential path exercised and shown to self-expire.
