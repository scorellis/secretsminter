# Contributing to secretsminter

Thank you for looking closely — a secrets broker earns trust only through scrutiny. Contributions of
every kind are welcome: adversarial tests, hardening, clearer docs, a provider you need, or simply a
well-argued issue about something that looks wrong. See [`AI_REVIEW.md`](AI_REVIEW.md) for the spirit
of the thing; this file is the mechanics.

## Ground rules that are non-negotiable

These exist because of what this tool does. A PR that violates one will be asked to change.

1. **No secret value ever crosses the tool boundary, an error string, or a log line.** If your change
   touches serialization, error handling, or logging, it must preserve value-blindness as a
   *mechanism* — positive whitelisting (`whitelistSerialize`) and scrubbing (`scrub`/`scrubError`),
   not a hopeful convention. See [`docs/adrs/0001`](docs/adrs/).
2. **No feature claims to exist before it is built (no vaporware).** A not-yet-wired path throws
   `NotWiredError` and its story says `NOT BUILT`. Don't write a README line, a doc, or a comment that
   describes a capability that isn't there. Flip a claim to present-tense only when its story is done.
3. **The destination allow-list is default-deny.** Any code on the place/rotate path must go through
   the manifest check (`assertAllowed`). Don't add a bypass, and don't let an omitted field become a
   wildcard.
4. **The kill switch and approval are never MCP tools.** They are out-of-band by design. Don't expose
   them to the agent surface.

## Development

```bash
npm install
npm test          # the security-core suite (vitest)
npm run build     # tsc --build across all packages
npm run typecheck
```

- **TypeScript, strict.** The repo runs `tsc` in strict mode with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. Keep it green.
- **Tests-first for the security core.** Anything in `@secretsminter/core` lands with a test — and if the
  change concerns a control, prefer an **adversarial** test: one that *attempts* the bad thing (leak a
  value, place into a disallowed destination, rotate a `NEVER_ROTATE` secret, revoke before verify) and
  asserts it fails.

## Decisions get an ADR

A design decision goes through an Architecture Decision Record in [`docs/adrs/`](docs/adrs/) (Nygard
format, write-once — supersede with a new ADR rather than editing an old one). If your change reverses
or extends a decision, add the ADR in the same PR.

## Reporting security issues

Sensitive findings: use GitHub's private security advisory ("Report a vulnerability"). Everything else:
a normal issue or PR. Reviewers who want credit will get it.
