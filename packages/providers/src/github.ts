/**
 * GitHub provider + Actions store (story 0004).
 *
 * - **Provider**: mints short-lived **App installation tokens** (~1h) from the App private key. It
 *   builds an RS256 App JWT, exchanges it for an installation token, and hands that out as an ephemeral
 *   credential. Rotation = re-mint; revoke = no-op (they self-expire), matching the ephemeral-first line.
 * - **Store**: places a secret into a repo's **Actions secrets**, value-blind, via a libsodium
 *   **sealed box** — GET the repo public key, encrypt, PUT the ciphertext. The plaintext never leaves
 *   the process; only ciphertext is transmitted.
 *
 * The JWT signing is pure/testable; HTTP and the sealed-box encryption are injectable seams, so every
 * branch is unit-tested without network or a real key. Value-blindness: material lives only in a
 * `SecretValue`; errors carry an HTTP status only, never a body.
 */

import { createSign } from "node:crypto";
import {
  SecretValue,
  type MintInput,
  type MintedSecret,
  type PlaceTarget,
  type Provider,
  type ProviderInfo,
  type SecretDescriptor,
  type Store,
} from "@secretsminter/core";

const GH_API = "https://api.github.com";
const GH_HEADERS = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

export interface HttpResponse {
  readonly status: number;
  text(): Promise<string>;
}
export type HttpFn = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

/** Seal `plaintext` for the repo's Actions public key (base64), returning base64 ciphertext. */
export type SealFn = (plaintext: string, publicKeyBase64: string) => Promise<string>;

const defaultHttp: HttpFn = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, text: () => r.text() };
};

interface SodiumLike {
  ready: Promise<void>;
  base64_variants: { ORIGINAL: number };
  from_base64(s: string, v: number): Uint8Array;
  from_string(s: string): Uint8Array;
  crypto_box_seal(m: Uint8Array, pk: Uint8Array): Uint8Array;
  to_base64(b: Uint8Array, v: number): string;
}

const defaultSeal: SealFn = async (plaintext, publicKeyBase64) => {
  const mod = await import("libsodium-wrappers");
  const sodium = ((mod as { default?: SodiumLike }).default ?? (mod as unknown)) as SodiumLike;
  await sodium.ready;
  const key = sodium.from_base64(publicKeyBase64, sodium.base64_variants.ORIGINAL);
  const sealed = sodium.crypto_box_seal(sodium.from_string(plaintext), key);
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
};

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/** Build a signed GitHub App JWT (RS256). Pure — the piece of the flow that needs no network. */
export function makeAppJwt(appId: string, privateKeyPem: string, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }));
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKeyPem);
  return `${signingInput}.${b64url(signature)}`;
}

export interface GithubConfig {
  readonly appId: string;
  readonly installationId: string;
  readonly privateKeyPem: string;
  readonly http?: HttpFn;
  /** ms-since-epoch clock, for the JWT's iat/exp. Injectable for tests. */
  readonly now?: () => number;
}

interface InstallationToken {
  token: string;
  expires_at?: string;
}

export class GithubProvider implements Provider {
  readonly id = "github" as const;
  readonly #appId: string;
  readonly #installationId: string;
  readonly #privateKeyPem: string;
  readonly #http: HttpFn;
  readonly #now: () => number;

  constructor(cfg: GithubConfig) {
    this.#appId = cfg.appId;
    this.#installationId = cfg.installationId;
    this.#privateKeyPem = cfg.privateKeyPem;
    this.#http = cfg.http ?? defaultHttp;
    this.#now = cfg.now ?? (() => Date.now());
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): GithubProvider {
    const appId = env["SECRETSMINTER_GH_APP_ID"];
    const installationId = env["SECRETSMINTER_GH_INSTALLATION_ID"];
    // PEM env vars usually carry literal "\n" — restore real newlines.
    const privateKeyPem = env["SECRETSMINTER_GH_PRIVATE_KEY"]?.replace(/\\n/g, "\n");
    const missing = Object.entries({ appId, installationId, privateKeyPem })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`GithubProvider.fromEnv: missing SECRETSMINTER_GH_* for ${missing.join(", ")}`);
    }
    return new GithubProvider({ appId: appId!, installationId: installationId!, privateKeyPem: privateKeyPem! });
  }

  /** Mint a fresh installation token (~1h). Public so a Store can use it for its own auth. */
  async installationToken(): Promise<{ token: string; expiresAt?: string }> {
    const jwt = makeAppJwt(this.#appId, this.#privateKeyPem, Math.floor(this.#now() / 1000));
    const res = await this.#http(
      `${GH_API}/app/installations/${this.#installationId}/access_tokens`,
      { method: "POST", headers: { ...GH_HEADERS, Authorization: `Bearer ${jwt}` } },
    );
    if (res.status >= 400) throw new Error(`github installation-token failed (HTTP ${res.status})`);
    let parsed: InstallationToken;
    try {
      parsed = JSON.parse(await res.text()) as InstallationToken;
    } catch {
      throw new Error("github installation-token: response was not valid JSON");
    }
    if (!parsed.token) throw new Error("github installation-token: no token in response");
    return parsed.expires_at !== undefined
      ? { token: parsed.token, expiresAt: parsed.expires_at }
      : { token: parsed.token };
  }

  async mint(input: MintInput): Promise<MintedSecret> {
    const { token, expiresAt } = await this.installationToken();
    return {
      descriptor: {
        id: `gh-installation:${this.#installationId}:${input.name}`,
        name: input.name,
        provider: "github",
        secretClass: input.secretClass,
        target: input.target,
        scopes: input.scopes,
      },
      material: new SecretValue(token),
      ...(expiresAt ? { expiresAt } : {}),
    };
  }

  async rotate(descriptor: SecretDescriptor): Promise<MintedSecret> {
    return this.mint({
      name: descriptor.name,
      secretClass: descriptor.secretClass,
      target: descriptor.target,
      scopes: descriptor.scopes,
    });
  }

  /** Installation tokens self-expire (~1h); nothing to revoke. */
  async revoke(_descriptor: SecretDescriptor): Promise<void> {
    /* no-op: ephemeral */
  }

  async verify(_descriptor: SecretDescriptor, secret: MintedSecret): Promise<boolean> {
    const res = await this.#http(`${GH_API}/installation/repositories?per_page=1`, {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${secret.material.expose()}` },
    });
    return res.status < 400;
  }

  describe(): ProviderInfo {
    return { id: this.id, supportsEphemeral: true, notes: "App installation tokens (~1h)." };
  }
}

export interface GithubActionsStoreConfig {
  /** Supplies an installation token for the store's OWN auth (e.g. a GithubProvider bound to the repo). */
  readonly getInstallationToken: () => Promise<string>;
  readonly http?: HttpFn;
  readonly seal?: SealFn;
}

export class GithubActionsStore implements Store {
  readonly id = "github-actions" as const;
  readonly #getToken: () => Promise<string>;
  readonly #http: HttpFn;
  readonly #seal: SealFn;

  constructor(cfg: GithubActionsStoreConfig) {
    this.#getToken = cfg.getInstallationToken;
    this.#http = cfg.http ?? defaultHttp;
    this.#seal = cfg.seal ?? defaultSeal;
  }

  async place(target: PlaceTarget, secret: MintedSecret): Promise<void> {
    if (target.repo === undefined) throw new Error("github-actions store requires target.repo");
    // Defense in depth (the allow-list already matched this target): a secret name is a single path
    // segment — never a '/' — and every interpolated segment is percent-encoded so a crafted name/repo
    // can't traverse or reshape the URL path within the fixed api.github.com host.
    if (target.name.includes("/")) throw new Error("github-actions store: secret name must not contain '/'");
    const repoPath = target.repo.split("/").map(encodeURIComponent).join("/");
    const secretName = encodeURIComponent(target.name);
    const token = await this.#getToken();
    const auth = { ...GH_HEADERS, Authorization: `Bearer ${token}` };

    const keyRes = await this.#http(`${GH_API}/repos/${repoPath}/actions/secrets/public-key`, { headers: auth });
    if (keyRes.status >= 400) throw new Error(`github public-key failed (HTTP ${keyRes.status})`);
    const pk = JSON.parse(await keyRes.text()) as { key?: string; key_id?: string };
    if (!pk.key || !pk.key_id) throw new Error("github public-key: malformed response");

    const encryptedValue = await this.#seal(secret.material.expose(), pk.key);
    const putRes = await this.#http(
      `${GH_API}/repos/${repoPath}/actions/secrets/${secretName}`,
      {
        method: "PUT",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted_value: encryptedValue, key_id: pk.key_id }),
      },
    );
    if (putRes.status >= 400) throw new Error(`github put-secret failed (HTTP ${putRes.status})`);
  }
}
