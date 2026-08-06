---
Story: 0019
Status: active — NOT BUILT
---

# 0019 — Live-verify a GitHub Actions place end-to-end

**NOT BUILT.** The GitHub provider + Actions store (`github.ts`, story 0004) are complete code paths,
unit-tested against fakes (including an RSA-signed App JWT and a sealed-box placement), but have **not
yet been run against the live vendor**. A real end-to-end run is the shortest proof of the project's
wedge: value-blind **mint → place → verify** into a real repo's Actions secrets.

## Goal
One green live run: mint a short-lived GitHub App installation token, place a secret into a **test
repo's Actions secrets** via a libsodium sealed box, and verify — with no secret value ever leaving the
broker.

## Tasks
- Stand up a throwaway GitHub App installed on a single test repo (allow-listed in the signed manifest).
- Inject the App id / installation id / private key via the broker env (never committed, never in chat).
- Run `mint_and_place` targeting `github-actions` on the test repo; confirm the secret appears in the
  repo's Actions secrets and the value never appears in any log, error, or transcript.
- Record the run (date, that it passed, that the material self-redacted) in story 0004 and the README
  status table — one green run, not a security audit.

## Done when
- A secret is placed into a real test repo's Actions secrets, verified, and the plaintext demonstrably
  never left the broker.
- A placement to a non-allow-listed repo is refused before any network call.
