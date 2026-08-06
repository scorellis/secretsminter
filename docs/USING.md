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

## 3. Scaffold the trust root — `secretsminter init` + `secretsminter allow`

The trust root is a signed manifest (the allow-list) plus its keypair and the approvals/state files. The
`secretsminter` bin scaffolds all of it so you never hand-sign anything.

> **Honest status:** `init` / `allow` are **[story 0023](stories/0023-init-and-allow-cli.md) — in
> progress (active, NOT BUILT)** at time of writing. The command surface below is exactly as 0023 specs
> it. Until 0023 is marked DONE, if a subcommand isn't present in your build, fall back to hand-writing
> the manifest as shown in older revisions of this guide — but prefer these commands the moment they land.

**Initialize the operator config:**

```bash
secretsminter init            # defaults to ./.secretsminter
# or: secretsminter init --dir /etc/secretsminter
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

The env vars `init` prints point into the dir — export them (or fold them into your `.env`, section 5):

```bash
export SECRETSMINTER_MANIFEST=./.secretsminter/manifest.json
export SECRETSMINTER_MANIFEST_SIG=./.secretsminter/manifest.sig
export SECRETSMINTER_MANIFEST_PUBKEY=./.secretsminter/manifest.pub
export SECRETSMINTER_APPROVALS=./.secretsminter/approvals.json
export SECRETSMINTER_STATE=./.secretsminter/state.json
export SECRETSMINTER_AUDIT_LOG=./.secretsminter/secretsminter.log
```

**Add each destination you want** with `secretsminter allow …`. It appends one entry and **re-signs** the
manifest, so it stays valid without hand-editing. Worked example — allow a Cloudflare Pages env var and a
GitHub Actions secret:

```bash
# a Cloudflare Pages production env var on project "your-site"
secretsminter allow --store cloudflare-pages --project your-site --env production --name "R2_*"

# a GitHub Actions secret on repo "your-org/your-app"
secretsminter allow --store github-actions --repo your-org/your-app --name "R2_*"
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

Point your MCP client at the **`secretsminter` daemon bin** with the environment from `init` (the
manifest/approvals/state paths) plus the provider bootstraps from section 4. Running the `secretsminter`
bin **with no subcommand** serves the MCP (and runs the rotation loop); `init` / `allow` run and exit.

```jsonc
// MCP client config (e.g. Claude Code) — stdio transport
{
  "mcpServers": {
    "secretsminter": {
      "command": "secretsminter",
      "env": {
        "SECRETSMINTER_MANIFEST": "/etc/secretsminter/manifest.json",
        "SECRETSMINTER_MANIFEST_SIG": "/etc/secretsminter/manifest.sig",
        "SECRETSMINTER_MANIFEST_PUBKEY": "/etc/secretsminter/manifest.pub",
        "SECRETSMINTER_APPROVALS": "/var/lib/secretsminter/approvals.json",
        "SECRETSMINTER_STATE": "/var/lib/secretsminter/state.json",
        "SECRETSMINTER_AUDIT_LOG": "/var/lib/secretsminter/secretsminter.log"
        // + the provider bootstraps from section 4, injected from the environment / a secret manager
      }
    }
  }
}
```

Or run it as an always-on container/service so the rotation loop keeps secrets fresh 24/7 (see
[`README.md`](../README.md#run-your-own-secretsminter-docker); the published image is forthcoming). Either
way, **a client reload is needed** to connect — reload/restart your MCP client after adding the server.

> **Do not point at `secretsminter-mcp`.** That second bin is the demo / no-config server and **refuses
> every mutation by design** — it exists for exploration, not provisioning. The `secretsminter` daemon is
> the real server.

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
