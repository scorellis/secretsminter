---
Story: 0023
Status: DONE 2026-08-06 — `secretsminter init` + `allow` subcommands ship: init scaffolds an Ed25519 keypair + signed empty (default-deny) manifest + approvals (refusing to clobber an existing key); allow appends a destination and re-signs; both self-verify via `verifyAndLoadManifest`. Logic lives in `packages/daemon/src/init.ts` (fs/argv-injectable); `signManifest`/`isKnownStore`/`STORE_IDS` added to `@secretsminter/core`.
---

# 0023 — `secretsminter init` + `secretsminter allow` (first-run manifest scaffolding)

**DONE 2026-08-06** — shipped both subcommands (dispatch in `packages/daemon/src/cli.ts`, logic in
`packages/daemon/src/init.ts`), plus `signManifest`/`isKnownStore`/`STORE_IDS` in `@secretsminter/core`;
init + allow both self-verify with `verifyAndLoadManifest`. Unit-tested (in-memory fs); build + tests green.

The pitch promises "point your AI at this repo, tell it to read it, and follow the instructions." Today
that first run is hand-work: a newcomer's AI has to generate an Ed25519 keypair, hand-write a manifest,
sign it, and create the approvals/state files by hand (exactly the friction the 2026-08-06 dogfood hit). This story gives the `secretsminter` bin two setup subcommands so the trust root can be
stood up in seconds, without hand-signing anything.

## Commands (added to the existing `secretsminter` bin — `packages/daemon/src/cli.ts`)

The daemon cli dispatches on `process.argv[2]`: `init` and `allow` run and exit; **no subcommand keeps
today's behavior** (assemble broker + serve MCP + rotation loop).

### `secretsminter init [--dir <path>]`
Default `--dir ./.secretsminter`. Scaffolds the operator config:
1. Create the dir (recursive).
2. **Refuse to clobber an existing `manifest.key`** — a signing key is a crown jewel; if one exists,
   print a message and exit non-zero rather than overwrite it.
3. Generate an **Ed25519 keypair** → `manifest.key` (PKCS8 PEM, the private signing key) + `manifest.pub`
   (SPKI PEM).
4. Write `manifest.json` = `{ "version": 1, "allow": [] }` (empty allow-list — default-deny).
5. **Sign** `manifest.json` with the key → `manifest.sig` (base64), so the scaffold verifies immediately.
6. Write `approvals.json` = `[]`.
7. Print, to stderr (human channel): the exact env vars to export (`SECRETSMINTER_MANIFEST`,
   `_MANIFEST_SIG`, `_MANIFEST_PUBKEY`, `_APPROVALS`, `_STATE`, `_AUDIT_LOG` pointed into the dir) and the
   next steps (add a destination with `secretsminter allow …`, provide provider bootstraps, register the
   MCP server). No secret value is ever printed.

### `secretsminter allow --store <id> [--repo owner/name] [--project p] [--env e] [--name <pattern>] [--dir <path>]`
Adds one destination to the allow-list and **re-signs** — so the manifest stays usable without hand-editing:
1. Read `manifest.json` + `manifest.key` from `--dir` (**error clearly if the dir isn't init'd**).
2. Append an `AllowlistEntry { store, repo?, project?, environment?, namePattern? }` (omit absent fields;
   `--name` maps to `namePattern`). Reject an unknown `--store`.
3. Re-sign `manifest.json` → `manifest.sig`.
4. Print the updated allow-list (value-free: stores/repos/projects/name-patterns only).

## Notes
- Reuse the core manifest verify (`verifyAndLoadManifest`) to self-check after writing/re-signing, so a
  bad write fails loudly. Signing may use `node:crypto` `sign(null, …, ed25519Key)` directly, or a small
  `signManifest(json, privateKeyPem)` helper added to `@secretsminter/core` (mirrors verify) — implementer's
  choice, but keep it tested.
- These are **operator** commands — they touch local files only; they never call a vendor or mint a secret.
- Honor the value-blind posture: never print a key or a secret; `manifest.key` is written with restrictive
  intent (document that the operator should keep it out of git — the repo already gitignores
  `.secretsminter-local/`; the default `.secretsminter/` should likewise be gitignore-documented).

## Done when
- `secretsminter init` produces a dir whose `manifest.json`/`.sig`/`.pub` pass `verifyAndLoadManifest`,
  plus `approvals.json`, and prints the env + next steps; re-running refuses to clobber the key.
- `secretsminter allow …` appends a destination and re-signs so the manifest still verifies and the new
  entry is present; running it on a non-init'd dir errors clearly.
- No subcommand still serves the MCP (unchanged).
- Unit-tested (injected fs/argv where practical): init file set + valid signature + no-clobber; allow
  append + re-sign verifies + unknown-store rejected + not-init'd errors. `npm run build` + `npm test` green.
