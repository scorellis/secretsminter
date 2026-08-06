import { describe, expect, it } from "vitest";
import { SecretValue } from "../src/secret-value.js";
import { REDACTED, scrub, scrubError, whitelistSerialize } from "../src/value-blind.js";

describe("whitelistSerialize", () => {
  it("projects only the whitelisted fields", () => {
    const out = whitelistSerialize({
      ok: true,
      provider: "cloudflare",
      action: "mint",
      secret_id: "sec_123",
      placed_at: "2026-07-29T00:00:00Z",
    });
    expect(out).toEqual({
      ok: true,
      provider: "cloudflare",
      action: "mint",
      secret_id: "sec_123",
      placed_at: "2026-07-29T00:00:00Z",
    });
  });

  it("DROPS a leaked secret value even if the provider response includes it", () => {
    const raw = {
      ok: true,
      provider: "cloudflare",
      action: "mint",
      secret_id: "sec_123",
      placed_at: null,
      // the dangerous fields — must never survive serialization:
      value: "super-secret-token-value",
      secretAccessKey: "deadbeefcafe",
      token: "ghs_livetoken",
    };
    const out = whitelistSerialize(raw) as Record<string, unknown>;
    expect(out["value"]).toBeUndefined();
    expect(out["secretAccessKey"]).toBeUndefined();
    expect(out["token"]).toBeUndefined();
    expect(Object.keys(out).sort()).toEqual(
      ["action", "ok", "placed_at", "provider", "secret_id"].sort(),
    );
  });

  it("nulls an unrecognized provider rather than passing it through", () => {
    const out = whitelistSerialize({ ok: false, provider: "attacker-cloud", action: "mint" });
    expect(out.provider).toBeNull();
    expect(out.ok).toBe(false);
  });

  it("whitelists the action enum too — an unknown action falls back to read-only 'status'", () => {
    expect(whitelistSerialize({ action: "mint" }).action).toBe("mint");
    expect(whitelistSerialize({ action: "exfiltrate_everything" }).action).toBe("status");
    expect(whitelistSerialize({ action: 42 }).action).toBe("status");
  });
});

describe("scrub", () => {
  it("masks live secret material that slipped into an error string", () => {
    const leaked = "wrangler failed: token=abc123XYZ789 exited 1";
    expect(scrub(leaked, ["abc123XYZ789"])).toBe(`wrangler failed: token=${REDACTED} exited 1`);
  });

  it("masks every occurrence, order-independent", () => {
    expect(scrub("k9秘密VALUE ... k9秘密VALUE", ["k9秘密VALUE"])).toBe(`${REDACTED} ... ${REDACTED}`);
  });

  it("ignores empty/short material so it never over-masks", () => {
    expect(scrub("the cat sat", ["", "a", "cat"])).toBe("the cat sat");
  });

  it("scrubError redacts a thrown Error's message", () => {
    const err = new Error("PUT /secrets failed with key sk_live_9f8e7d6c5b4a");
    expect(scrubError(err, ["sk_live_9f8e7d6c5b4a"])).toBe(`PUT /secrets failed with key ${REDACTED}`);
  });

  it("scrubError follows the cause chain (where a wrapped client error hides the token)", () => {
    const inner = new Error("raw response: token=abc123XYZ789");
    const outer = new Error("mint failed", { cause: inner });
    const out = scrubError(outer, ["abc123XYZ789"]);
    expect(out).toContain("mint failed");
    expect(out).toContain(REDACTED);
    expect(out).not.toContain("abc123XYZ789");
  });

  it("scrub accepts a SecretValue directly", () => {
    const secret = new SecretValue("live-material-xyz");
    expect(scrub("leaked live-material-xyz here", [secret])).toBe(`leaked ${REDACTED} here`);
  });
});
