---
Date: 2026-07-29
---

# Spike 0002 — GitHub App installation tokens + placing Actions secrets

**Question.** Can secretsminter authenticate to GitHub with a short-lived, narrowly-scoped credential
(not a long-lived Personal Access Token), and place a secret into a repository's Actions secrets
value-blind?

**Findings — CONFIRMED.**

1. **Short-lived auth via a GitHub App.** A GitHub App has a private key. From it the broker mints an
   **installation token** (~1 hour lifetime) just-in-time. This is itself an ephemeral credential
   (ADR-0012) — no PAT to store or rotate. The App private key is the durable crown-jewel; the
   installation tokens derived from it are disposable.

2. **Least privilege by installation.** The App is granted `Secrets: read/write` + `Metadata: read`
   and is **installed only on allow-listed repositories.** The installation boundary itself is a
   least-privilege control: the broker cannot touch a repo the App isn't installed on.

3. **Placing an Actions secret (value-blind).** GitHub requires the secret encrypted with the repo's
   public key:
   - `GET /repos/{owner}/{repo}/actions/secrets/public-key`
   - encrypt the value with a **libsodium sealed box** (crypto_box_seal)
   - `PUT /repos/{owner}/{repo}/actions/secrets/{name}` with the base64 ciphertext + the key id.

   The plaintext never leaves the broker; only ciphertext is transmitted, and nothing is returned to
   the agent.

**Consequences for the design.** GitHub is both a **provider** (mint installation tokens) and a
**store** (place Actions secrets), which is exactly why the `Provider`/`Store` split exists (ADR-0002,
ADR-0004). `GithubProvider` (currently `NotWiredError`) wires this in story 0004; the destination repo
must pass the allow-list (`assertAllowed`) before any `PUT`.
