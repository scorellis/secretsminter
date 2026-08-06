---
Story: 0013
Status: DONE 2026-08-05 — env-write + daemon-wired + live-run; redeploy-and-reconcile (ADR 0004) built: CloudflarePagesStore.activate triggers + awaits a deployment, broker calls it after place and before verify
---

# 0013 — Cloudflare Pages env-var place

> **2026-08-05 deep-review remediation.**
> - *Finding 1 (daemon wiring) — FIXED:* `CloudflarePagesStore` is now registered in
>   `packages/daemon/src/build.ts` (guarded on its bootstrap env), so `mint_and_place` can target
>   `cloudflare-pages` through the daemon/MCP path, not only the runner script. `buildBroker` now returns
>   `stores`, covered by a new daemon test.
> - *Finding 2 (ADR 0004 completeness) — RESOLVED 2026-08-05:* placement now triggers **and awaits** a
>   redeploy. `CloudflarePagesStore.activate(target)` POSTs a fresh production deployment and polls it to
>   a terminal state (returns on `deploy:success`; a failed/canceled deploy or a timeout throws). The
>   broker calls `store.activate` (if present) **after `place` and before `verify`**, so `verify` probes
>   the consumer-visible state — never a false-fresh secret while the old deployment still serves. Covered
>   by store-level tests (trigger URL/auth, poll-to-success, failure, status-only leak-safety, timeout)
>   and broker-level ordering tests (place→activate→verify; activation-failure is not false-fresh;
>   activate-less stores still succeed). Story promoted PARTIAL → DONE.

**PARTIAL — env-write built + unit-tested; daemon-wired 2026-08-05; one live run 2026-08-05.** A new
`Store` that PLACES environment variables into a Cloudflare Pages project — the analog of
`GithubActionsStore`, but for Pages. The concrete use: set a Pages project's deployment vars (a project
URL as `plain_text` plus one or more API keys as `secret_text`) hands-free.

`CloudflarePagesStore` (`packages/providers/src/cloudflare-pages.ts`):
- **`place(target, secret)`** — writes a **`secret_text`** env var (the value-blind Store-interface
  method); the value lives in `secret.material` (a `SecretValue`) and is exposed only into the request body.
- **`placePlain(target, value)`** — writes a **`plain_text`** env var (a non-secret, e.g. a URL). A
  separate method precisely because the value is not value-blind material — the type carries that fact.
- Both `PATCH https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects/{project_name}`
  with body `{ deployment_configs: { <production|preview>: { env_vars: { <NAME>: { type, value } } } } }`.
- Auth: `Authorization: Bearer <token>`. Fixed outbound host (no SSRF). Injectable `HttpFn` seam → 12
  network-free unit tests.
- `fromEnv` reads `SECRETSMINTER_CF_PAGES_TOKEN` + `SECRETSMINTER_CF_ACCOUNT_ID`; the **project comes
  from `target.project`** (like `GithubActionsStore` requires `target.repo`), so it is constrained by the
  same signed allow-list (`assertAllowed`) the core runs before any `place`. The environment is a closed
  set — `production` | `preview` only — never an arbitrary config key.

**Value-blindness.** A secret value lives only in a `SecretValue`; it is written into the PATCH body
(that is its destination) but NEVER into a log line or a thrown error. On an HTTP failure the error
carries a **status code only** — never the response body. Any thrown network error is passed through
`scrubError` so a value a client inlined into a message cannot escape.

**How pre-existing secrets enter (important).** A secret that already exists (i.e. is NOT minted here)
must enter via the **broker environment** (`process.env`), never as a caller/agent-supplied argument in
a transcript. The runner reads it from env and wraps it in a `SecretValue`; nothing is ever pasted into
chat.

## Runner
`scripts/example-place-pages-env.mjs` (a generic template, mirrors `scripts/live-cloudflare.mjs`) reads
from env:
- `SECRETSMINTER_CF_ACCOUNT_ID`
- `SECRETSMINTER_CF_PAGES_TOKEN` — the Pages API token VALUE (Bearer)
- `SECRETSMINTER_CF_PAGES_PROJECT` — the Pages project name (e.g. `example-web`)
- `MY_PLAIN_VAR` — placed as `plain_text`
- `MY_SECRET_1` — placed as `secret_text`
- `MY_SECRET_2` — placed as `secret_text`

It PATCHes each into the project and prints only `<NAME>: ok|FAILED` per var — never a value. A missing
var is named (by NAME), never its contents. Adapt the `VARS` list to your own project. Run:
`npm run build && node scripts/example-place-pages-env.mjs`.

## Required CF token scope
A Cloudflare API token with **Account → Cloudflare Pages → Edit** (the throwaway is created for the run
and can be revoked after). This is the only scope needed to update a Pages project's env vars.

## CAVEAT — effective on next deployment
Cloudflare applies a Pages env-var change on the **NEXT deployment**; an already-running deployment is
unchanged. After this runs, trigger a redeploy (or push) for the vars to take effect.

## Done when
- An end-to-end run against a real Pages project sets the vars (verified in the dashboard /
  next deployment), the runner prints only per-var ok/failed, and no value is echoed at any step.

**Honest line:** the code + fakes are proven (12 unit tests, value-blindness asserted) and the
env-write path had a live run on 2026-08-05; **redeploy-and-reconcile (triggering + awaiting the deploy
that makes the vars consumer-visible) is still a follow-up** (see the story ledger).
