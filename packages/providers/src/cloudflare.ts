/**
 * Cloudflare provider — ephemeral-first (docs/adrs/0012, story 0003).
 *
 * Mints **R2 Temporary Credentials** (short-lived, scoped `accessKeyId`/`secretAccessKey`/`sessionToken`)
 * from a bootstrap R2 API token, verifies them with a real S3 `HEAD`, and lets them self-expire — so
 * there is nothing to revoke. This is the honest path to "frequent rotation without upkeep."
 *
 * Confirmed API (developers.cloudflare.com):
 *   - `POST https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/temp-access-credentials`
 *   - Auth: `Authorization: Bearer <R2 API token value>` — a single bucket-scoped R2 API token gives
 *     BOTH the Bearer (its token value) AND the `parentAccessKeyId` (its Access Key ID).
 *   - Body: `{ bucket, parentAccessKeyId, permission, ttlSeconds }`; result: `{ accessKeyId,
 *     secretAccessKey, sessionToken }`.
 *
 * Value-blindness: the minted secret material lives only in a `SecretValue`; on any failure the error
 * carries a status code only — never the response body, which on success holds the credentials.
 *
 * The HTTP and S3-HEAD steps are injectable seams, so every branch is unit-tested without network; the
 * defaults use `fetch` and `aws4fetch` (SigV4) for the live path.
 */

import { AwsClient } from "aws4fetch";
import {
  r2SecretAccessKeyFromToken,
  SecretValue,
  type MintInput,
  type MintedSecret,
  type Provider,
  type ProviderInfo,
  type SecretDescriptor,
} from "@secretsminter/core";

const CF_API = "https://api.cloudflare.com/client/v4";

/** Derive the S3-compatible credential pair for a long-lived R2 API token (the alternative to
 *  temporary credentials): `accessKeyId` = token id, `secretAccessKey` = sha256(token value). Pure.
 *  The secret half is returned wrapped. See docs/spikes/0001. */
export function r2S3Credentials(tokenId: string, tokenValue: string): {
  accessKeyId: string;
  secretAccessKey: SecretValue;
} {
  return {
    accessKeyId: tokenId,
    secretAccessKey: new SecretValue(r2SecretAccessKeyFromToken(tokenValue)),
  };
}

export interface HttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type HttpFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export type S3HeadFn = (args: {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
}) => Promise<number>;

export interface CloudflareConfig {
  readonly accountId: string;
  readonly bucket: string;
  /** The bootstrap R2 API token's Access Key ID (reused as the temp credentials' parent). */
  readonly parentAccessKeyId: string;
  /** The bootstrap R2 API token's VALUE — the Bearer that authorizes the temp-credentials call. */
  readonly apiToken: string;
  readonly ttlSeconds?: number;
  readonly http?: HttpFn;
  readonly s3Head?: S3HeadFn;
}

const defaultHttp: HttpFn = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, text: () => r.text() };
};

const defaultS3Head: S3HeadFn = async ({ endpoint, bucket, accessKeyId, secretAccessKey, sessionToken }) => {
  const client = new AwsClient({ accessKeyId, secretAccessKey, sessionToken, service: "s3", region: "auto" });
  const r = await client.fetch(`${endpoint}/${bucket}`, { method: "HEAD" });
  return r.status;
};

interface TempCredsResponse {
  success?: boolean;
  result?: { accessKeyId?: string; secretAccessKey?: string; sessionToken?: string };
}

export class CloudflareProvider implements Provider {
  readonly id = "cloudflare" as const;
  readonly #accountId: string;
  readonly #bucket: string;
  readonly #parentAccessKeyId: string;
  readonly #apiToken: string;
  readonly #ttlSeconds: number;
  readonly #http: HttpFn;
  readonly #s3Head: S3HeadFn;

  constructor(cfg: CloudflareConfig) {
    this.#accountId = cfg.accountId;
    this.#bucket = cfg.bucket;
    this.#parentAccessKeyId = cfg.parentAccessKeyId;
    this.#apiToken = cfg.apiToken;
    this.#ttlSeconds = cfg.ttlSeconds ?? 900;
    this.#http = cfg.http ?? defaultHttp;
    this.#s3Head = cfg.s3Head ?? defaultS3Head;
  }

  /**
   * Build the provider from environment variables — the bootstrap ("secret zero") seam. In production
   * these are injected by a secret manager / workload identity, not pasted (see docs/MANUAL-STEPS.md).
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): CloudflareProvider {
    const accountId = env["SECRETSMINTER_CF_ACCOUNT_ID"];
    const bucket = env["SECRETSMINTER_CF_BUCKET"];
    const parentAccessKeyId = env["SECRETSMINTER_CF_PARENT_ACCESS_KEY_ID"];
    const apiToken = env["SECRETSMINTER_CF_API_TOKEN"];
    const missing = Object.entries({ accountId, bucket, parentAccessKeyId, apiToken })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`CloudflareProvider.fromEnv: missing SECRETSMINTER_CF_* for ${missing.join(", ")}`);
    }
    return new CloudflareProvider({
      accountId: accountId!,
      bucket: bucket!,
      parentAccessKeyId: parentAccessKeyId!,
      apiToken: apiToken!,
    });
  }

  async mint(input: MintInput): Promise<MintedSecret> {
    const ttlSeconds = input.ephemeralTtlSeconds ?? this.#ttlSeconds;
    const res = await this.#http(
      `${CF_API}/accounts/${this.#accountId}/r2/temp-access-credentials`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.#apiToken}` },
        body: JSON.stringify({
          bucket: this.#bucket,
          parentAccessKeyId: this.#parentAccessKeyId,
          permission: "object-read-write",
          ttlSeconds,
        }),
      },
    );
    // Never surface the body in an error — on success it holds the live credentials.
    if (res.status >= 400) {
      throw new Error(`cloudflare temp-credentials request failed (HTTP ${res.status})`);
    }
    let parsed: TempCredsResponse;
    try {
      parsed = JSON.parse(await res.text()) as TempCredsResponse;
    } catch {
      throw new Error("cloudflare temp-credentials: response was not valid JSON");
    }
    const r = parsed.result;
    if (parsed.success !== true || !r?.accessKeyId || !r?.secretAccessKey || !r?.sessionToken) {
      throw new Error("cloudflare temp-credentials: no credentials in response");
    }
    return {
      descriptor: {
        id: `cf-r2-temp:${this.#bucket}:${input.name}`,
        name: input.name,
        provider: "cloudflare",
        secretClass: input.secretClass,
        target: input.target,
        scopes: input.scopes,
      },
      material: new SecretValue(r.secretAccessKey),
      extra: { accessKeyId: new SecretValue(r.accessKeyId), sessionToken: new SecretValue(r.sessionToken) },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** Ephemeral rotation = mint a fresh set of temporary credentials. */
  async rotate(descriptor: SecretDescriptor): Promise<MintedSecret> {
    return this.mint({
      name: descriptor.name,
      secretClass: descriptor.secretClass,
      target: descriptor.target,
      scopes: descriptor.scopes,
    });
  }

  /** Temporary credentials self-expire; there is nothing to revoke. */
  async revoke(_descriptor: SecretDescriptor): Promise<void> {
    /* no-op: ephemeral credentials expire on their own (see docs/adrs/0012) */
  }

  /** Real health probe: a signed S3 HEAD against the bucket with the minted credentials. */
  async verify(_descriptor: SecretDescriptor, secret: MintedSecret): Promise<boolean> {
    const accessKeyId = secret.extra?.["accessKeyId"]?.expose();
    const sessionToken = secret.extra?.["sessionToken"]?.expose();
    if (accessKeyId === undefined || sessionToken === undefined) return false;
    const status = await this.#s3Head({
      endpoint: `https://${this.#accountId}.r2.cloudflarestorage.com`,
      bucket: this.#bucket,
      accessKeyId,
      secretAccessKey: secret.material.expose(),
      sessionToken,
    });
    return status < 400;
  }

  describe(): ProviderInfo {
    return {
      id: this.id,
      supportsEphemeral: true,
      notes: "R2 Temporary Credentials (ephemeral-first); S3 secret derivation for long-lived tokens.",
    };
  }
}
