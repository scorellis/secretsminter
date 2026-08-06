# 0003 — Authenticate to GitHub via a GitHub App, not a PAT

Status: Accepted
Date: 2026-07-29

## Context

The GitHub provider (`packages/providers/src/github.ts`) needs to place Actions secrets into repositories. The obvious path is a Personal Access Token (PAT), but a PAT is the wrong instrument for a broker that mints and places live credentials on an agent's behalf:

- A PAT is long-lived. If it leaks — and this process is deliberately exposed to a possibly prompt-injected agent — it stays valid until a human notices and revokes it.
- A classic PAT's scopes are coarse and account-wide; even a fine-grained PAT is bound to a user, so its blast radius follows that user's access rather than a declared, minimal target set.
- A PAT is a standing bearer credential the broker must store at rest, exactly the crown-jewel concentration ADR-0009 works to reduce.

## Decision

Authenticate to GitHub via a **GitHub App**, exchanging the App's private key for a **short-lived installation token (~1 hour)** minted just-in-time for each operation.

- **App permissions are minimal:** `Secrets: read/write` + `Metadata: read`. Nothing else.
- **The installation boundary is a least-privilege control.** The App is installed *only on allow-listed repositories*. An installation token can act on nothing outside the repos the App is installed on — a structural limit independent of, and in addition to, the manifest allow-list (ADR-0008). Directing a secret at `attacker/evil` fails twice: the manifest denies it, and no installation covers it.
- **The App private key is a crown-jewel bootstrap credential** held only by the core, agent-un-rotatable, self-excluded from rotation via the self-lockout guard (`packages/core/src/guard.ts`) and `NEVER_ROTATE` (ADR-0010). It rotates out-of-band by a human path.
- **Placement uses a libsodium sealed box.** GET the repo's Actions public key, encrypt the value with a libsodium sealed box, then `PUT /repos/{owner}/{repo}/actions/secrets/{name}` with the base64 ciphertext and key id. The plaintext value never leaves core memory and never touches disk or argv (ADR-0001).

## Consequences

The worst case from a leaked GitHub credential shrinks from "a long-lived, user-scoped PAT" to "a ~1-hour token scoped to two permissions on a fixed set of repos." Revocation is largely automatic — tokens expire on their own. The cost is bootstrap complexity: an App must be created, its private key custodied as a master key, and installations managed as the allow-list changes (an out-of-band, human step, consistent with ADR-0008). The installation token is itself a short-lived minted credential, so GitHub fits the ephemeral-first posture (ADR-0002 `supportsEphemeral: true`).
