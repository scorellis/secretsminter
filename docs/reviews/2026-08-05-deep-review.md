# Deep Review — 2026-08-05

Baseline

- Scope reviewed: commit `92bc6ed` (`Rename secsminter → secretsminter across the repo`) through `2773da7` on branch `chore/rename-to-secretsminter`.
- Filesystem note: the folder is still `secsminter`, but the product/tool naming in code has been renamed to `secretsminter`.

Findings

1. High — Cloudflare Pages placement is advertised through the daemon/MCP path, but the daemon never wires the `cloudflare-pages` store.

   Evidence:
   - `packages/mcp/src/server.ts:20` accepts `cloudflare-pages` in the public MCP schema.
   - `docs/USING.md:95` tells operators to allow `cloudflare-pages` destinations in the signed manifest.
   - `packages/daemon/src/build.ts:86-91` creates the store map but only registers `github-actions`.

   Why this matters:
   - Agent-driven `mint_and_place` requests can target `cloudflare-pages`, but the broker cannot resolve the store when running through the daemon assembly path.
   - The story therefore works only via the ad hoc runner script, not through the main daemon/MCP workflow the repo documents.

   Validation:
   - Focused tests passed: `packages/providers/test/cloudflare-pages.test.ts`, `packages/daemon/test/daemon.test.ts`.
   - A broker-level exercise with a signed allow-list and approval entry still returned `reason: "provider-not-wired"`, confirming the daemon path does not expose the new store.

2. Medium — Story 0013 is claimed as built, but the implementation still stops short of the placement contract defined by ADR 0004.

   Evidence:
   - `docs/adrs/0004-store-abstraction.md:19` says a `cloudflare-pages` placement is not complete until a redeploy is triggered and awaited.
   - `docs/adrs/0004-store-abstraction.md:26` repeats that verification for Pages means after the redeploy.
   - `scripts/example-place-pages-env.mjs` reports success immediately after PATCH and tells the operator to trigger a redeploy manually.
   - `docs/stories/README.md:20` marks story 0013 as `BUILT — unit-tested; live run pending a Pages API token`.

   Why this matters:
   - The repo’s own contract says Pages placement is unfinished until the new deployment is the live consumer-visible state.
   - As implemented, the code updates the env vars but does not trigger or await the deploy that makes them effective.

What I checked

- Reviewed the `92bc6ed..2773da7` delta with emphasis on `packages/providers/src/cloudflare-pages.ts`, daemon assembly, MCP schema, and the operator script.
- Ran focused Vitest coverage for the new store and daemon wiring slice.
- Performed an end-to-end broker exercise against the built daemon path to distinguish policy denial from missing store wiring.

Recommended follow-up

1. Register `CloudflarePagesStore` in `packages/daemon/src/build.ts` and add a broker/daemon integration test that reaches it through `mint_and_place`.
2. Either implement redeploy-and-reconcile for Pages placement or downgrade the story/docs claim until that step exists.