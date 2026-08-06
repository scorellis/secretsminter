---
Status: Accepted
Date: 2026-07-29
---

# 0012 — Ephemeral-first credentials

## Context

The guiding philosophy is that nobody maintains anything — the AI builds a self-maintaining loop once and walks away. Rotation of a long-lived secret is genuine machinery: mint the new credential, place it, functionally verify it, revoke the old, hold a dual-credential overlap window, persist a resumable state machine (ADR-0010). It is safe, but it is *upkeep* — a scheduled process that must keep running correctly forever.

The cheapest maintenance is the maintenance that does not exist. If a consumer can fetch a credential at the moment it needs one, there is no long-lived secret sitting in a store waiting to be rotated, and the entire rotation apparatus is unnecessary for that credential.

## Decision

**Where a consumer can fetch credentials at use-time, mint short-lived, self-expiring credentials instead of placing a long-lived secret and rotating it.** Ephemeral-first is the default; place-then-rotate is the fallback for consumers that genuinely cannot fetch at use-time (e.g. a GitHub Actions secret a workflow reads from its environment).

Two v1 providers support this directly:

- **Cloudflare R2 Temporary Credentials** — a scoped `accessKeyId` / `secretAccessKey` / `sessionToken` triple with a TTL, minted for exactly the bucket and permissions the consumer needs. When the TTL lapses the credential is simply gone.
- **GitHub App installation tokens** — minted just-in-time from the App private key, valid roughly one hour. The App is installed only on allow-listed repositories, so the installation boundary is itself a least-privilege control.

For these, **the rotation problem dissolves.** There is nothing placed and nothing to revoke; "freshness" is a property of the TTL, not of a scheduled job. In the domain model these are the `ephemeral-cred` `SecretClass` — distinct from a long-lived `api-token`.

This is the honest path to the project's headline promise, "frequent rotation without upkeep": the rotation is not frequent, it is *continuous and free*, because the credential expires on its own between uses.

## Consequences

- Ephemeral credentials carry **no standing rotation obligation** — no state machine, no overlap window, no minimum-interval bookkeeping. The safest secret is one that no longer exists by the time an attacker finds it.
- A short TTL bounds the value of any leaked ephemeral credential to minutes, independently of value-blindness and the allow-list.
- The consumer must be able to call the broker (or a JIT mint endpoint) at use-time. Consumers that read a secret from a static environment cannot, and fall back to place-then-rotate (ADR-0010). Choosing the right path per consumer is a design step, not automatic.
- Ephemeral mints are higher-frequency, so the audit and rate-limit paths (ADR-0011, ADR-0009) must tolerate volume; the destination allow-list (ADR-0008) still gates *scope*, so a JIT mint cannot be widened by injection.
- The two-tier cadence follows from this split: placed long-lived secrets rotate on a schedule (ADR-0013), ephemeral creds "rotate" by expiry.
