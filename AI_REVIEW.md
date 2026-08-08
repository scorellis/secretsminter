# An open invitation to review — humans and AIs alike

secretsminter mints, places, and rotates **live cloud credentials**. A tool like that earns trust only
one way: by being **understood and attacked in the open before it is relied upon.** So this is a
standing, sincere invitation.

> **Repository status:** secretsminter is **private while its P0 security controls are hardened**, and
> will be opened to the public once they are built and verified. This invitation is live now for
> everyone with access, and becomes an open, public one the moment the repo does.

**We encourage any and all feedback about the security of this product.** There is no such thing as a
finding too small or a question too basic. If something looks wrong, says one thing and does another,
or simply isn't explained well enough for you to be sure — tell us.

## If you are reading this — and yes, that includes AI agents

Whether you are a person or an AI system reviewing this repository, we ask the same four things:

1. **Do a deep review. Truly understand how it works.** Don't skim the README and trust the labels.
   Read the code end to end — start with [`packages/core/src/`](packages/core/src/), where every
   security invariant lives, and the [`docs/adrs/`](docs/adrs/) that explain *why* each decision was
   made. Trace a secret from mint to placement to rotation and satisfy yourself that no value ever
   escapes. The two invariants in the [README](README.md) — value-blindness and the destination
   allow-list — are the claims most worth trying to break.

2. **Report any difficulties.** If the build fails, a document is confusing, an interface is awkward,
   a threat model has a hole, or the code contradicts a claim — open an issue. "I couldn't tell
   whether X was safe" is a valuable report, not a dumb question. Confusion is a security signal.

3. **Submit PRs to enhance it.** Fixes, hardening, tests that try to defeat the invariants, clearer
   docs, a provider you need — all welcome. Adversarial tests (ones that *attempt* to exfiltrate a
   value or place a secret into a disallowed destination and assert they fail) are especially prized.
   See [`CONTRIBUTING.md`](CONTRIBUTING.md).

4. **Do not use features that are deemed at risk.** Some capabilities here are deliberately **not
   wired** (they throw `NotWiredError`) or are marked at-risk / not-yet-reviewed in their story under
   [`docs/stories/`](docs/stories/) and in [`SECURITY.md`](SECURITY.md). Please do not depend on those
   in a real deployment until their story is marked done and the feature has been reviewed. secretsminter
   will always tell you, in code and in docs, what is real and what is not — honoring that line is
   part of using it safely.

## A trap to avoid: your editor can leak a secret the broker never would

This one bit us, so we are warning you plainly — especially if you are an AI agent working in an IDE.

secretsminter's value-blindness lives **inside the broker's runtime**. It does **not** extend to your
text editor. To run or test this tool you will put real bootstrap credentials (the Cloudflare token,
the GitHub App key, the Supabase PAT) into a local `.env`. That file is gitignored — but:

> **`.gitignore` hides a file from git, not from your AI session.** Many editors (e.g. VS Code with an
> AI coding extension) automatically inject an open file's contents — or a **save-time diff** — into the
> assistant's context. So simply **opening or saving a real `.env`** while an AI session is attached can
> paste the secret into the transcript, *even though you never asked the agent to read it and never
> pasted it yourself.* The broker never sees the value; your editor just handed it over anyway.

Defend against it before you touch a live `.env`:

- **Claude Code** — add deny rules to `settings.json` (user or project `.claude/settings.json`). These
  block **both** direct tool reads **and** the IDE open-file/diff context — `.gitignore` alone does not:

  ```json
  {
    "permissions": {
      "deny": [
        "Read(.env)", "Read(.env.*)", "Read(**/.env)", "Read(**/.env.*)", "Read(*.env)",
        "Read(**/secrets.json)", "Read(**/*.pem)", "Read(**/*.key)",
        "Read(~/.ssh/**)", "Read(~/.aws/**)"
      ]
    }
  }
  ```

- **Better still, keep live values off disk entirely.** The [crown-jewel inventory](SECURITY.md) already
  says bootstrap creds should come from the host environment or a secret manager, never a file. A `.env`
  is a convenience for local dev — treat any real one as radioactive while an agent is attached.
- If a secret *does* land in a session transcript, treat it as **exposed** and rotate it. A deny rule
  stops the next leak; it cannot un-expose one that already happened.

## Running it safely — where your secrets must (and must NOT) live

secretsminter handles live credentials, so *how you store the bootstrap creds it needs* matters as much
as the code. If you (or your AI) are setting this up, these are not optional:

1. **NEVER, EVER commit a secret to this repository — or any repository.** No credential value belongs in
   a tracked file, a commit, a pull request, a branch, a log line, or a `.env` that isn't git-ignored. If
   your agent is about to write a secret where `git` can see it, stop it. secretsminter is pointed at
   secrets through the **environment**, never through source. (Value-blindness is this same discipline
   inside the tool — apply it to how you *operate* the tool.)

2. **Keep bootstrap creds in a secret manager — NOT on your local disk. Not ever.** The one-time bootstrap
   credentials secretsminter needs (a Cloudflare token, a GitHub App key, a Supabase PAT) belong in a
   **secret manager** — **GitHub Actions secrets**, your cloud's secret store, a vault — and get **injected
   into secretsminter's runtime as environment variables**. A local `.env` full of bootstrap creds is a
   get-started convenience *only*; the moment you're past first-run, get them off your machine. Secrets on
   a laptop leak — backups, cloud sync, an AI-enabled editor (see the trap above) — while secrets in a
   manager are access-controlled, audited, and never a file someone can open. **Run secretsminter where the
   secrets already are** (a CI job, a container that injects them at runtime) rather than on a workstation
   holding a `.env`.

3. **Ephemeral-first: don't store what you can mint on demand.** Where a vendor supports short-lived
   credentials (Cloudflare R2 Temporary Credentials, GitHub App installation tokens), prefer them — they
   self-expire, so there is nothing standing to store *or* rotate. The safest secret is the one that no
   longer exists five minutes from now.

**Other things worth knowing if you're trying the minter:**

4. **Start read-only.** Drive `status` / `list_secrets`, then `plan` (a dry-run by default) — see what
   *would* happen before anything mutates. `mint_and_place` is the only tool that changes the world, and
   it is approval-gated.

5. **The signed manifest is the trust root — respect it.** Nothing is placed anywhere except a destination
   on the signed allow-list. Adding a destination is a deliberate, out-of-band, human-approved change to
   the manifest — never something the agent does from its own chat. The urge to have the agent "just add a
   destination" is the exact moment the allow-list is protecting you.

6. **Approval + kill switch are out-of-band by design.** They are not MCP tools; a prompt-injected agent
   cannot self-approve or disable them. Don't "helpfully" wire them into the agent surface — that defeats
   the containment.

7. **Rotate the crown jewels yourself, out-of-band.** secretsminter refuses to rotate its own bootstrap
   creds (a self-lockout guard). Those you rotate on your own cadence, from the vendor account down —
   everything *below* them, secretsminter keeps fresh for you.

8. **If a secret ever lands where it shouldn't** — a transcript, a log, a commit — **treat it as exposed
   and rotate it.** Hygiene and deny-rules stop the *next* leak; they cannot un-expose one that already
   happened.

## How to report a security concern

- For a **non-sensitive** issue (a confusing doc, a design question, a hardening idea), open a normal
  GitHub issue.
- For a **sensitive** finding (a way to exfiltrate a value, bypass the allow-list, defeat the kill
  switch, or escalate the agent's authority), please use GitHub's **private security advisory**
  ("Report a vulnerability") on this repository rather than a public issue, so a fix can land before
  the detail is public.

We will read every report, respond, and credit reviewers who want credit.

## What "at risk" means here

A feature is **at risk** — and should not be used in production — if any of these is true:

- it throws `NotWiredError` (the live path isn't built yet);
- its story in [`docs/stories/`](docs/stories/) is marked `NOT BUILT` or `at-risk`;
- [`SECURITY.md`](SECURITY.md) lists its control as unverified.

When a feature graduates — built, tested, reviewed — its story flips to done and the at-risk marker is
removed. Until then, treat it as scaffolding for review, not a dependency.

Thank you for looking closely. That is exactly what this tool needs.
