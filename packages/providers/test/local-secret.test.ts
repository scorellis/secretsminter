import type { MintInput, SecretDescriptor } from "@secretsminter/core";
import { describe, expect, it } from "vitest";
import { LocalSecretProvider, type RandomBytesFn } from "../src/local-secret.js";

const input: MintInput = {
  name: "DOWNLOAD_SIGNING_SECRET",
  secretClass: "app-secret",
  target: { store: "file", name: "DOWNLOAD_SIGNING_SECRET" },
  scopes: [],
};

const desc: SecretDescriptor = {
  id: "local:DOWNLOAD_SIGNING_SECRET",
  name: "DOWNLOAD_SIGNING_SECRET",
  provider: "local",
  secretClass: "app-secret",
  target: input.target,
  scopes: [],
};

/** A deterministic RNG seam: returns a fixed, caller-supplied byte pattern so a test can assert the
 *  exact encoded material without depending on real randomness. */
function fixedRng(fill: number): RandomBytesFn {
  return (size: number) => Buffer.alloc(size, fill);
}

describe("LocalSecretProvider.mint", () => {
  it("mints hex material of the default length (32 bytes -> 64 hex chars) wrapped in a SecretValue", async () => {
    const minted = await new LocalSecretProvider().mint(input);
    expect(minted.material.length).toBe(64);
    expect(minted.material.expose()).toMatch(/^[0-9a-f]{64}$/);
    expect(minted.descriptor).toMatchObject({
      id: "local:DOWNLOAD_SIGNING_SECRET",
      name: "DOWNLOAD_SIGNING_SECRET",
      provider: "local",
      secretClass: "app-secret",
    });
  });

  it("honors a configured byte length and encoding", async () => {
    const hex = await new LocalSecretProvider({ bytes: 16 }).mint(input);
    expect(hex.material.length).toBe(32); // 16 bytes -> 32 hex chars

    const b64 = await new LocalSecretProvider({ bytes: 48, encoding: "base64" }).mint(input);
    // 48 bytes base64 = 64 chars
    expect(b64.material.expose()).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(b64.material.expose(), "base64").length).toBe(48);

    const b64url = await new LocalSecretProvider({ bytes: 32, encoding: "base64url" }).mint(input);
    expect(b64url.material.expose()).not.toMatch(/[+/=]/); // base64url has no +,/,=
  });

  it("two mints produce different material (real randomness)", async () => {
    const p = new LocalSecretProvider();
    const a = await p.mint(input);
    const b = await p.mint(input);
    expect(a.material.expose()).not.toBe(b.material.expose());
  });

  it("uses the injected RNG (so tests are deterministic)", async () => {
    const minted = await new LocalSecretProvider({ bytes: 16, randomBytes: fixedRng(0xab) }).mint(input);
    expect(minted.material.expose()).toBe("ab".repeat(16));
  });

  it("never leaks the raw value under serialization (value-blind invariant)", async () => {
    const minted = await new LocalSecretProvider({ bytes: 16, randomBytes: fixedRng(0xcd) }).mint(input);
    const raw = minted.material.expose();
    expect(raw).toBe("cd".repeat(16));
    // The raw value must not appear in ANY serialized projection of the minted secret.
    expect(JSON.stringify(minted)).not.toContain(raw);
    expect(JSON.stringify(minted.descriptor)).not.toContain(raw);
    expect(String(minted.material)).toBe("[REDACTED]");
    expect(`${minted.material}`).not.toContain(raw);
  });

  it("rejects an out-of-range byte length at construction (defence in depth)", () => {
    expect(() => new LocalSecretProvider({ bytes: 4 })).toThrow(/bytes/);
    expect(() => new LocalSecretProvider({ bytes: 4096 })).toThrow(/bytes/);
  });
});

describe("LocalSecretProvider rotate / revoke / verify / describe", () => {
  it("rotate mints fresh material (different from a prior mint) for the same descriptor", async () => {
    const p = new LocalSecretProvider();
    const first = await p.mint(input);
    const rotated = await p.rotate(desc);
    expect(rotated.descriptor.id).toBe("local:DOWNLOAD_SIGNING_SECRET");
    expect(rotated.material.expose()).not.toBe(first.material.expose());
  });

  it("revoke is a no-op (a local secret has nothing to revoke at a vendor)", async () => {
    await expect(new LocalSecretProvider().revoke(desc)).resolves.toBeUndefined();
  });

  it("verify returns true for freshly-minted material (present == healthy; no vendor to probe)", async () => {
    const p = new LocalSecretProvider();
    const minted = await p.mint(input);
    expect(await p.verify(desc, minted)).toBe(true);
  });

  it("describe: non-ephemeral, local, id 'local'", () => {
    const info = new LocalSecretProvider().describe();
    expect(info.id).toBe("local");
    expect(info.supportsEphemeral).toBe(false);
    expect(info.notes).toMatch(/local/i);
  });
});

describe("LocalSecretProvider.fromEnv (always-available; needs no bootstrap)", () => {
  it("never throws for missing env — it needs no bootstrap credential", () => {
    expect(() => LocalSecretProvider.fromEnv({})).not.toThrow();
  });

  it("reads optional config from env", async () => {
    const p = LocalSecretProvider.fromEnv({
      SECRETSMINTER_LOCAL_SECRET_BYTES: "16",
      SECRETSMINTER_LOCAL_SECRET_ENCODING: "base64url",
    });
    const minted = await p.mint(input);
    expect(Buffer.from(minted.material.expose(), "base64url").length).toBe(16);
  });

  it("ignores an invalid env value rather than throwing (stays available)", async () => {
    const p = LocalSecretProvider.fromEnv({ SECRETSMINTER_LOCAL_SECRET_BYTES: "not-a-number" });
    const minted = await p.mint(input);
    expect(minted.material.length).toBe(64); // fell back to the 32-byte hex default
  });
});
