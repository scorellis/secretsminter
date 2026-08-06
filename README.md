# secretsminter

You're probably as sick as I am of drilling around in the web UIs of Cloudflare, GitHub, and Supabase —
hunting for tokens and configuring security in a UI that changes as often as Katy Perry changes clothes.

**Secret minting made easy.** Mint new secrets, manage tokens, manage rotation — and do it all from the
comfort of your very own, self-hosted MCP server. Simply point your AI at this repo, tell it to read it,
and have it follow the instructions.

And please — do a deep security audit, post your findings, PR to the repo, make suggestions, help make it
better. Say goodbye to token and secret headaches.

---

**A value-blind secrets-minter that stands up self-maintaining secret rotation — and then gets out of the way.**

`secretsminter` lets an AI agent (or a pipeline) *provision* cloud secrets — mint them, place them where
they're consumed, and wire their recurring rotation — over the **Model Context Protocol (MCP)**,
**without any secret value ever entering the agent's context, the chat, or a log line.**

> **Start here → [`docs/USING.md`](docs/USING.md)** — the ordered, honest first-run guide (addressed to
> the AI doing the setup, readable by a human over its shoulder): clone → build → scaffold the signed
> manifest → provide ephemeral-first bootstraps → register the MCP server → first `plan` / approved
> `mint_and_place`.

## Quickstart (≈60 seconds)

The copy-paste happy path from a clean clone to your agent running its first (dry-run) `plan`. No
hand-rolled launcher — `secretsminter init` prints the exact registration line. Examples are generic;
substitute your own org/project (`your-org`, `example-web`, `acme`).

```bash
# 1. Clone + build (green is the gate).
git clone https://github.com/scorellis/secretsminter && cd secretsminter
npm ci && npm run build

# 2. Scaffold the trust root: an Ed25519 keypair + a signed, empty (default-deny) manifest.
#    Writes the SECRETSMINTER_* paths into ./.secretsminter/.env AND prints the `claude mcp add` line for step 5.
node packages/daemon/dist/cli.js init --dir ./.secretsminter

# 3. Allow one destination (re-signs the manifest). Nothing off this list can ever be placed.
node packages/daemon/dist/cli.js allow --dir ./.secretsminter \
  --store cloudflare-pages --project example-web --env production --name "R2_*"

# 4. Add your provider bootstraps to ./.secretsminter/.env (init already wrote the SECRETSMINTER_* paths
#    there; git-ignored — secret VALUES enter here, never in the agent chat). See docs/USING.md §4.

# 5. Register the server with your MCP client (paste the exact line `init` printed):
claude mcp add secretsminter -- node /ABS/PATH/packages/daemon/dist/cli.js --env-file /ABS/PATH/.secretsminter/.env
```

> **From a clone the CLI isn't on your PATH,** so commands use `node packages/daemon/dist/cli.js`. Prefer
> a short `secretsminter`? Run `npm link` once, then drop the prefix. The `claude mcp add` line `init`
> prints uses an absolute `node …/cli.js`, so registration needs no global install regardless.

**6. Reload/restart your MCP client** — servers load at startup, so it will not connect until you do.
**7. Ask your agent to run `plan`** for the destination you allow-listed — a dry-run that mints nothing
and confirms the manifest check. Full walkthrough, per-provider bootstraps, and troubleshooting:
[`docs/USING.md`](docs/USING.md) (§5 covers registration + "it's not connecting"). Point at the
`secretsminter` daemon bin, **not** the demo `secretsminter-mcp`, which refuses every mutation by design.

> Philosophy: **builders, not maintainers.** The acceptance test for every feature is *"does it
> eliminate ongoing maintenance, or create it?"* A rotation that needs a human or an AI to *remember*
> to run it has already failed. secretsminter's job is to stand the loop up once and let it run itself.
> Every place a human could touch a secret is tracked in [`docs/MANUAL-STEPS.md`](docs/MANUAL-STEPS.md),
> and each *eliminated* step is backed by a test — so manual toil can't creep back in.

---

## Why this exists

Most secret-management pain isn't cryptography — it's toil. A token set by hand, once, in a place
nobody wrote down; a rotation everyone means to automate and never does; a credential pasted into a
chat and now needing to be rolled. secretsminter turns "provision + keep fresh" into a primitive an agent
can call:

- **Mint** a fresh cloud credential (e.g. a Cloudflare R2 API token).
- **Place** it where it's consumed (e.g. a GitHub Actions secret), value-blind.
- **Rotate** it on a schedule the broker owns — or, better, mint a **short-lived credential** that
  self-expires so there's nothing to rotate at all.

Set it up once, then walk away — the secret stays fresh with no one tending it. The
mint → place → verify → rotate loop is **built and runs as a daemon**. Live-run status, precisely:
**Cloudflare R2 temporary-credential minting is live-verified** (2026-07-31, proven with a signed S3
HEAD) and **Cloudflare Pages env-var placement has had a live run** (2026-08-05); **GitHub and Supabase
are real, complete code paths that are unit-tested against fakes but have NOT yet been run against the
live vendor** (their live runs need your credentials). See the [story ledger](docs/stories/) for the
per-provider state.

**You run it yourself.** secretsminter is your own small broker — a **Docker container or service in *your*
environment**, seeded once with your cloud bootstrap keys and a signed policy file. Because it holds
your crown-jewel credentials, it is deliberately **not** a hosted service and stores no tokens: nothing
you'd have to trust a third party with. The payoff is that the whole "rotate the token, then update it
in four places, did I miss one?" class of toil disappears — your AI agent asks the broker to provision,
and the broker mints, places, and keeps everything fresh, without ever handing a value to the agent. See
**[Run it (Docker)](#run-your-own-secretsminter-docker)** below, and [`docs/USING.md`](docs/USING.md) for
the full operator walkthrough.

## The two invariants (read these before anything else)

secretsminter's security rests on **two** invariants, and the second is the load-bearing one:

1. **Value-blind (necessary).** The broker mints and places secrets but **never returns a value** to
   the caller. Tools return only non-secret confirmations like `{ ok, provider, action, secret_id,
   placed_at }`. This stops a prompt-injected agent from *reading* a secret. It is enforced as a
   *mechanism* — positive-whitelist serialization at the tool boundary, a secret-scrubber on every
   error and log path, stdin-only secret transit, and a mint-only tool surface — not as a hopeful
   convention. (OWASP LLM06.)

2. **Destination allow-list + signed manifest (the real trust root).** Value-blindness does **nothing**
   against the more dangerous move: a prompt-injected agent *directing a live secret to an attacker* —
   "mint a token and place it into `attacker/evil`'s secrets" exfiltrates a working credential the
   agent never sees. So the true containment is a **server-side allow-list of destinations,
   declared in a signed, agent-un-writable manifest.** Placements must *match* the manifest; anything
   else is refused, default-deny. Adding a destination is an out-of-band, human-approved change.
   (OWASP LLM08, Excessive Agency.) *Scope note (honest):* the manifest pins **destinations**; a
   request's **scopes are recorded but NOT yet enforced at the providers** (a minted credential today
   carries the bootstrap's scope). Provider-side scope enforcement is a roadmap item
   ([story 0015](docs/stories/0015-provider-scope-enforcement.md)).

If you take one thing from this README: **value-blindness is not the security model. The signed
destination allow-list is.** The two-tier design (below) adds a module boundary that contains a
prompt-injected agent; making it a true process/trust boundary is on the roadmap.

## Architecture (v1)

- **Two-tier design (a module boundary today).** The **agent-facing MCP server** (`@secretsminter/mcp`)
  holds no master keys directly. It validates, checks the manifest, and *requests* actions from an
  **internal minting core** (`@secretsminter/core`) that holds the keys and independently re-enforces the
  allow-list and approval. Because the MCP tier can only invoke the registered tools — and every one of
  them transits the core's gates — a **prompt-injected agent is contained**: it can only ask for what the
  manifest already permits. **Honest scope:** today both tiers run in **one process** (`daemon`), so this
  is a *module* boundary, not a *process/trust* boundary. It contains a prompt-injected agent; it does
  **not** by itself contain code-execution/RCE of the MCP tier, which would sit in the same process as the
  keys. Splitting the core into its own process/Worker is the roadmap item that makes it a real trust
  boundary ([story 0014](docs/stories/0014-core-process-isolation.md), ADR-0009).
- **Narrow, pre-defined tools.** `list_secrets`, `status`, `plan` (dry-run, the default),
  `mint_and_place`, `rotate`, `revoke`. There is no generic "call this API" tool, and no tool accepts
  a caller-supplied secret *value*. The kill switch and approval mechanism are deliberately **not**
  tools — they live out-of-band, where a prompt-injected agent can't reach them.
- **Providers vs. stores.** A `Provider` mints/rotates/revokes/**verifies** at a vendor; a `Store`
  places a minted secret at a destination. v1: Cloudflare, GitHub, Supabase.
- **Self-maintaining rotation.** An explicit, persisted, resumable state machine
  (`PENDING → MINTED → PLACED → VERIFIED → REVOKED → DONE`) in which the old credential is retained
  until the new one passes a **functional** health probe — revoke is structurally unreachable before
  verify. `NEVER_ROTATE` (by name *and* class) protects keys like an updater signing key whose public
  half is baked into shipped builds; a self-lockout guard stops the broker rotating its own hands off.

See [`docs/adrs/`](docs/adrs/) for the full decision record and [`SECURITY.md`](SECURITY.md) for the
threat model.

## Run your own secretsminter (Docker)

secretsminter runs as a container you host — it holds *your* bootstrap keys, so it lives in your trust
boundary (a small always-on box: a cheap VM, a home server, or alongside an existing service). It
stores no tokens; you inject the bootstraps at runtime.

**1. Configure.** Put your bootstraps + config in a git-ignored `.env` (full recipe:
[`docs/USING.md`](docs/USING.md)). Only the vendors you set are enabled:

```bash
# --- a signed, agent-un-writable manifest = the trust root (which destinations are allowed) ---
SECRETSMINTER_MANIFEST=/etc/secretsminter/manifest.json
SECRETSMINTER_MANIFEST_SIG=/etc/secretsminter/manifest.sig
SECRETSMINTER_MANIFEST_PUBKEY=/etc/secretsminter/manifest.pub
# --- provider bootstraps (set only what you use) ---
SECRETSMINTER_CF_ACCOUNT_ID=... ; SECRETSMINTER_CF_BUCKET=... ; SECRETSMINTER_CF_PARENT_ACCESS_KEY_ID=... ; SECRETSMINTER_CF_API_TOKEN=...
SECRETSMINTER_GH_APP_ID=... ; SECRETSMINTER_GH_INSTALLATION_ID=... ; SECRETSMINTER_GH_PRIVATE_KEY="-----BEGIN...\n...\n-----END..."
SECRETSMINTER_SB_PROJECT_REF=... ; SECRETSMINTER_SB_PAT=...
# --- out-of-band controls + durable state (all optional) ---
SECRETSMINTER_APPROVALS=/var/lib/secretsminter/approvals.json   # unset ⇒ deny-all (nothing mutating runs)
SECRETSMINTER_KILL_SWITCH=/var/lib/secretsminter/kill           # create this file to halt everything
```

**2. Run it as an always-on service** (rotation loop keeps your secrets fresh 24/7):

```bash
docker compose up -d          # state persists on a named volume; restarts on reboot
```

**3. Point an AI agent at its MCP tools** — run it interactively over stdio and add it to your MCP
client (e.g. Claude Code) config:

```jsonc
// mcp client config
{ "mcpServers": { "secretsminter": { "command": "docker", "args": ["run", "-i", "--rm", "--env-file", ".env", "secretsminter"] } } }
```

The agent then has `list_secrets`, `status`, `plan`, `mint_and_place`, `rotate`, `revoke` — and manages
a **target** repo's secrets (e.g. `your-org/your-app`), never secretsminter's own. In production, inject
the bootstraps from your platform's secret manager rather than a `.env` file.

> Interface note: today the MCP is served over **stdio** (the agent launches the container). A network
> (HTTP) transport for a remote always-on MCP is a roadmap item (ADR-0013). The **rotation loop** runs
> persistently regardless.

## Status — honest

The security core, the MCP server, the sinks, the scheduler, **durable state**, the **daemon**, and all
**three providers** are built. Live-run status, precisely: **Cloudflare R2 temp-credential minting is
live-verified** (signed S3 HEAD, 2026-07-31) and **Cloudflare Pages env placement has had a live run**
(2026-08-05); **GitHub and Supabase are complete code paths, unit-tested against fakes, but not yet run
against the live vendor**. It is **not yet independently security-reviewed** — don't trust it with
standing production credentials until it is.

| Piece | Status |
| --- | --- |
| The **security core** (`@secretsminter/core`) — value-blind + `SecretValue`, allow-list, signed manifest, NEVER_ROTATE, rotation state machine, broker pipeline | **built** — part of a **172-test** suite (adversarial suite + local coverage gate) |
| The **live MCP server** (`@secretsminter/mcp`) — six narrow tools wired to the broker | **built + integration-tested** |
| Out-of-band **approval + fail-closed kill switch** · **audit + alert sinks + drift** | **built** |
| **Self-maintaining rotation loop** + scheduler · **durable state** (survives restart) | **built** |
| The **daemon** (`@secretsminter/daemon`) — composition root + rotation loop + MCP serving | **built** |
| **Cloudflare** provider (R2 temp creds) | **built + LIVE-VERIFIED** (0003) |
| **Cloudflare Pages** env-var store | **built + unit-tested; one live env-write run** (0013; redeploy-and-reconcile pending) |
| **GitHub** provider + Actions store (sealed-box) · **Supabase** provider | **built + unit-tested against fakes**; NOT yet run against the live vendor (0004, 0005) |

No vaporware: a capability that isn't built says so, in code (`NotWiredError`) and in its story
([`docs/stories/`](docs/stories/)). **Visibility:** private during hardening; opens for public review
once independently security-reviewed.

## Develop

```bash
npm install
npm run build          # tsc --build (all packages, strict)
npm test               # vitest
npm run test:coverage  # + the coverage gate (runs locally — the repo has no CI of its own)
```

secretsminter deploys in isolation: it stores no tokens and has **no GitHub Actions of its own** — see
[`AGENTS.md`](AGENTS.md).

## We want your scrutiny

This is a security tool. The intent is to open it **so it can be attacked in review before it is
trusted in production** — it is **private for now, while the P0 controls are hardened**, and will be
made public once they are built and verified. The standing stance holds for anyone with access today:
if you are a human or an AI reading this repo, please see **[`AI_REVIEW.md`](AI_REVIEW.md)** — we
actively invite deep review, threat models, and PRs, and we ask that you not rely on any feature marked
at-risk or not-yet-wired.

## Prior art & where we differ

secretsminter is an incremental wedge in a dense field, not a first mover. Be clear-eyed about the
neighbors:

- **HashiCorp Vault** — the mature standard for **dynamic secrets** (short-lived, generated on demand)
  and now an official **Vault MCP server**. Vault is vastly more battle-tested, has a real policy engine,
  broad backend coverage, HA, and audit devices we do not.
- **Infisical** — the **closest in spirit**: it already does secret **mint + sync** to many destinations
  (including an agent story), with a hosted product, RBAC, and a large integration catalog we lack.
- **CB4A** — the IETF draft `draft-hartman-credential-broker-4-agents`, which frames the broker/agent
  separation we mirror. It is a spec direction, not a competing product.
- **`agentsecrets` / `mcp-secrets-vault`** — MCP-native, zero-knowledge-style vaults that deliberately
  expose no `get()`; the nearest twins to our value-blind stance.

**Our wedge:** value-blind **mint + _place_ + rotate** exposed as a single, agent-callable *provisioning*
primitive, gated by a **signed destination allow-list** — the agent can stand a credential up *where it
is consumed* and keep it fresh, but can never read it and can never direct it off the allow-list. The
"place" step (writing into a GitHub Actions secret or a Cloudflare Pages env var) as a first-class,
allow-list-gated action is where we differ from a pure dynamic-secrets engine.

**Where they are stronger:** every tool above is more mature, more broadly integrated, and
independently reviewed. Vault and Infisical are production systems; secretsminter is an early,
not-yet-independently-reviewed project. Choose it for the specific agent-provisioning shape above, not
as a Vault/Infisical replacement.

## License

[Apache-2.0](LICENSE) — permissive, with an explicit patent grant. See
[`docs/adrs/0007-apache-2-and-ip-posture.md`](docs/adrs/) for the licensing + intellectual-property
rationale.
