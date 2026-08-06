# Using secretsminter — read this repo and set me up

**Audience: the AI agent doing the setup** (with a human reading over your shoulder). Follow the
sections below **in order**, from a fresh clone to a first `plan` and a first approved `mint_and_place`.
Every command here is copy-pasteable.

> **The one rule that never bends:** no secret *value* is ever pasted into this chat, typed at you, or
> printed by a tool. Bootstrap credentials enter **only** through the environment (a git-ignored `.env`
> or a secret manager). If any step seems to ask you to read or echo a secret value, stop — that is not
> how this tool works. See [`AI_REVIEW.md`](../AI_REVIEW.md) → "A trap to avoid."

## The load-bearing principle: what secretsminter does and doesn't remove

secretsminter kills **recurring** toil, not the one-time bootstrap. "Secret zero" is unavoidable — every
secrets tool needs *some* prior authority to act on your behalf. The honest deal is:

- You grant a **least-privilege bootstrap once** per provider. That grant is recorded in the crown-jewel
  inventory ([`SECURITY.md`](../SECURITY.md)) and rotates from the account login down
  ([`MANUAL-STEPS.md`](MANUAL-STEPS.md)).
- From then on secretsminter mints, places, and rotates hands-free — and **where the vendor supports it,
  it uses ephemeral credentials** (GitHub App installation tokens, Cloudflare R2 Temporary Credentials)
  so there is nothing standing to rotate.

Being asked to hand-mint a token **once, scoped** is expected. Being asked to hand-mint one **per
operation** is exactly the smell this tool exists to remove. If you find yourself minting a token every
time you deploy, something is wired wrong — prefer the ephemeral path below.

---

## 1. What you're setting up

secretsminter is a small broker **you host** that provisions cloud secrets — mints them, places them
where they're consumed, and wires their rotation — over the Model Context Protocol (MCP), **without any
secret value ever entering your context.** Its security rests on two invariants, and the second is the
trust root:

- **Value-blind (necessary, not sufficient).** Tools return only non-secret confirmations like
  `{ ok, provider, action, secret_id, placed_at }`. This stops you (a possibly prompt-injected agent)
  from *reading* a secret.
- **Signed destination allow-list (the real trust root).** Value-blindness does nothing against
  *directing* a live secret to an attacker. So the true containment is a **server-side allow-list of
  destinations, declared in a signed, agent-un-writable manifest.** Any placement that doesn't match the
  manifest is refused, default-deny. You cannot add a destination from inside this chat — that is an
  out-of-band, human-approved change.

Read [`SECURITY.md`](../SECURITY.md) (the threat model + crown-jewel inventory) and
[`AI_REVIEW.md`](../AI_REVIEW.md) (what "at risk" means) before you run anything. The two-tier design is
a **module** boundary today, not a process boundary — see [`README.md`](../README.md#architecture-v1) and
[story 0014](stories/0014-core-process-isolation.md) for the honest scope.

## 2. Install & build (green is the gate)

```bash
npm ci
npm run build     # tsc --build across all packages, strict
npm test          # vitest — the security-core + integration suite
```

Do not proceed until `npm test` is green. A red suite means the invariants this tool depends on are not
holding on your machine; setting up live credentials on top of that would be reckless. For the full
developer loop (`npm run typecheck`, the coverage gate) see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

> **From a clone the CLI isn't on your PATH,** so the commands below run it as `node
> packages/daemon/dist/cli.js` — works cross-platform, no install. Prefer a short `secretsminter`? Run
> `npm link` once, then drop the prefix. (The `claude mcp add` line `init` prints in §5 always uses an
> absolute `node …/cli.js`, so registration needs no global install either way.)

## 3. Scaffold the trust root — `secretsminter init` + `secretsminter allow`

The trust root is a signed manifest (the allow-list) plus its keypair and the approvals/state files. The
`secretsminter` bin scaffolds all of it so you never hand-sign anything.

> **Honest status:** `init` / `allow` are **shipped** ([story 0023](stories/0023-init-and-allow-cli.md),
> DONE 2026-08-06). The command surface below is exactly what your build exposes — no hand-writing the
> manifest.

**Initialize the operator config:**

```bash
node packages/daemon/dist/cli.js init            # defaults to ./.secretsminter
# or: node packages/daemon/dist/cli.js init --dir /etc/secretsminter
```

`init` (per 0023):

1. Creates the dir.
2. **Refuses to clobber an existing `manifest.key`** (a signing key is a crown jewel) — it exits non-zero
   rather than overwrite one.
3. Generates an **Ed25519 keypair** → `manifest.key` (private, PKCS8 PEM) + `manifest.pub` (SPKI PEM).
4. Writes `manifest.json` = `{ "version": 1, "allow": [] }` — an empty, **default-deny** allow-list.
5. **Signs** `manifest.json` → `manifest.sig`, so the scaffold verifies immediately.
6. Writes `approvals.json` = `[]`.
7. Prints (to stderr, the human channel) the **exact env vars to export** and the next steps. It never
   prints a secret value.

**Keep `manifest.key` out of git.** It is the signing key for your trust root. The repo gitignores
`.secretsminter-local/`; add your chosen `--dir` (e.g. `.secretsminter/`) to `.gitignore` as well.

**You do not need to export these by hand.** `init` now **writes the `SECRETSMINTER_*` pointers into
`<dir>/.env`** for you (absolute paths), and the daemon loads them via `--env-file <dir>/.env` at
launch (section 5) — that printed `.env` is the primary path. Manual exporting is optional. For
reference, these are the pointers `init` writes into the file (into `./.secretsminter/.env`):

```bash
# already written into <dir>/.env by init — shown for reference, not to run
SECRETSMINTER_MANIFEST=./.secretsminter/manifest.json
SECRETSMINTER_MANIFEST_SIG=./.secretsminter/manifest.sig
SECRETSMINTER_MANIFEST_PUBKEY=./.secretsminter/manifest.pub
SECRETSMINTER_APPROVALS=./.secretsminter/approvals.json
SECRETSMINTER_STATE=./.secretsminter/state.json
SECRETSMINTER_AUDIT_LOG=./.secretsminter/audit.log
```

**Add each destination you want** with `secretsminter allow …`. It appends one entry and **re-signs** the
manifest, so it stays valid without hand-editing. Worked example — allow a Cloudflare Pages env var and a
GitHub Actions secret:

```bash
# a Cloudflare Pages production env var on project "your-site"
node packages/daemon/dist/cli.js allow --store cloudflare-pages --project your-site --env production --name "R2_*"

# a GitHub Actions secret on repo "your-org/your-app"
node packages/daemon/dist/cli.js allow --store github-actions --repo your-org/your-app --name "R2_*"
```

`allow` maps `--name` to `namePattern`, omits absent fields, rejects an unknown `--store`, and errors
clearly if the `--dir` was never `init`'d. It prints the updated allow-list — **value-free** (stores,
repos, projects, and name-patterns only). Anything not on this list is refused at mint/place time.

## 4. Provide the minimal bootstraps — ephemeral-first

Each provider needs **one** least-privilege bootstrap, granted once and recorded in the crown-jewel
inventory ([`SECURITY.md`](../SECURITY.md)). Supply every value through the environment — never in this
chat. Prefer the ephemeral column wherever it exists: an ephemeral credential self-expires, so there is
nothing standing for you to rotate later.

| Provider | Bootstrap it needs | Least-privilege scope | Ephemeral option | Env vars |
| --- | --- | --- | --- | --- |
| **Cloudflare** | An R2/Pages API token scoped to the allow-listed bucket/project | `Object Read & Write` on **only** the named bucket (not "all buckets"); Pages edit on the named project | **Yes — prefer R2 Temporary Credentials** where a consumer can fetch at use-time; the broker mints short-lived R2 creds that self-expire (live-verified, [0003](stories/0003-cloudflare-provider-live.md)) | `SECRETSMINTER_CF_ACCOUNT_ID`, `SECRETSMINTER_CF_BUCKET`, `SECRETSMINTER_CF_API_TOKEN`, `SECRETSMINTER_CF_PARENT_ACCESS_KEY_ID` |
| **GitHub** | **Prefer the GitHub App** (installed only on allow-listed repos); a fine-grained PAT is the fallback | App: least install scope for the repos you target (e.g. Actions secrets read/write); PAT fallback: repo-scoped, fine-grained, Actions secrets only | **Yes — the App.** secretsminter mints short-lived **installation tokens** itself, value-blind. Prefer this over any standing PAT | App: `SECRETSMINTER_GH_APP_ID`, `SECRETSMINTER_GH_INSTALLATION_ID`, `SECRETSMINTER_GH_PRIVATE_KEY` |
| **Supabase** | A Management API PAT scoped to one project | Single project ref only; use the new publishable/secret key model for issued keys (publishable = client-safe; secret = never shared) | No first-class ephemeral Management token today — treat the PAT as a one-time, project-scoped grant and rotate out-of-band | `SECRETSMINTER_SB_PROJECT_REF`, `SECRETSMINTER_SB_PAT` |

Each of these is a **one-time** grant. Record it in the crown-jewel inventory; rotate it from the account
login down ([`MANUAL-STEPS.md`](MANUAL-STEPS.md)), out-of-band.

**Honest per-provider status — do not treat as live until its story flips:**

- **Cloudflare** ([0003](stories/0003-cloudflare-provider-live.md)) — **live-verified 2026-07-31** (real
  R2 Temporary Credentials minted + verified with a signed S3 HEAD). Cloudflare Pages env placement had a
  **live run 2026-08-05** ([0013](stories/0013-cloudflare-pages-place.md)).
- **GitHub** ([0004](stories/0004-github-provider-live.md)) — **BUILT + unit-tested against fakes, NOT yet
  run against the live vendor.** Its live run is pending a real GitHub App.
- **Supabase** ([0005](stories/0005-supabase-provider-live.md)) — **BUILT + unit-tested against fakes, NOT
  yet run against the live vendor.** Its live run is pending a real PAT.

**Call-out — the direct-upload Pages redeploy needs `actions: write`, best from the App.** If your
Cloudflare Pages project is **direct-upload** (deployed by GitHub Actions running `wrangler pages deploy`,
no Git connection — e.g. `example-web`), setting an env var is not consumer-visible until a redeploy
runs. secretsminter closes this ([story 0021](stories/0021-direct-upload-redeploy.md), **DONE
2026-08-06**) by firing a GitHub Actions `workflow_dispatch` and awaiting the fresh deployment. That
dispatch needs a GitHub token with **`actions: write`** — supply it as a **short-lived installation token
the GitHub App mints**, not a hand-minted standing PAT. Wire it through the broker environment (never in
chat):

```bash
SECRETSMINTER_PAGES_REDEPLOY=github
SECRETSMINTER_PAGES_REDEPLOY_GH_OWNER=your-org
SECRETSMINTER_PAGES_REDEPLOY_GH_REPO=your-app
SECRETSMINTER_PAGES_REDEPLOY_GH_WORKFLOW=deploy.yml
SECRETSMINTER_PAGES_REDEPLOY_GH_REF=main
SECRETSMINTER_PAGES_REDEPLOY_GH_TOKEN=<actions:write token — prefer an App installation token>
```

## 5. Register the MCP server

You do **not** hand-roll a launcher. Put every value from sections 3 and 4 into one git-ignored `.env`
in your `--dir`, then point your MCP client at the **`secretsminter` daemon bin** with `--env-file`
pointed at that file. `secretsminter init` **prints the exact registration** for you — the two blocks
below are what it emits, with the absolute paths from your `--dir` already filled in. Running the
`secretsminter` bin **with no subcommand** serves the MCP (and runs the rotation loop); `init` / `allow`
run and exit.

**First, finish the `.env`.** `init` already **wrote the `SECRETSMINTER_MANIFEST*` / `_APPROVALS` /
`_STATE` / `_AUDIT_LOG` pointers into `<dir>/.env`** for you (section 3) — so you only need to add the
provider bootstraps from section 4 to that same file — e.g. `./.secretsminter/.env`:

```bash
# ./.secretsminter/.env  — git-ignored; loaded by the daemon via --env-file. NEVER commit this.
# --- trust root: these lines were ALREADY written by `init` (shown here so you see the whole file) ---
SECRETSMINTER_MANIFEST=./.secretsminter/manifest.json
SECRETSMINTER_MANIFEST_SIG=./.secretsminter/manifest.sig
SECRETSMINTER_MANIFEST_PUBKEY=./.secretsminter/manifest.pub
SECRETSMINTER_APPROVALS=./.secretsminter/approvals.json
SECRETSMINTER_STATE=./.secretsminter/state.json
SECRETSMINTER_AUDIT_LOG=./.secretsminter/audit.log
# --- provider bootstraps from section 4 — ADD THESE (set only what you use; values enter HERE, never in chat) ---
# SECRETSMINTER_CF_ACCOUNT_ID=... ; SECRETSMINTER_CF_BUCKET=... ; SECRETSMINTER_CF_API_TOKEN=... ; SECRETSMINTER_CF_PARENT_ACCESS_KEY_ID=...
# SECRETSMINTER_GH_APP_ID=... ; SECRETSMINTER_GH_INSTALLATION_ID=... ; SECRETSMINTER_GH_PRIVATE_KEY="-----BEGIN...\n...\n-----END..."
# SECRETSMINTER_SB_PROJECT_REF=... ; SECRETSMINTER_SB_PAT=...
```

The daemon reads `--env-file` and sets each `KEY=VALUE` into the environment **only if not already set**
(a real env var always wins), so the same `.env` works whether you launch by hand, from your MCP client,
or from a secret manager that pre-populates the environment.

**Option A — `claude mcp add` (what `init` prints).** Paste the exact `claude mcp add` line `init`
printed; one copy-paste line, everything else comes from the `.env`:

```bash
claude mcp add secretsminter -- node /ABS/PATH/packages/daemon/dist/cli.js --env-file /ABS/PATH/.secretsminter/.env
```

It uses an **absolute `node …/cli.js`, so it needs no global install** — it resolves from a fresh clone.
`init` fills in the absolute paths from your `--dir` and the repo; use them verbatim — your MCP client's
working directory is not your shell's.

**Option B — `.mcp.json` snippet (generic MCP-client shape).** Any stdio MCP client takes this shape.
Either keep `--env-file` in `args` (simplest), or spell the pointers out in an `env` block — both are
equivalent:

```jsonc
// .mcp.json — stdio transport. Point every SECRETSMINTER_* path into your --dir.
{
  "mcpServers": {
    "secretsminter": {
      "command": "node",
      "args": ["/ABS/PATH/packages/daemon/dist/cli.js", "--env-file", "/ABS/PATH/.secretsminter/.env"],
      "env": {
        // Optional: instead of (or alongside) --env-file, point the trust-root paths in directly.
        // A value set here wins over the same key in the .env.
        "SECRETSMINTER_MANIFEST": "/ABS/PATH/.secretsminter/manifest.json",
        "SECRETSMINTER_MANIFEST_SIG": "/ABS/PATH/.secretsminter/manifest.sig",
        "SECRETSMINTER_MANIFEST_PUBKEY": "/ABS/PATH/.secretsminter/manifest.pub",
        "SECRETSMINTER_APPROVALS": "/ABS/PATH/.secretsminter/approvals.json",
        "SECRETSMINTER_STATE": "/ABS/PATH/.secretsminter/state.json",
        "SECRETSMINTER_AUDIT_LOG": "/ABS/PATH/.secretsminter/secretsminter.log"
        // Provider bootstraps still come from the --env-file (keep secret values out of a committed .mcp.json).
      }
    }
  }
}
```

> **Keep secret values in the `.env`, not in `.mcp.json`.** A `.mcp.json` is often committed; the `.env`
> is git-ignored. Point at the bootstraps via `--env-file`; never paste a provider token into the JSON.

> ### RELOAD YOUR MCP CLIENT — this is the step everyone forgets
> An MCP client loads its servers **at startup**. Adding the server does **nothing** until you
> **reload/restart the client** (in Claude Code: restart the session, or re-open so it re-reads
> `.mcp.json`). If the `secretsminter` tools don't appear, you almost certainly skipped this.

Or run it as an always-on container/service so the rotation loop keeps secrets fresh 24/7 (see
[`README.md`](../README.md#run-your-own-secretsminter-docker); the published image is forthcoming). Either
way, **the client reload is still required** to connect.

> **Do not point at `secretsminter-mcp`.** That second bin is the demo / no-config server and **refuses
> every mutation by design** — it exists for exploration, not provisioning. The registration above uses
> the `secretsminter` daemon bin, which is the real server. If mutations are being refused no matter what
> you approve, check first that you registered `secretsminter`, not `secretsminter-mcp`.

### Troubleshooting — it's not connecting

Two diagnostics tell you almost everything: the read-only **`status` tool** (once the server is
connected) and the **daemon's stderr banner** (printed at startup — visible in your MCP client's server
logs). The banner looks like:

```
secretsminter daemon — providers: [cloudflare, github], manifest: verified, rotation every 3600000ms, serve: stdio
```

Work down this list:

- **The server isn't listed / won't start** → the `command` or path is wrong. Confirm both paths in the
  registration are **absolute** and readable by the client: the `node /ABS/PATH/packages/daemon/dist/cli.js`
  path (built by `npm run build`) and the `--env-file /ABS/PATH/.secretsminter/.env` path. Re-check the
  exact line `init` printed — it uses an absolute `node …/cli.js`, so no global install or `PATH` entry is
  needed. (If you ran `npm link` and registered the short `secretsminter` bin instead, confirm it's on `PATH`.)
- **The server is listed but the tools don't appear** → you didn't reload. Restart the MCP client so it
  re-reads its config (see the loud note above). This is the single most common cause.
- **Banner says `manifest: EMPTY (nothing can be placed until configured)`** → the daemon didn't load a
  signed manifest. Either the `SECRETSMINTER_MANIFEST` / `_MANIFEST_SIG` / `_MANIFEST_PUBKEY` paths aren't
  set (or point at the wrong dir), or you never ran `secretsminter allow` to add a destination. Re-run
  section 3, then reload. With an empty manifest every placement is refused, default-deny.
- **A provider you expected is missing from the `providers: [...]` list** → its bootstrap env isn't set,
  so the daemon skipped it (a provider whose bootstrap isn't configured is silently skipped by design).
  Set that provider's `SECRETSMINTER_*` vars in the `.env` (Cloudflare: `SECRETSMINTER_CF_ACCOUNT_ID`,
  `SECRETSMINTER_CF_BUCKET`, `SECRETSMINTER_CF_API_TOKEN`, `SECRETSMINTER_CF_PARENT_ACCESS_KEY_ID`;
  GitHub App: `SECRETSMINTER_GH_APP_ID`, `SECRETSMINTER_GH_INSTALLATION_ID`, `SECRETSMINTER_GH_PRIVATE_KEY`;
  Supabase: `SECRETSMINTER_SB_PROJECT_REF`, `SECRETSMINTER_SB_PAT`) and reload.
- **`mint_and_place` returns denied** → one of the two gates fired. Either **no out-of-band approval is
  armed** for that exact action (approval is a separate, human/out-of-band step — you cannot self-approve;
  see section 6), or **the destination isn't on the signed allow-list** (run `plan` first — it dry-runs
  the manifest check and names the miss; then `secretsminter allow` the destination, out-of-band). This is
  the trust root working as designed, not a bug — see [`SECURITY.md`](../SECURITY.md) and
  [`AI_REVIEW.md`](../AI_REVIEW.md) → "What 'at risk' means here."

When in doubt: call `status` (it confirms the broker loaded and **verified** the signed manifest and that
the kill switch isn't engaged), and read the stderr banner. Between them they distinguish "not connected"
from "connected but default-deny."

## 6. First run through the tools

You have six narrow tools: `list_secrets`, `status`, `plan`, `mint_and_place`, `rotate`, `revoke`. There
is no generic "call this API" tool, and none accepts a caller-supplied secret value. Go read-only first,
then dry-run, then the one gated mutation.

1. **`status`** — confirm the broker loaded and **verified** the signed manifest, and that the kill
   switch is not engaged. Read-only.
2. **`list_secrets`** — see what's already managed. Read-only; returns value-free records.
3. **`plan`** — describe the mint+place you want (e.g. an `R2_*` secret into `your-org/your-app`'s Actions
   secrets). `plan` is a **dry-run by default**: it checks the destination against the manifest and shows
   what *would* happen, minting nothing. If the destination isn't allow-listed, it's refused here — go
   back to section 3 and `allow` it (out-of-band).
4. **`mint_and_place`** — the mutation. It is gated by an **out-of-band approval**. You (the agent)
   **cannot self-approve** — approval is a separate human/out-of-band step (a `FileApprovalGate` entry
   bound to the action hash, written where you can't reach it). Ask the human to approve the specific
   action out-of-band; then call `mint_and_place`. The broker checks the manifest, checks the approval,
   mints, places (e.g. sealed-box into a GitHub Actions secret), writes a value-free audit entry, and
   returns only `{ ok, provider, action, secret_id, placed_at }` — never the value.

The kill switch and the approval gate are **never** MCP tools — they live out-of-band, where a
prompt-injected agent can't reach them ([`SECURITY.md`](../SECURITY.md),
[`CONTRIBUTING.md`](../CONTRIBUTING.md)).

## 7. Hands-free from here

Once a secret is minted and placed with a rotation policy, you're done tending it:

- **Rotation cadence.** The broker's scheduler rotates each managed secret on its cadence through the full
  gate (verify-before-revoke is structural: the old credential is kept until the new one passes a
  functional health probe). Set the cadence once.
- **Ephemeral self-expiry.** Where you chose the ephemeral path (R2 Temporary Credentials, GitHub App
  installation tokens), the credential self-expires and the loop re-mints — there is nothing standing to
  rotate.
- **What still needs a human, out-of-band by design:**
  - **Bootstrap rotation** — rolling a provider's crown-jewel bootstrap (make-before-break, from the
    account login down; [`MANUAL-STEPS.md`](MANUAL-STEPS.md)).
  - **Manifest changes** — adding/removing a destination re-signs the trust root; that is a deliberate
    human-approved step, not an agent action ([`SECURITY.md`](../SECURITY.md)).

Both are intentional controls, not toil the tool failed to remove. Everything *recurring* — the mint,
the place, the verify, the rotate — runs itself.

**Honest gaps to respect** (do not depend on a property marked not-yet-enforced): requested scopes aren't
yet enforced at the providers ([0015](stories/0015-provider-scope-enforcement.md)); approvals are
replayable within their expiry window and there's no rate limit yet
([0016](stories/0016-single-use-approvals-and-rate-limit.md)); rotation doesn't yet re-place/revoke at the
store ([0018](stories/0018-wire-rotation-place-revoke-and-drift.md)). See
[`SECURITY.md`](../SECURITY.md) → "Known limitations (v1)" and [`AI_REVIEW.md`](../AI_REVIEW.md) → "What
'at risk' means here." **Nothing here is production-ready until the provider stories land AND an
independent security review signs off.**

---

**See also:** [`README.md`](../README.md) · [`SECURITY.md`](../SECURITY.md) ·
[`AI_REVIEW.md`](../AI_REVIEW.md) · [`CONTRIBUTING.md`](../CONTRIBUTING.md) ·
[`MANUAL-STEPS.md`](MANUAL-STEPS.md) · the [story ledger](stories/) — including
[0021](stories/0021-direct-upload-redeploy.md) and [0023](stories/0023-init-and-allow-cli.md).
