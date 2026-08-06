import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import type { MintInput, PlaceTarget, SecretDescriptor } from "@secretsminter/core";
import { describe, expect, it } from "vitest";
import {
  GithubActionsStore,
  GithubProvider,
  makeAppJwt,
  type HttpFn,
  type SealFn,
} from "../src/github.js";

const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const input: MintInput = {
  name: "DEPLOY_TOKEN",
  secretClass: "ephemeral-cred",
  target: { store: "github-actions", repo: "acme/app", name: "DEPLOY_TOKEN" },
  scopes: [],
};

describe("makeAppJwt", () => {
  it("produces a verifiable RS256 JWT with the App claims", () => {
    const jwt = makeAppJwt("appid-123", PRIVATE_PEM, 1_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
    expect(payload).toMatchObject({ iss: "appid-123", iat: 999_940, exp: 1_000_540 });
    const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s!, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("GithubProvider (installation tokens)", () => {
  function provider(http: HttpFn): GithubProvider {
    return new GithubProvider({
      appId: "a",
      installationId: "42",
      privateKeyPem: PRIVATE_PEM,
      http,
      now: () => 1_000_000_000,
    });
  }

  it("mints an installation token, authenticating the exchange with an App JWT", async () => {
    let seenAuth = "";
    const http: HttpFn = async (url, init) => {
      seenAuth = init.headers["Authorization"] ?? "";
      expect(url).toContain("/app/installations/42/access_tokens");
      return { status: 201, text: async () => JSON.stringify({ token: "ghs_live_TOKEN", expires_at: "2026-07-31T17:00:00Z" }) };
    };
    const minted = await provider(http).mint(input);
    expect(seenAuth.startsWith("Bearer ")).toBe(true); // an App JWT
    expect(minted.material.expose()).toBe("ghs_live_TOKEN");
    expect(minted.expiresAt).toBe("2026-07-31T17:00:00Z");
    expect(JSON.stringify(minted)).not.toContain("ghs_live_TOKEN"); // value-blind
  });

  it("throws (status only) on a failed exchange, without leaking the body", async () => {
    const http: HttpFn = async () => ({ status: 403, text: async () => "SECRET-IN-BODY" });
    await expect(provider(http).mint(input)).rejects.toThrow(/HTTP 403/);
    await provider(http).mint(input).catch((e: unknown) => {
      expect((e as Error).message).not.toContain("SECRET-IN-BODY");
    });
  });

  it("verify: true on <400, false otherwise", async () => {
    const minted = await provider(async () => ({ status: 201, text: async () => JSON.stringify({ token: "t" }) })).mint(input);
    expect(await provider(async () => ({ status: 200, text: async () => "" })).verify(minted.descriptor, minted)).toBe(true);
    expect(await provider(async () => ({ status: 401, text: async () => "" })).verify(minted.descriptor, minted)).toBe(false);
  });

  it("rotate re-mints; revoke is a no-op; describe supports ephemeral", async () => {
    const p = provider(async () => ({ status: 201, text: async () => JSON.stringify({ token: "t2" }) }));
    const desc: SecretDescriptor = { id: "d", name: "X", provider: "github", secretClass: "ephemeral-cred", target: input.target, scopes: [] };
    expect((await p.rotate(desc)).material.expose()).toBe("t2");
    await expect(p.revoke(desc)).resolves.toBeUndefined();
    expect(p.describe().supportsEphemeral).toBe(true);
  });

  it("throws on a non-JSON or token-less response", async () => {
    await expect(provider(async () => ({ status: 201, text: async () => "not json" })).mint(input)).rejects.toThrow(/not valid JSON/);
    await expect(provider(async () => ({ status: 201, text: async () => "{}" })).mint(input)).rejects.toThrow(/no token/);
  });
});

describe("GithubProvider.fromEnv (bootstrap seam)", () => {
  const full = {
    SECRETSMINTER_GH_APP_ID: "a",
    SECRETSMINTER_GH_INSTALLATION_ID: "42",
    SECRETSMINTER_GH_PRIVATE_KEY: "-----BEGIN-----\\nline\\n-----END-----",
  };
  it("builds when all present", () => {
    expect(() => GithubProvider.fromEnv(full)).not.toThrow();
  });
  it("throws naming what's missing", () => {
    const { SECRETSMINTER_GH_PRIVATE_KEY: _omit, ...partial } = full;
    expect(() => GithubProvider.fromEnv(partial)).toThrow(/privateKeyPem/);
  });
});

describe("GithubActionsStore (sealed-box placement)", () => {
  const target: PlaceTarget = { store: "github-actions", repo: "acme/app", name: "R2_TOKEN" };
  const secret = {
    descriptor: {} as SecretDescriptor,
    material: { expose: () => "PLAINTEXT-SECRET" } as { expose: () => string },
  };

  function store(over?: { http?: HttpFn; seal?: SealFn }): GithubActionsStore {
    return new GithubActionsStore({
      getInstallationToken: async () => "ghs_store_auth",
      http:
        over?.http ??
        (async (url, init) => {
          if (url.endsWith("/public-key")) return { status: 200, text: async () => JSON.stringify({ key: "PUBKEYB64", key_id: "kid-1" }) };
          if (init.method === "PUT") return { status: 201, text: async () => "" };
          return { status: 404, text: async () => "" };
        }),
      seal: over?.seal ?? (async () => "SEALED-CIPHERTEXT"),
    });
  }

  it("GETs the public key, seals the plaintext, and PUTs only ciphertext (never the value)", async () => {
    let putBody = "";
    let sealedPlaintext = "";
    await store({
      http: async (url, init) => {
        if (url.endsWith("/public-key")) return { status: 200, text: async () => JSON.stringify({ key: "PUBKEYB64", key_id: "kid-1" }) };
        putBody = init.body ?? "";
        return { status: 201, text: async () => "" };
      },
      seal: async (plaintext) => {
        sealedPlaintext = plaintext;
        return "SEALED-CIPHERTEXT";
      },
    }).place(target, secret as never);
    expect(sealedPlaintext).toBe("PLAINTEXT-SECRET"); // the real secret only reaches the sealer
    const body = JSON.parse(putBody);
    expect(body).toEqual({ encrypted_value: "SEALED-CIPHERTEXT", key_id: "kid-1" });
    expect(putBody).not.toContain("PLAINTEXT-SECRET"); // only ciphertext on the wire
  });

  it("throws on a public-key or PUT failure (status only)", async () => {
    await expect(
      store({ http: async () => ({ status: 404, text: async () => "nope" }) }).place(target, secret as never),
    ).rejects.toThrow(/public-key failed \(HTTP 404\)/);
    await expect(
      store({
        http: async (url, init) => {
          if (url.endsWith("/public-key")) return { status: 200, text: async () => JSON.stringify({ key: "k", key_id: "i" }) };
          return { status: 403, text: async () => (init.method === "PUT" ? "LEAK" : "") };
        },
      }).place(target, secret as never),
    ).rejects.toThrow(/put-secret failed \(HTTP 403\)/);
  });

  it("requires target.repo", async () => {
    await expect(store().place({ store: "github-actions", name: "X" }, secret as never)).rejects.toThrow(/requires target.repo/);
  });
});
