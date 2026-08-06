import type { MintInput, SecretDescriptor } from "@secretsminter/core";
import { describe, expect, it } from "vitest";
import { SupabaseProvider, type HttpFn } from "../src/supabase.js";

const input: MintInput = {
  name: "SERVICE_KEY",
  secretClass: "api-token",
  target: { store: "file", name: "SERVICE_KEY" },
  scopes: [],
};

function provider(http: HttpFn): SupabaseProvider {
  return new SupabaseProvider({ projectRef: "abcref", pat: "sbp_PAT", http });
}

describe("SupabaseProvider.mint", () => {
  it("creates a secret API key via the Management API with the PAT", async () => {
    let seen = { url: "", auth: "", body: "" };
    const http: HttpFn = async (url, init) => {
      seen = { url, auth: init.headers["Authorization"] ?? "", body: init.body ?? "" };
      return { status: 201, text: async () => JSON.stringify({ id: "key_1", api_key: "sb_secret_VALUE" }) };
    };
    const minted = await provider(http).mint(input);
    expect(seen.url).toBe("https://api.supabase.com/v1/projects/abcref/api-keys");
    expect(seen.auth).toBe("Bearer sbp_PAT");
    expect(JSON.parse(seen.body)).toMatchObject({ type: "secret", description: "SERVICE_KEY" });
    expect(minted.material.expose()).toBe("sb_secret_VALUE");
    expect(minted.extra?.["keyId"]?.expose()).toBe("key_1");
    expect(JSON.stringify(minted)).not.toContain("sb_secret_VALUE"); // value-blind
  });

  it("throws (status only) on failure and on a value-less / non-JSON response", async () => {
    await expect(provider(async () => ({ status: 403, text: async () => "SECRET-BODY" })).mint(input)).rejects.toThrow(/HTTP 403/);
    await provider(async () => ({ status: 403, text: async () => "SECRET-BODY" })).mint(input).catch((e: unknown) => {
      expect((e as Error).message).not.toContain("SECRET-BODY");
    });
    await expect(provider(async () => ({ status: 201, text: async () => "nope" })).mint(input)).rejects.toThrow(/not valid JSON/);
    await expect(provider(async () => ({ status: 201, text: async () => "{}" })).mint(input)).rejects.toThrow(/no key value/);
  });
});

describe("SupabaseProvider verify / rotate / revoke / fromEnv", () => {
  const desc: SecretDescriptor = {
    id: "d",
    name: "SERVICE_KEY",
    provider: "supabase",
    secretClass: "api-token",
    target: input.target,
    scopes: [],
  };

  it("verify: true on <400, false otherwise", async () => {
    const secret = await provider(async () => ({ status: 201, text: async () => JSON.stringify({ api_key: "k" }) })).mint(input);
    expect(await provider(async () => ({ status: 200, text: async () => "[]" })).verify(desc, secret)).toBe(true);
    expect(await provider(async () => ({ status: 401, text: async () => "" })).verify(desc, secret)).toBe(false);
  });

  it("rotate mints a fresh key; revoke is a documented no-op; describe is non-ephemeral", async () => {
    const p = provider(async () => ({ status: 201, text: async () => JSON.stringify({ api_key: "k2" }) }));
    expect((await p.rotate(desc)).material.expose()).toBe("k2");
    await expect(p.revoke(desc)).resolves.toBeUndefined();
    expect(p.describe().supportsEphemeral).toBe(false);
  });

  it("fromEnv builds when present and throws naming what's missing", () => {
    expect(() => SupabaseProvider.fromEnv({ SECRETSMINTER_SB_PROJECT_REF: "r", SECRETSMINTER_SB_PAT: "p" })).not.toThrow();
    expect(() => SupabaseProvider.fromEnv({ SECRETSMINTER_SB_PROJECT_REF: "r" })).toThrow(/pat/);
  });
});
