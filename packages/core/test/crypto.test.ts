import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { auditFingerprint, r2SecretAccessKeyFromToken } from "../src/crypto.js";

describe("r2SecretAccessKeyFromToken", () => {
  it("is the SHA-256 hex of the token value (the R2 gotcha, encoded once)", () => {
    const token = "example-r2-api-token-value";
    const expected = createHash("sha256").update(token, "utf8").digest("hex");
    expect(r2SecretAccessKeyFromToken(token)).toBe(expected);
    expect(r2SecretAccessKeyFromToken(token)).toHaveLength(64);
  });

  it("is deterministic and differs per token", () => {
    expect(r2SecretAccessKeyFromToken("a")).toBe(r2SecretAccessKeyFromToken("a"));
    expect(r2SecretAccessKeyFromToken("a")).not.toBe(r2SecretAccessKeyFromToken("b"));
  });
});

describe("auditFingerprint", () => {
  it("is short, keyed, and reveals nothing reversible about the material", () => {
    const fp = auditFingerprint("live-secret-value", "audit-key");
    expect(fp).toHaveLength(12);
    expect(fp).not.toContain("live-secret");
  });

  it("correlates the same material under the same key, but not across keys", () => {
    expect(auditFingerprint("v", "k1")).toBe(auditFingerprint("v", "k1"));
    expect(auditFingerprint("v", "k1")).not.toBe(auditFingerprint("v", "k2"));
  });
});
