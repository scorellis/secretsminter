# Manual steps — the ledger

The point of secretsminter is that **neither a human nor an AI has to see or handle a token.** But you
cannot bootstrap trust from nothing: creating an API credential requires *some* prior authority. So the
honest promise is not "zero manual steps ever." It is:

> **Rotate from the crown down. The only credential that exists outside the first roll is the human
> account login; everything below it — including the broker's own bootstrap token — rotates itself
> automatically, each elimination proven by a test.**

This ledger is that accounting. Every place a human could touch a secret is listed and classified.
Project rule: **each `ELIMINATED` row is backed by a named test** — a regression that
reintroduces manual toil fails CI. The tests live in
[`packages/core/test/no-manual-steps.test.ts`](../packages/core/test/no-manual-steps.test.ts).

## ✅ ELIMINATED — toil removed, proven by a test

| # | The manual step this replaces | How it's automated | Proving test |
| --- | --- | --- | --- |
| E1 | Creating a new credential by hand in a dashboard | `Broker.mintAndPlace` mints it; the value is never handed to a human or the agent | `E1 …` |
| E2 | Copying a secret into the place it's consumed | the `Store.place` step (e.g. sealed-box into a GitHub Actions secret) | `E2 …` |
| E3 | Manually checking a new credential works before switching to it | the functional `verify` probe, structurally required before revoke | `E3 …` |
| E4 | Remembering to rotate a secret on a schedule | `runScheduledRotations` rotates every due secret through the full gate | `E4 …` |
| E5 | Cleaning up (revoking) the old credential after rotating | the rotation loop revokes only after the new one verifies | `E5 …` |
| E6 | Re-issuing a short-lived credential when it expires | ephemeral-first: the credential self-expires and the loop re-mints | `E6 …` |

## 🔑 THE ONE IRREDUCIBLE ROOT — rotate from the crown down

**Philosophy: rotate from the crown down.** The *only* credential that exists
outside the very first roll is the one that logs a **human into the vendor account** — the GUI "god"
login. Everything below it, **including the broker's own bootstrap API token, is machine-rotatable.**

| # | The single irreducible secret | Why | Everything below it |
| --- | --- | --- | --- |
| B1 | The **human account login** — account password + MFA / passkey, giving GUI god rights | you cannot mint an API credential over the API with *no* prior authority. Vendors (Cloudflare, GitHub, Supabase) require a **human GUI session** to create the *first* API token. So: one human login, used **once** to plant token #1, then kept only for break-glass. | *(the crown token, and everything under it, rotates automatically — see below)* |

**There is no "irreducible bootstrap *token*."** The broker's bootstrap API token (the crown jewel it
actually holds — e.g. an R2 `Admin` / `API-Tokens-Edit` token) rotates itself via **make-before-break**:

> mint a new equal-privilege token → plant it where the broker reads it → **verify** the broker works
> on the new one → *then* roll/revoke the old.

Do it in that order and even the crown rotates safely. The **self-lockout guard** (guard.ts) blocks only
the *naive* ordering — revoking the in-use credential *before* the replacement is live and verified,
which self-bricks. It never freezes the root; it enforces make-before-break. So from the crown token
down — bootstrap token → the credentials it mints → the ephemeral creds those become — **it all
rotates**, and the only thing a human ever touches is the account login (B1).

A leaf credential proves the containment: an `Object Read & Write` R2 token can *use* a bucket but
**cannot mint** new credentials (Cloudflare returns 403) — minting is a privileged, one-tier-up
operation. That is the crown-down hierarchy made concrete, and it is why secretsminter hands out leaves,
never the crown.

For the throwaway dev test, the bootstrap is a `.env` paste — a convenience, not the steady state. In
production the crown token is **injected by a secret manager / workload identity**, and it rotates
itself from the account login down. See [`USING.md`](USING.md).

## 🛑 DELIBERATE CONTROL — manual *on purpose* (a feature, not toil)

| # | The manual step | Why it stays manual | Proving test |
| --- | --- | --- | --- |
| C1 | Approve a sensitive action | a human decision is the control against a prompt-injected agent | `C1 …` |
| C2 | Engage the kill switch | an operator's out-of-band halt must not be agent-reachable | `C2 …` |
| C3 | Rotate/truncate `secretsminter.log` | operator log hygiene; append-only by design (see [`AGENTS.md`](../AGENTS.md)) | — (documented) |

## The direction of travel

A healthy secretsminter only ever **moves rows up into `ELIMINATED`** (or keeps them as deliberate
controls). It never grows the bootstrap column. If a change adds a new recurring manual token-handling
step, that's a regression — write the test that eliminates it instead.
