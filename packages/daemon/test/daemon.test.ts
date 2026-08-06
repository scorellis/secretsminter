import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBroker, type DaemonIo } from "../src/build.js";
import { configFromEnv, type DaemonConfig } from "../src/config.js";
import { startRotationLoop } from "../src/loop.js";

function io(files: Record<string, string> = {}, env: Record<string, string | undefined> = {}): DaemonIo {
  return { readText: (p) => (p in files ? (files[p] as string) : null), env };
}

const EMPTY: DaemonConfig = { rotationIntervalMs: 60_000 };

describe("configFromEnv", () => {
  it("defaults sensibly and reads the env", () => {
    expect(configFromEnv({}).rotationIntervalMs).toBe(60_000);
    const c = configFromEnv({ SECRETSMINTER_STATE: "/s.json", SECRETSMINTER_ROTATION_INTERVAL_MS: "5000" });
    expect(c.statePath).toBe("/s.json");
    expect(c.rotationIntervalMs).toBe(5000);
  });

  it("ignores a non-positive interval", () => {
    expect(configFromEnv({ SECRETSMINTER_ROTATION_INTERVAL_MS: "-1" }).rotationIntervalMs).toBe(60_000);
  });
});

describe("buildBroker", () => {
  it("builds a safe broker with no config (empty allow-list, only the always-available local provider)", () => {
    const { broker, providers, manifestLoaded } = buildBroker(EMPTY, io());
    // The local random-secret provider needs no bootstrap, so it is present even with no env (0020).
    expect(providers).toEqual(["local"]);
    expect(manifestLoaded).toBe(false);
    expect(broker.listSecrets()).toEqual([]);
  });

  it("always wires the local random-secret provider — it needs no bootstrap credential (0020)", () => {
    const { providers } = buildBroker(EMPTY, io({}, {}));
    expect(providers).toContain("local");
  });

  it("loads + verifies a signed manifest", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    const json = JSON.stringify({ version: 1, allow: [{ store: "github-actions", repo: "acme/api" }] });
    const sig = cryptoSign(null, Buffer.from(json), privateKey).toString("base64");
    const config: DaemonConfig = {
      manifestPath: "/m.json",
      manifestSigPath: "/m.sig",
      manifestPublicKeyPath: "/m.pub",
      rotationIntervalMs: 60_000,
    };
    const { manifestLoaded } = buildBroker(config, io({ "/m.json": json, "/m.sig": sig, "/m.pub": pub }));
    expect(manifestLoaded).toBe(true);
  });

  it("skips a tampered manifest by throwing (fail fast)", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    const json = JSON.stringify({ version: 1, allow: [] });
    const sig = cryptoSign(null, Buffer.from(json), privateKey).toString("base64");
    const config: DaemonConfig = {
      manifestPath: "/m.json",
      manifestSigPath: "/m.sig",
      manifestPublicKeyPath: "/m.pub",
      rotationIntervalMs: 60_000,
    };
    expect(() =>
      buildBroker(config, io({ "/m.json": json.replace("[]", '[{"store":"x"}]'), "/m.sig": sig, "/m.pub": pub })),
    ).toThrow();
  });

  it("constructs file-backed controls when their paths are set (no disk write on build)", () => {
    const config: DaemonConfig = {
      statePath: "/nonexistent-secretsminter-test/state.json",
      killSwitchPath: "/nonexistent-secretsminter-test/kill",
      approvalsPath: "/nonexistent-secretsminter-test/approvals.json",
      alertLogPath: "/nonexistent-secretsminter-test/secretsminter.log",
      auditLogPath: "/nonexistent-secretsminter-test/audit.log",
      rotationIntervalMs: 60_000,
    };
    // A missing state file => start fresh (no throw, empty registry).
    const { broker } = buildBroker(config, io());
    expect(broker.listSecrets()).toEqual([]);
  });

  it("wires a provider when its bootstrap env is present", () => {
    const env = {
      SECRETSMINTER_CF_ACCOUNT_ID: "a",
      SECRETSMINTER_CF_BUCKET: "b",
      SECRETSMINTER_CF_PARENT_ACCESS_KEY_ID: "c",
      SECRETSMINTER_CF_API_TOKEN: "d",
    };
    const { providers } = buildBroker(EMPTY, io({}, env));
    expect(providers).toContain("cloudflare");
  });

  it("wires the cloudflare-pages store when its bootstrap env is present (review 2026-08-05 #1)", () => {
    const env = {
      SECRETSMINTER_CF_ACCOUNT_ID: "a",
      SECRETSMINTER_CF_PAGES_TOKEN: "t",
    };
    const { stores } = buildBroker(EMPTY, io({}, env));
    expect(stores).toContain("cloudflare-pages");
  });
});

describe("startRotationLoop", () => {
  afterEach(() => vi.useRealTimers());

  it("ticks the broker's scheduled rotations on the interval", async () => {
    vi.useFakeTimers();
    const { broker } = buildBroker(EMPTY, io());
    const spy = vi.spyOn(broker, "runScheduledRotations");
    const scheduler = startRotationLoop(broker, 100);
    await vi.advanceTimersByTimeAsync(250);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    scheduler.stop();
  });
});
