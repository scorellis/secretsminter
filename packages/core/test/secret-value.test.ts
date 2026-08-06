import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { exposeMaterial, SecretValue } from "../src/secret-value.js";

describe("SecretValue self-redaction", () => {
  const raw = "sk_live_9f8e7d6c5b4a3210";
  const secret = new SecretValue(raw);

  it("redacts under JSON.stringify (accidental serialization)", () => {
    expect(JSON.stringify(secret)).toBe('"[REDACTED]"');
    expect(JSON.stringify({ token: secret })).toBe('{"token":"[REDACTED]"}');
  });

  it("redacts under String()/template interpolation", () => {
    expect(String(secret)).toBe("[REDACTED]");
    expect(`value=${secret}`).toBe("value=[REDACTED]");
  });

  it("redacts under util.inspect / console.log", () => {
    expect(inspect(secret)).toBe("SecretValue([REDACTED])");
    expect(inspect({ s: secret })).toContain("[REDACTED]");
    expect(inspect({ s: secret })).not.toContain("sk_live");
  });

  it("never exposes the value through enumeration", () => {
    expect(Object.keys(secret)).toEqual([]);
    expect(JSON.stringify(Object.assign({}, secret))).not.toContain("sk_live");
  });

  it("exposes the raw value ONLY through .expose()", () => {
    expect(secret.expose()).toBe(raw);
    expect(secret.length).toBe(raw.length);
  });

  it("exposeMaterial narrows string | SecretValue", () => {
    expect(exposeMaterial("plain")).toBe("plain");
    expect(exposeMaterial(secret)).toBe(raw);
  });
});
