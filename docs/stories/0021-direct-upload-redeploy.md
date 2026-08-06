---
Story: 0021
Status: DONE 2026-08-06 — project-type detection + RedeployHook + githubWorkflowDispatchHook; activate() now redeploys direct-upload Pages projects and awaits the fresh deployment; daemon env-wired
---

# 0021 — Direct-upload Pages redeploy (close the redeploy-and-reconcile gap)

**DONE 2026-08-06.** Fulfills and extends **[ADR 0004](../adrs/0004-store-abstraction.md)**: the
`cloudflare-pages` placement obligation ("effective on next deploy, so placement is not complete until a
redeploy is triggered and awaited") now holds for **direct-upload** Pages projects, not only
Git-connected ones. This closes the direct-upload gap surfaced by the **2026-08-06 dogfood**, where
`CloudflarePagesStore.activate()` failed because `example-web` is a direct-upload project.

## Problem
A **direct-upload** Cloudflare Pages project — deployed by GitHub Actions running
`wrangler pages deploy`, with **no Git connection** — cannot be rebuilt through the Cloudflare API. The
prior `activate()` only knew how to rebuild **Git-connected** projects: it `POST`ed a fresh production
deployment (`POST .../pages/projects/{project}/deployments`) and polled it to a terminal state. Against a
direct-upload project that endpoint has no source to build from, so `activate()` failed — and with it the
redeploy-and-reconcile obligation from ADR 0004. `example-web` is exactly such a project, so the
2026-08-06 dogfood could set the env vars (story 0013's `place`/`placePlain`) but could **not** make them
consumer-visible hands-free.

## Solution
`CloudflarePagesStore.activate(target)` now **detects the project type and branches**:

1. **`GET .../pages/projects/{project}`** to read the project, then inspect its source/deployment
   configuration to classify it as **Git-connected** or **direct-upload**.
2. **Git-connected** → unchanged: `POST` a fresh production deployment and poll it to a terminal state
   (returns on `deploy:success`; a failed/canceled deploy or a timeout throws) — the original ADR 0004
   path.
3. **Direct-upload** → fire a configured **`RedeployHook`**, then **await the fresh Pages deployment via
   the CF API** (the same terminal-state reconcile, so `verify` still probes consumer-visible state — no
   false-fresh secret while the old deployment serves). The one hook implementation is
   **`githubWorkflowDispatchHook`**, which `POST`s a GitHub Actions **`workflow_dispatch`** to re-run the
   workflow that redeploys the project.
4. **Direct-upload with no hook configured** → throws a **clear, actionable error** naming the missing
   redeploy wiring, rather than silently reporting success or failing opaquely.

The reconcile step (await a fresh terminal deployment) is shared by both branches, so ADR 0004's rule
that a Pages placement is unfinished until a redeploy is triggered **and awaited** holds regardless of
project type.

## Env wiring (daemon)
A direct-upload dogfood configures the redeploy trigger through the broker environment (never in chat):

- `SECRETSMINTER_PAGES_REDEPLOY=github` — selects the `githubWorkflowDispatchHook`.
- `SECRETSMINTER_PAGES_REDEPLOY_GH_OWNER` — GitHub repo owner.
- `SECRETSMINTER_PAGES_REDEPLOY_GH_REPO` — GitHub repo name.
- `SECRETSMINTER_PAGES_REDEPLOY_GH_WORKFLOW` — the workflow file/id to dispatch.
- `SECRETSMINTER_PAGES_REDEPLOY_GH_REF` — git ref to dispatch against (default `main`).
- `SECRETSMINTER_PAGES_REDEPLOY_GH_TOKEN` — a GitHub token with **`actions: write`** (the only scope the
  `workflow_dispatch` needs; a throwaway can be revoked after the run).

The token value enters via the broker environment (`process.env`) and is used only to authorize the
`workflow_dispatch` POST — never logged, never placed on a `ToolResult`, consistent with the value-blind
posture of the rest of the pipeline.

## Relationship to ADR 0004
ADR 0004 defined placement as a pluggable `Store` write step and made `cloudflare-pages` a placement that
"is not complete until a redeploy is triggered and awaited." Story 0013 built the first cut of that
(trigger + await, for the Git-connected rebuild path). This story completes the obligation for the second
Pages topology — direct-upload — without editing the write-once ADR: the decision is unchanged; the
implementation now covers both project types. (ADRs are write-once; this story is the extension record.)

## Done when
- `activate()` GETs the project, classifies Git-connected vs direct-upload, and takes the correct branch
  — **met.**
- Direct-upload path fires the configured `RedeployHook` (`githubWorkflowDispatchHook`) and awaits the
  fresh CF deployment to a terminal state before returning — **met.**
- A direct-upload project with no hook configured throws a clear, actionable error — **met.**
- Daemon reads the `SECRETSMINTER_PAGES_REDEPLOY*` env and wires the hook — **met.**

**Honest line:** the branch selection, the direct-upload hook path, the no-hook error, and the
await-fresh-deployment reconcile are built and tested. This is the redeploy trigger a real direct-upload
dogfood (example-web) needs; a full live end-to-end direct-upload redeploy remains the confirming run.
