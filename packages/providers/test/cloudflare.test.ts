import { createHash } from "node:crypto";
import type { MintInput, MintedSecret } from "@secretsminter/core";
import { describe, expect, it } from "vitest";
import { CloudflareProvider, r2S3Credentials, type HttpFn, type S3HeadFn } from "../src/cloudflare.js";

const input: MintInput = {
  name: "R2_TOKEN",
  secretClass: "ephemeral-cred",
  target: { store: "file", name: "x" },
  scopes: [],
};

interface Captured {
  url?: string;
  body?: string;
  headers?: Record<string, string>;
}

function okHttp(captured?: Captured): HttpFn {
  return async (url, init) => {
    if (captured) {
      captured.url = url;
      captured.body = init.body;
      captured.headers = init.headers;
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          success: true,
          result: { accessKeyId: "tmp-akid", secretAccessKey: "tmp-secret", sessionToken: "tmp-session" },
        }),
    };
  };
}

function provider(over?: { http?: HttpFn; s3Head?: S3HeadFn }): CloudflareProvider {
  return new CloudflareProvider({
    accountId: "acct123",
    bucket: "secretsminter-test",
    parentAccessKeyId: "PARENT_AKID",
    apiToken: "TOKEN_VALUE",
    http: over?.http ?? okHttp(),
    s3Head: over?.s3Head ?? (async () => 200),
  });
}

describe("CloudflareProvider.mint (R2 temporary credentials)", () => {
  it("builds the correct temp-credentials request", async () => {
    const cap: Captured = {};
    await provider({ http: okHttp(cap) }).mint(input);
    expect(cap.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct123/r2/temp-access-credentials");
    expect(cap.headers?.["Authorization"]).toBe("Bearer TOKEN_VALUE");
    const body = JSON.parse(cap.body ?? "{}");
    expect(body).toMatchObject({
      bucket: "secretsminter-test",
      parentAccessKeyId: "PARENT_AKID",
      permission: "object-read-write",
    });
    expect(typeof body.ttlSeconds).toBe("number");
  });

  it("returns the credentials wrapped, and leaks nothing under serialization", async () => {
    const minted = await provider().mint(input);
    expect(minted.material.expose()).toBe("tmp-secret");
    expect(minted.extra?.["accessKeyId"]?.expose()).toBe("tmp-akid");
    expect(minted.extra?.["sessionToken"]?.expose()).toBe("tmp-session");
    expect(typeof minted.expiresAt).toBe("string");
    expect(JSON.stringify(minted)).not.toContain("tmp-secret");
    expect(JSON.stringify(minted)).not.toContain("tmp-session");
  });

  it("throws on an HTTP error WITHOUT leaking the response body", async () => {
    const p = provider({ http: async () => ({ status: 403, text: async () => "LEAKED-SECRET-abc123" }) });
    await expect(p.mint(input)).rejects.toThrow(/HTTP 403/);
    await p.mint(input).catch((e: unknown) => {
      expect((e as Error).message).not.toContain("LEAKED-SECRET");
    });
  });

  it("throws on non-JSON and on a response with no credentials", async () => {
    await expect(
      provider({ http: async () => ({ status: 200, text: async () => "not json" }) }).mint(input),
    ).rejects.toThrow(/not valid JSON/);
    await expect(
      provider({
        http: async () => ({ status: 200, text: async () => JSON.stringify({ success: false }) }),
      }).mint(input),
    ).rejects.toThrow(/no credentials/);
  });
});

describe("CloudflareProvider.verify / rotate / revoke", () => {
  it("verify is a real S3 HEAD: true on <400, false on >=400", async () => {
    const minted = await provider().mint(input);
    expect(await provider({ s3Head: async () => 200 }).verify(minted.descriptor, minted)).toBe(true);
    expect(await provider({ s3Head: async () => 403 }).verify(minted.descriptor, minted)).toBe(false);
  });

  it("rotate mints a fresh set of temporary credentials", async () => {
    const minted = await provider().rotate({
      id: "d",
      name: "R2_TOKEN",
      provider: "cloudflare",
      secretClass: "ephemeral-cred",
      target: input.target,
      scopes: [],
    });
    expect(minted.material.expose()).toBe("tmp-secret");
  });

  it("revoke is a no-op (temporary credentials self-expire)", async () => {
    await expect(
      provider().revoke({
        id: "d",
        name: "R2_TOKEN",
        provider: "cloudflare",
        secretClass: "ephemeral-cred",
        target: input.target,
        scopes: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("verify returns false if the minted secret is missing its extra creds", async () => {
    const bare: MintedSecret = {
      descriptor: {
        id: "d",
        name: "R2_TOKEN",
        provider: "cloudflare",
        secretClass: "ephemeral-cred",
        target: input.target,
        scopes: [],
      },
      material: (await provider().mint(input)).material, // a SecretValue, but no extra
    };
    expect(await provider().verify(bare.descriptor, bare)).toBe(false);
  });
});

describe("r2S3Credentials (long-lived token derivation)", () => {
  it("derives accessKeyId=token id and secretAccessKey=sha256(token value), wrapped", () => {
    const pair = r2S3Credentials("TOKEN_ID", "token-value");
    expect(pair.accessKeyId).toBe("TOKEN_ID");
    expect(pair.secretAccessKey.expose()).toBe(
      createHash("sha256").update("token-value", "utf8").digest("hex"),
    );
    expect(JSON.stringify(pair)).not.toContain(pair.secretAccessKey.expose());
  });
});

describe("CloudflareProvider.fromEnv (the bootstrap seam)", () => {
  const full = {
    SECRETSMINTER_CF_ACCOUNT_ID: "a",
    SECRETSMINTER_CF_BUCKET: "b",
    SECRETSMINTER_CF_PARENT_ACCESS_KEY_ID: "c",
    SECRETSMINTER_CF_API_TOKEN: "d",
  };

  it("builds when all four vars are present", () => {
    expect(() => CloudflareProvider.fromEnv(full)).not.toThrow();
  });

  it("throws naming exactly what's missing", () => {
    const { SECRETSMINTER_CF_API_TOKEN: _omit, ...partial } = full;
    expect(() => CloudflareProvider.fromEnv(partial)).toThrow(/apiToken/);
  });
});
