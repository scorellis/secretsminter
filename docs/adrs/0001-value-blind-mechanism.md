# 0001 — Value-blindness is a mechanism, not an outcome

Status: Accepted
Date: 2026-07-29

## Context

secretsminter mints, places, and rotates live cloud credentials on behalf of an AI agent over MCP. Every mint necessarily pulls a raw secret value into the core's memory. "The agent never sees the value" is easy to *assert* and hard to *guarantee*: a single leak channel — a provider response field copied verbatim, an error string that inlines a command's `stderr` or `argv`, a debug log line — defeats it. This is OWASP LLM06 (sensitive-information disclosure). If value-blindness is left as a hoped-for property rather than an enforced boundary, it will fail the first time a provider adds a field or an exception carries a token.

## Decision

Value-blindness is implemented as a set of enforced primitives at the tool boundary, not a convention:

1. **Positive-whitelist serialization.** `whitelistSerialize` (`packages/core/src/value-blind.ts`) builds the `ToolResult` field-by-field from the fixed `TOOL_RESULT_FIELDS` set (`ok, provider, action, secret_id, placed_at`). It projects onto allowed fields rather than copying-then-deleting, so a newly-added provider field — including a leaked `value` / `token` / `secretAccessKey` — is structurally impossible to emit.
2. **A secret-scrubber on every error and log path.** `scrub` / `scrubError` redact any known live material (length ≥ `MIN_SCRUB_LENGTH`) to `[REDACTED]`, belt-and-suspenders over the whitelist so even an error that inlined a value is masked.
3. **stdin-only secret transit.** Live material crosses process boundaries via stdin, never `argv` (argv is world-readable and lands in shell history and error dumps). `MintedSecret.material` (`packages/core/src/provider.ts`) is documented as never-serialized.
4. **Mint-only in v1.** No tool accepts a caller-supplied secret value; an "import this token" parameter would put the value in the agent's transcript before the broker ever ran.
5. **Fingerprint-only audit.** `auditFingerprint` (`packages/core/src/crypto.ts`) stores a truncated keyed HMAC, never the value.
6. **A self-redacting material wrapper.** Live material is held in a `SecretValue` class (`packages/core/src/secret-value.ts`), not a bare string. Its private field plus overridden `toString`/`toJSON`/`util.inspect` make every implicit stringification path — `JSON.stringify`, `console.log`, template interpolation — emit `[REDACTED]`. The raw value is reachable only through `.expose()`, a deliberately conspicuous name so `grep -rn "\.expose("` enumerates every read site. This removes the reliance on a maintainer *remembering* not to serialize a secret; leaking now takes deliberate effort, not an oversight.

## Consequences

Value-blindness becomes testable and hard to regress: adversarial tests assert that a leaked field never appears in a `ToolResult` and that error paths return only redacted codes.

**Crucially, this is necessary but not the trust root.** Value-blindness stops the agent *reading* a secret. It does nothing to stop a prompt-injected agent *directing* a live secret to an attacker — "mint an R2 token and place it into `attacker/evil`'s Actions secrets" exfiltrates a working credential the agent never sees. Containing that is the destination allow-list's job (ADR-0008). The two layers are independent and both required.
