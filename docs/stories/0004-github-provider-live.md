---
Story: 0004
Status: BUILT — unit-tested; live run pending a GitHub App
---

# 0004 — GitHub provider (live)

**BUILT 2026-07-31 (unit-tested; live run pending a GitHub App).** `github.ts` is wired — no longer
`NotWiredError`:
- **`GithubProvider`** — mints short-lived **App installation tokens** (~1h): builds an RS256 App JWT
  (`makeAppJwt`, pure/tested), exchanges it for an installation token; rotate = re-mint; revoke = no-op
  (self-expire); verify = an authenticated API call. `fromEnv` reads `SECRETSMINTER_GH_*` (PEM newlines
  restored).
- **`GithubActionsStore`** — places a secret into a repo's Actions secrets **value-blind** via a
  libsodium **sealed box**: GET the repo public key → seal → PUT ciphertext. The plaintext only ever
  reaches the sealer; only ciphertext is transmitted.
- HTTP + seal are injectable seams → network-free unit tests (incl. an RSA-signed JWT verified with the
  public key). **It manages a *target* repo (e.g. `acme/api`), never secretsminter's own** —
  secretsminter stores no tokens and has no Actions of its own.

**Remaining:** a live run against a real GitHub App (mint an installation token → place a secret →
verify), gated on the App private key + installation id (injected at runtime, never committed).

## Goal
Wire `GithubProvider` (currently `NotWiredError`) to mint App installation tokens and place Actions
secrets via a libsodium sealed box (ADR-0003, spike 0002).

## Tasks
- Mint an installation token (~1h) from the App private key just-in-time (ephemeral, ADR-0012).
- Place a secret: `GET` the repo public key → sealed-box encrypt → `PUT` the ciphertext + key id.
- `verify` — call an authenticated API with the new token.
- Enforce that the target repo passes `assertAllowed` before any `PUT`; App installed only on
  allow-listed repos.

## Done when
- A secret is placed into a test repo's Actions secrets, verified, and the plaintext never leaves the
  broker.
- A placement to a non-allow-listed repo is refused before any network call.
