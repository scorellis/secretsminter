import { describe, expect, it } from "vitest";
import {
  assertRotatable,
  isRotatable,
  NEVER_ROTATE_CLASSES,
  NeverRotateError,
} from "../src/never-rotate.js";
import type { SecretDescriptor } from "../src/types.js";

function descriptor(over: Partial<SecretDescriptor>): SecretDescriptor {
  return {
    id: "sec_x",
    name: "some-token",
    provider: "cloudflare",
    secretClass: "api-token",
    target: { store: "github-actions", repo: "acme/api", name: "R2_TOKEN" },
    scopes: [],
    ...over,
  };
}

describe("NEVER_ROTATE", () => {
  it("allows an ordinary api-token to rotate", () => {
    expect(isRotatable(descriptor({}))).toBe(true);
    expect(() => assertRotatable(descriptor({}))).not.toThrow();
  });

  it("refuses by NAME, case-insensitively", () => {
    const d = descriptor({ name: "Updater-Signing-Key", secretClass: "api-token" });
    expect(isRotatable(d)).toBe(false);
    expect(() => assertRotatable(d)).toThrow(NeverRotateError);
  });

  it("refuses by CLASS even under a fresh, innocuous name", () => {
    // the name-only evasion the security review flagged:
    const d = descriptor({ name: "totally-innocent-key-2026", secretClass: "updater-signing-key" });
    expect(isRotatable(d)).toBe(false);
    expect(() => assertRotatable(d)).toThrow(/never-rotatable/);
  });

  it("still rotates a rotatable signing key (Supabase jwt-signing-key)", () => {
    const d = descriptor({ name: "supabase-jwt", secretClass: "jwt-signing-key" });
    expect(isRotatable(d)).toBe(true);
  });

  it("rotates a locally-minted app/HMAC secret (app-secret is NOT never-rotate)", () => {
    const d = descriptor({ name: "DOWNLOAD_SIGNING_SECRET", secretClass: "app-secret" });
    expect(NEVER_ROTATE_CLASSES.has("app-secret")).toBe(false);
    expect(isRotatable(d)).toBe(true);
    expect(() => assertRotatable(d)).not.toThrow();
  });
});
