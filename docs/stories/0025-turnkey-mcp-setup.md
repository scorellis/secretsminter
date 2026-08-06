---
Story: 0025
Status: DONE 2026-08-06 — daemon `--env-file`/auto-`.env` loading; `init` writes `<dir>/.env` + emits a resolvable `claude mcp add … node <abs cli.js> --env-file …` line + `.mcp.json` (no global install needed); USING §5 + README Quickstart rewritten copy-paste-exact with a troubleshooting block; verified end-to-end by following the docs literally.
---

# 0025 — Turnkey MCP setup (`.env` loading + `init` emits the registration) + crystal-clear deploy docs

MCP servers are notoriously hard to get running, and today secretsminter has the classic last-mile gap:
the daemon reads `process.env` only (no `.env` loading), and nothing tells the operator the exact command
to register the server with their MCP client — so a newcomer must hand-roll a launcher (as we did on
2026-08-06). This story removes that friction and makes the deploy instructions foolproof.

## Build

### 1. Daemon loads a `.env` (no launcher needed)
`packages/daemon/src/cli.ts` (serve path) + a small helper:
- Support **`--env-file <path>`** on the `secretsminter` (serve) command: before `configFromEnv`, read the
  file and set each `KEY=VALUE` into `process.env` **only if not already set** (never clobber a real env
  var). Reuse the simple parser we already use in scripts (regex `^([A-Z0-9_]+)\s*=\s*(.*)$`, skip blanks/#).
- Also **auto-load `./.env`** from cwd if present and no `--env-file` given. Missing file = silently skip.
- Human line to stderr: `loaded N vars from <path>` (never print a value).
- Keep `init`/`allow` unaffected (they don't serve).

### 2. `secretsminter init` prints the exact registration
After scaffolding, `init` prints (stderr) a **ready-to-paste** MCP registration for the common client,
with absolute paths filled in from `--dir`:
- a `claude mcp add` one-liner:
  `claude mcp add secretsminter -- secretsminter --env-file <ABS>/.env` (plus a note to also point at the
  manifest/approvals/state via env, or that those come from the same `.env`);
- a `.mcp.json` snippet block (the generic MCP-client shape) with the `command`, `args`, and the
  `SECRETSMINTER_MANIFEST/_SIG/_PUBKEY/_APPROVALS/_STATE/_AUDIT_LOG` env pointed into the dir;
- the reminder that **the client must reload** to connect, and that mutations need an out-of-band approval.

### Tests
- `--env-file` populates `process.env` for unset keys, does NOT clobber set keys, tolerates a missing file,
  ignores blanks/comments. (Pure, injectable fs — mirror the init tests.)
- `init` output includes the `claude mcp add` line and a `.mcp.json` snippet with the dir's paths.
- `npm run build` + `npm test` green.

## Docs (crystal-clear deploy + use)
- **Rewrite USING.md §5 "Register the MCP server"** to be copy-paste exact: the `claude mcp add` command
  from `init`, the `.mcp.json` alternative, the **reload** requirement stated loudly, and a
  **"Troubleshooting — it's not connecting"** subsection (server not listed → check the command path;
  tools absent → reload; `manifest: EMPTY` in the stderr banner → you didn't point at the manifest / run
  `allow`; a provider missing from the banner → its bootstrap env isn't set; `mint_and_place` denied →
  no approval armed / destination not allow-listed). Use the `status` tool + the daemon's stderr banner as
  the two diagnostics.
- **Add a ≤60-second Quickstart** near the top of `README.md`: clone → `npm ci && npm run build` →
  `secretsminter init` → `secretsminter allow …` → fill `.env` → paste the `claude mcp add` line → reload →
  first `plan`. Copy-pasteable, generic examples only (`example-web`, `acme` — NEVER private infra names).
- Keep everything honest (flag BUILT-not-live provider paths with their story), matching AI_REVIEW.md.

## Done when
- `secretsminter --env-file .env` (serve) loads the file; `secretsminter init` prints a working
  `claude mcp add` line + `.mcp.json` snippet; no hand-rolled launcher needed.
- USING.md §5 is copy-paste exact with a troubleshooting block; README has a Quickstart.
- The instructions are **verified by following them literally** from a clean dir to a serving daemon.
- Build + tests green.
