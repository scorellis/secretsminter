---
Story: 0020
Status: BUILT — unit-tested (value-blindness asserted); no vendor/network path by design; always available
---

# 0020 — Local random-secret mint provider

**BUILT.** A generic **random-secret MINT provider** so secretsminter can mint (and then place/rotate)
app-level random secrets — an HMAC signing secret, a download-link signing secret, a webhook secret —
**value-blind**. This closes the gap where a human had to hand-run `openssl rand`/`head -c 32
/dev/urandom`, read the value, and paste it into a file or a dashboard: now the material is generated
inside the core, wrapped in a `SecretValue`, and handed to the placement pipeline without anyone (agent
or human) ever seeing it.

`LocalSecretProvider` (`packages/providers/src/local-secret.ts`), id **`local`**:
- **LOCAL by construction — no network, no vendor, no bootstrap credential.** The material comes from
  Node's CSPRNG (`crypto.randomBytes`), default **32 bytes → hex** (a 256-bit secret). Length and
  encoding (`hex` | `base64` | `base64url`) are configurable; byte length is bounded to `[16, 1024]`
  (a 128-bit floor so a misconfiguration can never mint a weak secret).
- **`mint(input)`** returns the value wrapped in a `SecretValue` inside a `MintedSecret` (descriptor +
  material). The value is NEVER logged, NEVER placed on a `ToolResult`.
- **`rotate(descriptor)`** = mint fresh material; the placement pipeline overwrites the old value at the
  destination.
- **`revoke(descriptor)`** = **no-op**, documented honestly: a locally-minted secret has no existence at
  a vendor, so there is nothing to revoke *at a provider*. It stops being trusted when the destination
  is overwritten (rotate) or the consumer drops it — neither is a provider-side call.
- **`verify(descriptor, secret)`** = returns **true** when the minted material is present and non-empty.
  There is no vendor to probe, so the meaningful, local notion of health is "the material exists" — which
  is exactly what the rotation state machine needs to confirm before it revokes the old value. (This is
  the honest analog of the cloud providers' functional probe: for a local secret, presence *is* health.)
- **`describe()`** → `supportsEphemeral: false`, notes that it mints local random material.

**`fromEnv` is always-available.** Unlike the cloud providers (skipped when their bootstrap secret is
absent), `LocalSecretProvider.fromEnv` **never throws** — it needs no bootstrap. It reads optional config
and falls back to defaults, even ignoring an invalid value rather than throwing:
- `SECRETSMINTER_LOCAL_SECRET_BYTES` — entropy in bytes (default 32)
- `SECRETSMINTER_LOCAL_SECRET_ENCODING` — `hex` | `base64` | `base64url` (default `hex`)

So `packages/daemon/src/build.ts` registers it **unconditionally** (`tryProvider("local", …)`), making
`local` a provider `mint_and_place` / `plan` can always target.

## Value-blindness
The material lives only in a `SecretValue`; the only error path (an out-of-range configured length) is a
construction-time validation that carries no material. The value-blind invariant is asserted directly in
the tests: the raw random value never appears in `JSON.stringify(minted)`, in the serialized descriptor,
or in the stringified material (`[REDACTED]`). The new `local` id was added everywhere a provider id is
enumerated: the `ProviderId` type, the value-blind `whitelistSerialize` provider whitelist, and the MCP
`provider` Zod enum — so a `local` result is never dropped to `null` and `mint_and_place` accepts it.

## Wiring changed
- `packages/core/src/types.ts` — `ProviderId` now includes `"local"`.
- `packages/core/src/value-blind.ts` — `whitelistSerialize` accepts `"local"`.
- `packages/mcp/src/server.ts` — the `mint`/`plan` `provider` enum includes `"local"`.
- `packages/providers/src/index.ts` — exports `LocalSecretProvider`.
- `packages/daemon/src/build.ts` — registers `local` unconditionally.

## Tests
- `packages/providers/test/local-secret.test.ts` — mint length/encoding; two mints differ (randomness);
  injected deterministic RNG; the value never leaks under serialization (value-blind); rotate mints
  fresh; revoke no-ops; verify true on present material; describe; `fromEnv` never throws and honors /
  ignores env config.
- `packages/daemon/test/daemon.test.ts` — extended to assert `local` is wired even with no env.

## Cross-ref
This is the missing piece for minting + placing + rotating **app HMAC secrets** (e.g. a web app's
download-link signing secret) end-to-end value-blind: `LocalSecretProvider` mints, a `Store`
(`cloudflare-pages`, `github-actions`) places, and the same allow-list + approval + audit path guards it.
It is the strongest candidate for the first **fully agent-driven place demonstration**, because it needs
no vendor bootstrap to mint — only an allow-listed destination to place into.

## Done when
- Unit-tested with value-blindness asserted — **met.**
- Wired so `mint_and_place`/`plan` can target `local` through the MCP/daemon path — **met.**
- Follow-up (not this story): an end-to-end agent-driven mint→place→rotate of a real app HMAC secret into
  an allow-listed destination, verified in the destination.
