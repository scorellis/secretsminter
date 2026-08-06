import { describe, expect, it } from "vitest";
import { assertMayRotate } from "../src/policy.js";
import { NeverRotateError } from "../src/never-rotate.js";
import { SelfLockoutError } from "../src/guard.js";
import type { SecretDescriptor } from "../src/types.js";

function descriptor(over: Partial<SecretDescriptor>): SecretDescriptor {
  return {
    id: "sec_ordinary",
    name: "some-token",
    provider: "cloudflare",
    secretClass: "api-token",
    target: { store: "github-actions", repo: "acme/api", name: "R2_TOKEN" },
    scopes: [],
    ...over,
  };
}

describe("assertMayRotate — the single rotation gate", () => {
  const noDeps: ReadonlySet<string> = new Set();

  it("allows an ordinary rotatable secret", () => {
    expect(() => assertMayRotate(descriptor({}), noDeps)).not.toThrow();
  });

  it("refuses a NEVER_ROTATE secret (by class)", () => {
    const d = descriptor({ secretClass: "updater-signing-key" });
    expect(() => assertMayRotate(d, noDeps)).toThrow(NeverRotateError);
  });

  it("refuses a credential the broker itself depends on (self-lockout)", () => {
    const d = descriptor({ id: "sec_broker_store_writer" });
    const deps = new Set(["sec_broker_store_writer"]);
    expect(() => assertMayRotate(d, deps)).toThrow(SelfLockoutError);
  });

  it("checks NEVER_ROTATE before self-lockout, but enforces both together", () => {
    // ordinary + not a dep => passes both; the point is a caller can't check only one.
    expect(() => assertMayRotate(descriptor({ id: "sec_x" }), new Set(["sec_y"]))).not.toThrow();
  });
});
