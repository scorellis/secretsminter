/**
 * Local random-secret provider (story 0020).
 *
 * The generic MINT source for **app-level random secrets** — an HMAC signing secret, a download-link
 * signing secret, a webhook secret, any high-entropy value an application needs but no vendor issues.
 * It closes the gap where a human had to hand-run `openssl rand`/`head -c 32 /dev/urandom`, read the
 * value, and paste it into a file: secretsminter mints it VALUE-BLIND (the material lives only in a
 * `SecretValue`) and the placement/rotation pipeline writes it to an allow-listed destination without
 * anyone ever seeing it.
 *
 * LOCAL by construction: **no network, no vendor, no bootstrap credential.** The material is generated
 * with Node's CSPRNG (`crypto.randomBytes`). Because there is no vendor account behind it, `fromEnv`
 * never throws for missing env — this provider is *always available* (unlike the cloud providers, which
 * are skipped when their bootstrap secret is absent).
 *
 * Value-blindness: `mint` returns the value wrapped in a `SecretValue`; it is never logged, never put on
 * a `ToolResult`, and the only error path (an out-of-range configured length) carries no material.
 */

import { randomBytes as nodeRandomBytes } from "node:crypto";
import {
  SecretValue,
  type MintInput,
  type MintedSecret,
  type Provider,
  type ProviderInfo,
  type SecretDescriptor,
} from "@secretsminter/core";

/** Output encodings for the random material. All three are safe Buffer encodings. */
export type SecretEncoding = "hex" | "base64" | "base64url";

/** Injectable CSPRNG seam — defaults to `crypto.randomBytes`. Tests inject a deterministic fill. */
export type RandomBytesFn = (size: number) => Buffer;

export interface LocalSecretConfig {
  /** Entropy in bytes (default 32 → a 256-bit secret). Bounded to [16, 1024] so a misconfiguration
   *  can neither produce a weak secret nor exhaust memory. */
  readonly bytes?: number;
  /** How the random bytes are encoded into the secret string (default `hex`). */
  readonly encoding?: SecretEncoding;
  readonly randomBytes?: RandomBytesFn;
}

const DEFAULT_BYTES = 32;
const DEFAULT_ENCODING: SecretEncoding = "hex";
const MIN_BYTES = 16; // 128-bit floor — never mint a weak secret
const MAX_BYTES = 1024;

function validBytes(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_BYTES && n <= MAX_BYTES;
}

export class LocalSecretProvider implements Provider {
  readonly id = "local" as const;
  readonly #bytes: number;
  readonly #encoding: SecretEncoding;
  readonly #randomBytes: RandomBytesFn;

  constructor(cfg: LocalSecretConfig = {}) {
    const bytes = cfg.bytes ?? DEFAULT_BYTES;
    if (!validBytes(bytes)) {
      throw new Error(
        `LocalSecretProvider: bytes must be an integer in [${MIN_BYTES}, ${MAX_BYTES}], got ${bytes}`,
      );
    }
    this.#bytes = bytes;
    this.#encoding = cfg.encoding ?? DEFAULT_ENCODING;
    this.#randomBytes = cfg.randomBytes ?? nodeRandomBytes;
  }

  /**
   * Build from environment — for registry symmetry with the cloud providers. It needs NO bootstrap
   * secret, so it NEVER throws: missing or invalid optional config falls back to the defaults, keeping
   * this provider unconditionally available. Optional knobs:
   *   - `SECRETSMINTER_LOCAL_SECRET_BYTES`    — entropy in bytes (default 32)
   *   - `SECRETSMINTER_LOCAL_SECRET_ENCODING` — `hex` | `base64` | `base64url` (default `hex`)
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): LocalSecretProvider {
    const cfg: { -readonly [K in keyof LocalSecretConfig]?: LocalSecretConfig[K] } = {};
    const rawBytes = env["SECRETSMINTER_LOCAL_SECRET_BYTES"];
    if (rawBytes !== undefined && rawBytes !== "") {
      const n = Number(rawBytes);
      if (validBytes(n)) cfg.bytes = n; // invalid → ignored, defaults apply (never throw)
    }
    const rawEnc = env["SECRETSMINTER_LOCAL_SECRET_ENCODING"];
    if (rawEnc === "hex" || rawEnc === "base64" || rawEnc === "base64url") cfg.encoding = rawEnc;
    return new LocalSecretProvider(cfg);
  }

  async mint(input: MintInput): Promise<MintedSecret> {
    const material = new SecretValue(this.#randomBytes(this.#bytes).toString(this.#encoding));
    return {
      descriptor: {
        id: `local:${input.name}`,
        name: input.name,
        provider: "local",
        secretClass: input.secretClass,
        target: input.target,
        scopes: input.scopes,
      },
      material,
    };
  }

  /** Rotation of a local random secret = mint fresh material; the placement pipeline overwrites the old
   *  value at the destination. */
  async rotate(descriptor: SecretDescriptor): Promise<MintedSecret> {
    return this.mint({
      name: descriptor.name,
      secretClass: descriptor.secretClass,
      target: descriptor.target,
      scopes: descriptor.scopes,
    });
  }

  /** No-op: a local random secret has no existence at a vendor, so there is nothing to revoke *here*.
   *  It stops being trusted when the destination is overwritten (rotate) or the consumer drops it —
   *  neither of which is a provider-side call. Documented, not a stub. */
  async revoke(_descriptor: SecretDescriptor): Promise<void> {
    /* nothing to revoke at a vendor for a locally-minted secret (see docs/stories/0020) */
  }

  /** There is no vendor to probe, so verify checks the one thing that is meaningful and local: the
   *  material is present and non-empty. A freshly-minted local secret is trivially "present", which is
   *  exactly the health the rotation state machine needs to confirm before it revokes the old value. */
  async verify(_descriptor: SecretDescriptor, secret: MintedSecret): Promise<boolean> {
    return secret.material.length > 0;
  }

  describe(): ProviderInfo {
    return {
      id: this.id,
      supportsEphemeral: false,
      notes: "Mints cryptographically-random local secret material (crypto.randomBytes); no vendor, no network.",
    };
  }
}
