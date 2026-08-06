---
Story: 0024
Status: DONE 2026-08-06 — docs/USING.md written: ordered AI-addressed first-run guide (sections 1–7, secret-zero / ephemeral-first up front); README "Start here" pointer added; cross-linked SECURITY/AI_REVIEW/CONTRIBUTING + stories 0021/0023
---

# 0024 — Onboarding guide (`docs/USING.md`): the "read this repo and set me up" flow

**DONE 2026-08-06.** `docs/USING.md` rewritten as an ordered, honest, AI-addressed first-run guide
covering sections 1–7 in order, stating the secret-zero / recurring-toil / ephemeral-first principle up
front; the repo-root `README.md` gained a "Start here → docs/USING.md" pointer; the guide cross-links
`SECURITY.md` / `AI_REVIEW.md` / `CONTRIBUTING.md` / `MANUAL-STEPS.md` and stories 0021 (direct-upload
Pages redeploy, `actions: write` via the App) and 0023 (`init` / `allow`, flagged in-progress). Every
capability is real today or flagged with its story status (no vaporware).

The pitch tells a newcomer to point their AI at the repo and have it follow the instructions — but there
is no single document an AI can follow from clone to first mint. This story writes that document:
`docs/USING.md`, an ordered, honest first-run guide addressed to **the AI doing the setup** (and readable
by a human over its shoulder). It builds on the `secretsminter init` / `allow` commands (story 0023).

## The load-bearing principle it must state up front
secretsminter eliminates **recurring** toil, not the one-time bootstrap. "Secret zero" is unavoidable —
every secrets tool needs *some* initial credential to act on your behalf. The honest promise is: you grant
a **least-privilege bootstrap once** (it lives in the crown-jewel inventory, `SECURITY.md`), and from then
on secretsminter mints/places/rotates hands-free — and **where the vendor supports it, it uses ephemeral
credentials** (GitHub App installation tokens, R2 Temporary Credentials) so there is nothing standing to
rotate. Being asked to hand-mint a token *once, scoped* is expected; being asked to hand-mint one *per
operation* is the smell this tool exists to remove.

## Sections the guide must cover (ordered)
1. **What you're setting up** — the two-tier picture in one paragraph; the trust root is the signed
   manifest (allow-list), not value-blindness. Link `SECURITY.md` / `AI_REVIEW.md`.
2. **Install & build** — `npm ci`, `npm run build`, `npm test` (green is the gate).
3. **Scaffold the trust root** — `secretsminter init` (what it creates; keep `manifest.key` out of git),
   then `secretsminter allow …` for each destination you want (with a worked example, e.g. a Cloudflare
   Pages env var and a GitHub Actions secret).
4. **Provide the minimal bootstraps — ephemeral-first** — a per-provider table: what credential each
   provider needs, its least-privilege scope, and whether an ephemeral option exists. Explicitly:
   - **Cloudflare** — a Pages/R2 API token scoped to the allow-listed project/bucket; prefer **R2
     Temporary Credentials** where a consumer can fetch at use-time.
   - **GitHub** — prefer the **GitHub App** (secretsminter mints short-lived installation tokens itself,
     value-blind); a scoped fine-grained PAT is the fallback. Call out the **direct-upload Pages redeploy**
     case (story 0021): the redeploy hook needs `actions: write`, best supplied by the App, not a PAT.
   - **Supabase** — a Management API PAT scoped to one project; the new publishable/secret key model.
   - State each as a **one-time** grant recorded in the crown-jewel inventory.
5. **Register the MCP server** — point the AI's MCP client at the `secretsminter` daemon with the env from
   `init` (the manifest/approvals/state paths + provider bootstraps); note a client reload is needed to
   connect. The demo/no-config `secretsminter-mcp` bin refuses every mutation by design — the daemon is the
   real server.
6. **First run through the tools** — `status` / `list_secrets` (read-only), `plan` (dry-run, default),
   then a mutating `mint_and_place` gated by an **out-of-band approval** (show that the AI cannot
   self-approve — approval is a separate, human/out-of-band step).
7. **Hands-free from here** — set a rotation cadence; ephemeral creds self-expire; what "self-maintaining"
   means and what still needs a human (bootstrap rotation, manifest changes — both out-of-band by design).

## Constraints
- Honest throughout: where a path is BUILT-but-not-live (GitHub App / Supabase live runs, story statuses),
  say so and link the story — no vaporware, matching `AI_REVIEW.md`'s "at risk" rules.
- Written so an AI agent can execute it top-to-bottom; commands copy-pasteable; no secret value ever asked
  to be pasted into the agent's chat (that's the whole point — `.env`/bootstraps enter via the environment).
- Cross-link `README.md`, `SECURITY.md`, `AI_REVIEW.md`, `CONTRIBUTING.md`, and stories 0021/0023.
- Add a short "Start here" pointer to `docs/USING.md` from `README.md`.

## Done when
- `docs/USING.md` exists, covers sections 1–7 in order, states the secret-zero / ephemeral-first principle
  up front, and is followable end-to-end by an AI from clone to a first `plan`/`mint_and_place`.
- `README.md` points to it.
- Every capability it describes is either real today or clearly flagged with its story status.
