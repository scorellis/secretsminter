import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  brokerDependencySet,
  effectiveNeverRotateNames,
  isKnownStore,
  ManifestError,
  parseManifest,
  signManifest,
  STORE_IDS,
  verifyAndLoadManifest,
} from "../src/manifest.js";

// A fresh Ed25519 keypair per run (Math.random/Date are unavailable; key generation is fine).
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function sign(json: string): string {
  return cryptoSign(null, Buffer.from(json, "utf8"), privateKey).toString("base64");
}

const goodManifest = JSON.stringify({
  version: 1,
  allow: [{ store: "github-actions", repo: "acme/api", namePattern: "R2_*" }],
  neverRotate: ["deploy-signing-key"],
  brokerDependencies: ["broker-store-writer"],
});

describe("verifyAndLoadManifest", () => {
  it("accepts a correctly-signed manifest", () => {
    const m = verifyAndLoadManifest(goodManifest, sign(goodManifest), publicKeyPem);
    expect(m.version).toBe(1);
    expect(m.allow).toHaveLength(1);
  });

  it("REFUSES a tampered manifest (signature over the original bytes no longer matches)", () => {
    const sig = sign(goodManifest);
    const tampered = goodManifest.replace("acme/api", "attacker/evil");
    expect(() => verifyAndLoadManifest(tampered, sig, publicKeyPem)).toThrow(ManifestError);
  });

  it("REFUSES an unsigned/empty signature", () => {
    expect(() => verifyAndLoadManifest(goodManifest, "", publicKeyPem)).toThrow(ManifestError);
  });

  it("REFUSES a signature from the wrong key", () => {
    const { privateKey: otherKey } = generateKeyPairSync("ed25519");
    const wrongSig = cryptoSign(null, Buffer.from(goodManifest), otherKey).toString("base64");
    expect(() => verifyAndLoadManifest(goodManifest, wrongSig, publicKeyPem)).toThrow(ManifestError);
  });
});

describe("parseManifest shape validation", () => {
  it("rejects a non-object / missing version / bad allow", () => {
    expect(() => parseManifest("[]")).toThrow(ManifestError);
    expect(() => parseManifest(JSON.stringify({ allow: [] }))).toThrow(/version/);
    expect(() => parseManifest(JSON.stringify({ version: 1 }))).toThrow(/allow/);
  });

  it("rejects an unknown store in an allow entry", () => {
    const bad = JSON.stringify({ version: 1, allow: [{ store: "s3-direct", repo: "x/y" }] });
    expect(() => parseManifest(bad)).toThrow(/store/);
  });

  it("rejects non-string[] neverRotate", () => {
    const bad = JSON.stringify({ version: 1, allow: [], neverRotate: [1, 2] });
    expect(() => parseManifest(bad)).toThrow(/neverRotate/);
  });

  it("rejects an allow entry that is not an object", () => {
    expect(() => parseManifest(JSON.stringify({ version: 1, allow: [123] }))).toThrow(/allow\[0\]/);
  });

  it("rejects an allow entry whose optional field is the wrong type", () => {
    const bad = JSON.stringify({ version: 1, allow: [{ store: "github-actions", repo: 5 }] });
    expect(() => parseManifest(bad)).toThrow(/repo/);
  });

  it("rejects non-string[] brokerDependencies", () => {
    const bad = JSON.stringify({ version: 1, allow: [], brokerDependencies: [{ x: 1 }] });
    expect(() => parseManifest(bad)).toThrow(/brokerDependencies/);
  });

  it("accepts a manifest with no optional fields", () => {
    const m = parseManifest(JSON.stringify({ version: 2, allow: [] }));
    expect(m.version).toBe(2);
    expect(m.neverRotate).toBeUndefined();
  });
});

describe("signManifest", () => {
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("produces a signature that verifyAndLoadManifest accepts (round-trip)", () => {
    const sig = signManifest(goodManifest, privateKeyPem);
    const m = verifyAndLoadManifest(goodManifest, sig, publicKeyPem);
    expect(m.allow).toHaveLength(1);
  });

  it("matches node:crypto sign over the exact bytes", () => {
    expect(signManifest(goodManifest, privateKeyPem)).toBe(sign(goodManifest));
  });

  it("a signature over one manifest does NOT verify a different manifest", () => {
    const sig = signManifest(goodManifest, privateKeyPem);
    const other = JSON.stringify({ version: 1, allow: [] });
    expect(() => verifyAndLoadManifest(other, sig, publicKeyPem)).toThrow(ManifestError);
  });
});

describe("isKnownStore / STORE_IDS", () => {
  it("accepts every known store id", () => {
    for (const s of STORE_IDS) expect(isKnownStore(s)).toBe(true);
  });

  it("rejects an unknown store id", () => {
    expect(isKnownStore("s3-direct")).toBe(false);
    expect(isKnownStore("")).toBe(false);
  });

  it("lists exactly the three supported stores", () => {
    expect([...STORE_IDS].sort()).toEqual(["cloudflare-pages", "file", "github-actions"]);
  });
});

describe("effective sets", () => {
  it("unions manifest neverRotate with the committed constant (case-insensitive)", () => {
    const m = parseManifest(goodManifest);
    const set = effectiveNeverRotateNames(m);
    expect(set.has("deploy-signing-key")).toBe(true); // from manifest
    expect(set.has("updater-signing-key")).toBe(true); // from the committed constant
  });

  it("exposes the broker-dependency set", () => {
    const m = parseManifest(goodManifest);
    expect(brokerDependencySet(m).has("broker-store-writer")).toBe(true);
  });
});
