/**
 * Supabase provider (story 0005) — the current (2026) key model.
 *
 * Mints a **secret API key** for a project via the **Management API**, authenticated with a
 * project-scoped **Personal Access Token** (the bootstrap crown jewel). The older "rotate the
 * service_role key" model is stale; this uses `POST /v1/projects/{ref}/api-keys`.
 *
 * Value-blindness: the minted key lives only in a `SecretValue`; errors carry an HTTP status only,
 * never a body. HTTP is an injectable seam → network-free unit tests. Exact request/response fields
 * follow the Supabase Management API and are confirmed at the live run (like every provider).
 *
 * Honest limitation: revoking a *long-lived* key needs the vendor's key id threaded back through the
 * broker's descriptor — a follow-up (`revoke` is a documented no-op for now). Rotation still works by
 * minting a fresh key; pair it with the dual-credential overlap window until revoke-old lands.
 */

import {
  SecretValue,
  type MintInput,
  type MintedSecret,
  type Provider,
  type ProviderInfo,
  type SecretDescriptor,
} from "@secretsminter/core";

const SB_API = "https://api.supabase.com";

export interface HttpResponse {
  readonly status: number;
  text(): Promise<string>;
}
export type HttpFn = (
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

const defaultHttp: HttpFn = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, text: () => r.text() };
};

export interface SupabaseConfig {
  readonly projectRef: string;
  /** Personal Access Token — the Bearer for the Management API (bootstrap crown jewel, one project). */
  readonly pat: string;
  readonly http?: HttpFn;
}

interface CreatedKey {
  id?: string;
  api_key?: string;
  secret?: string;
}

export class SupabaseProvider implements Provider {
  readonly id = "supabase" as const;
  readonly #projectRef: string;
  readonly #pat: string;
  readonly #http: HttpFn;

  constructor(cfg: SupabaseConfig) {
    this.#projectRef = cfg.projectRef;
    this.#pat = cfg.pat;
    this.#http = cfg.http ?? defaultHttp;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env): SupabaseProvider {
    const projectRef = env["SECRETSMINTER_SB_PROJECT_REF"];
    const pat = env["SECRETSMINTER_SB_PAT"];
    const missing = Object.entries({ projectRef, pat })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`SupabaseProvider.fromEnv: missing SECRETSMINTER_SB_* for ${missing.join(", ")}`);
    }
    return new SupabaseProvider({ projectRef: projectRef!, pat: pat! });
  }

  #auth(): Record<string, string> {
    return { Authorization: `Bearer ${this.#pat}`, Accept: "application/json" };
  }

  async mint(input: MintInput): Promise<MintedSecret> {
    const res = await this.#http(`${SB_API}/v1/projects/${this.#projectRef}/api-keys`, {
      method: "POST",
      headers: { ...this.#auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ type: "secret", description: input.name }),
    });
    if (res.status >= 400) throw new Error(`supabase create-api-key failed (HTTP ${res.status})`);
    let key: CreatedKey;
    try {
      key = JSON.parse(await res.text()) as CreatedKey;
    } catch {
      throw new Error("supabase create-api-key: response was not valid JSON");
    }
    const value = key.api_key ?? key.secret;
    if (!value) throw new Error("supabase create-api-key: no key value in response");
    return {
      descriptor: {
        id: `supabase:${this.#projectRef}:${input.name}`,
        name: input.name,
        provider: "supabase",
        secretClass: input.secretClass,
        target: input.target,
        scopes: input.scopes,
      },
      material: new SecretValue(value),
      ...(key.id ? { extra: { keyId: new SecretValue(key.id) } } : {}),
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

  /** No-op for now: deleting a long-lived key needs the vendor key id threaded through the descriptor
   *  (a follow-up). Rotation still mints a fresh key; use the overlap window until revoke-old lands. */
  async revoke(_descriptor: SecretDescriptor): Promise<void> {
    /* documented limitation — see the story */
  }

  /** Functional verify: the Management API lists the project's keys with the PAT. */
  async verify(_descriptor: SecretDescriptor, _secret: MintedSecret): Promise<boolean> {
    const res = await this.#http(`${SB_API}/v1/projects/${this.#projectRef}/api-keys`, {
      headers: this.#auth(),
    });
    return res.status < 400;
  }

  describe(): ProviderInfo {
    return { id: this.id, supportsEphemeral: false, notes: "Secret API keys via the Management API + PAT." };
  }
}
