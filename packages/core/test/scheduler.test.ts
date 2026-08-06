import { afterEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../src/allowlist.js";
import { Broker, type MintAndPlaceRequest } from "../src/broker.js";
import type { MintInput, MintedSecret, Provider, ProviderInfo, Store } from "../src/provider.js";
import { InProcessScheduler } from "../src/scheduler.js";
import { SecretValue } from "../src/secret-value.js";
import type { ProviderId, SecretDescriptor, StoreId } from "../src/types.js";

class FakeProvider implements Provider {
  rotateCalls = 0;
  readonly id: ProviderId = "cloudflare";
  async mint(input: MintInput): Promise<MintedSecret> {
    return {
      descriptor: {
        id: "fake",
        name: input.name,
        provider: this.id,
        secretClass: input.secretClass,
        target: input.target,
        scopes: input.scopes,
      },
      material: new SecretValue("v"),
    };
  }
  async rotate(d: SecretDescriptor): Promise<MintedSecret> {
    this.rotateCalls += 1;
    return { descriptor: d, material: new SecretValue("v2") };
  }
  async revoke(): Promise<void> {}
  async verify(): Promise<boolean> {
    return true;
  }
  describe(): ProviderInfo {
    return { id: this.id, supportsEphemeral: true };
  }
}

class FakeStore implements Store {
  readonly id: StoreId = "github-actions";
  async place(): Promise<void> {}
}

const manifest: Manifest = { version: 1, allow: [{ store: "github-actions", repo: "acme/api" }] };
const req: MintAndPlaceRequest = {
  provider: "cloudflare",
  name: "R2_TOKEN",
  secretClass: "api-token",
  target: { store: "github-actions", repo: "acme/api", name: "R2_TOKEN" },
};

describe("self-maintaining rotation schedule", () => {
  it("becomes due on cadence, rotates through the gate, then reschedules", async () => {
    let clock = 0;
    const provider = new FakeProvider();
    const broker = new Broker({
      manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", provider]]),
      stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
      approvals: { check: () => true },
      now: () => clock,
    });

    await broker.mintAndPlace({ ...req, rotateEveryMs: 1000 });

    clock = 500;
    expect(broker.dueForRotation()).toEqual([]);

    clock = 1000;
    expect(broker.dueForRotation()).toHaveLength(1);
    const results = await broker.runScheduledRotations();
    expect(results[0]?.toolResult.ok).toBe(true);
    expect(provider.rotateCalls).toBe(1);

    // rescheduled to now (1000) + cadence (1000) = 2000
    clock = 1500;
    expect(broker.dueForRotation()).toEqual([]);
    clock = 2000;
    expect(broker.dueForRotation()).toHaveLength(1);
  });

  it("does not schedule a secret minted without a cadence", async () => {
    let clock = 0;
    const broker = new Broker({
      manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", new FakeProvider()]]),
      stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
      approvals: { check: () => true },
      now: () => clock,
    });
    await broker.mintAndPlace(req); // no rotateEveryMs
    clock = 1_000_000;
    expect(broker.dueForRotation()).toEqual([]);
  });
});

describe("InProcessScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the tick on the interval and stops cleanly", async () => {
    vi.useFakeTimers();
    let ticks = 0;
    const sched = new InProcessScheduler(() => {
      ticks += 1;
    }, 1000);
    sched.start();
    await vi.advanceTimersByTimeAsync(3000);
    expect(ticks).toBe(3);
    sched.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(ticks).toBe(3); // no ticks after stop
  });

  it("keepAlive=true still ticks on the interval", async () => {
    vi.useFakeTimers();
    let ticks = 0;
    const sched = new InProcessScheduler(() => {
      ticks += 1;
    }, 100, true);
    sched.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(ticks).toBeGreaterThanOrEqual(2);
    sched.stop();
  });

  it("suppresses overlapping ticks (a slow tick is not run concurrently)", async () => {
    vi.useFakeTimers();
    let started = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const sched = new InProcessScheduler(async () => {
      started += 1;
      await gate; // stays "running" until released
    }, 100);
    sched.start();
    await vi.advanceTimersByTimeAsync(350); // 3 fires, but the first is still running
    expect(started).toBe(1);
    release();
    sched.stop();
  });
});
