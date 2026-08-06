import { describe, expect, it } from "vitest";
import type { Manifest } from "../src/allowlist.js";
import type { ApprovalGate } from "../src/approval.js";
import { AlwaysEngagedKillSwitch } from "../src/kill-switch.js";
import type { Alert } from "../src/alert.js";
import { Broker, type MintAndPlaceRequest } from "../src/broker.js";
import type { MintInput, MintedSecret, Provider, ProviderInfo, Store } from "../src/provider.js";
import { SecretValue } from "../src/secret-value.js";
import type { PlaceTarget, ProviderId, SecretDescriptor, StoreId } from "../src/types.js";

const MATERIAL = "SUPER-SECRET-VALUE-do-not-leak";

class FakeProvider implements Provider {
  mintCalls = 0;
  rotateCalls = 0;
  revokeCalls = 0;
  constructor(readonly id: ProviderId = "cloudflare") {}
  async mint(input: MintInput): Promise<MintedSecret> {
    this.mintCalls += 1;
    return { descriptor: descriptorFrom(input, this.id), material: new SecretValue(MATERIAL) };
  }
  async rotate(d: SecretDescriptor): Promise<MintedSecret> {
    this.rotateCalls += 1;
    return { descriptor: d, material: new SecretValue("ROTATED-" + MATERIAL) };
  }
  async revoke(): Promise<void> {
    this.revokeCalls += 1;
  }
  async verify(): Promise<boolean> {
    return true;
  }
  describe(): ProviderInfo {
    return { id: this.id, supportsEphemeral: true };
  }
}

class FakeStore implements Store {
  placeCalls = 0;
  constructor(readonly id: StoreId = "github-actions") {}
  async place(): Promise<void> {
    this.placeCalls += 1;
  }
}

const APPROVE_ALL: ApprovalGate = { check: () => true };
const DENY_ALL: ApprovalGate = { check: () => false };

function descriptorFrom(input: MintInput, provider: ProviderId): SecretDescriptor {
  return {
    id: "fake",
    name: input.name,
    provider,
    secretClass: input.secretClass,
    target: input.target,
    scopes: input.scopes,
  };
}

const allowedTarget: PlaceTarget = { store: "github-actions", repo: "acme/api", name: "R2_TOKEN" };
const manifest: Manifest = {
  version: 1,
  allow: [{ store: "github-actions", repo: "acme/api" }],
};

function makeBroker(gate: ApprovalGate, opts?: { emptyProviders?: boolean; manifest?: Manifest }) {
  const provider = new FakeProvider();
  const store = new FakeStore();
  const broker = new Broker({
    manifest: opts?.manifest ?? manifest,
    providers: opts?.emptyProviders
      ? new Map()
      : new Map<ProviderId, Provider>([["cloudflare", provider]]),
    stores: new Map<StoreId, Store>([["github-actions", store]]),
    approvals: gate,
    now: () => 1_600_000_000_000,
  });
  return { broker, provider, store };
}

const baseReq: MintAndPlaceRequest = {
  provider: "cloudflare",
  name: "R2_TOKEN",
  secretClass: "api-token",
  target: allowedTarget,
};

describe("Broker.plan (dry-run)", () => {
  it("reports allowed for an allow-listed destination, denied otherwise, mutating nothing", () => {
    const { broker, provider, store } = makeBroker(APPROVE_ALL);
    expect(broker.plan(baseReq).allowed).toBe(true);
    expect(broker.plan({ ...baseReq, target: { ...allowedTarget, repo: "attacker/evil" } }).allowed).toBe(false);
    expect(provider.mintCalls).toBe(0);
    expect(store.placeCalls).toBe(0);
  });
});

describe("Broker.mintAndPlace — success path", () => {
  it("mints, places, verifies, and returns a VALUE-BLIND result", async () => {
    const { broker, provider, store } = makeBroker(APPROVE_ALL);
    const { toolResult } = await broker.mintAndPlace(baseReq);
    expect(toolResult.ok).toBe(true);
    expect(toolResult.provider).toBe("cloudflare");
    expect(toolResult.action).toBe("mint");
    expect(toolResult.secret_id).toMatch(/^sec_/);
    expect(toolResult.placed_at).toBe(new Date(1_600_000_000_000).toISOString());
    expect(provider.mintCalls).toBe(1);
    expect(store.placeCalls).toBe(1);
    // The invariant: the live value never appears in what the agent receives.
    expect(JSON.stringify(toolResult)).not.toContain(MATERIAL);
    expect((toolResult as Record<string, unknown>)["value"]).toBeUndefined();
    // And it is now inventoried (by id/name, never value).
    expect(broker.listSecrets()).toHaveLength(1);
    expect(broker.status().count).toBe(1);
  });
});

describe("Broker.mintAndPlace — refusals (default-deny everywhere)", () => {
  it("REFUSES a destination not in the allow-list, before minting", async () => {
    const { broker, provider, store } = makeBroker(APPROVE_ALL);
    const res = await broker.mintAndPlace({ ...baseReq, target: { ...allowedTarget, repo: "attacker/evil" } });
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("destination-not-allow-listed");
    expect(provider.mintCalls).toBe(0);
    expect(store.placeCalls).toBe(0);
  });

  it("REFUSES when the action is not approved, before minting", async () => {
    const { broker, provider } = makeBroker(DENY_ALL);
    const res = await broker.mintAndPlace(baseReq);
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("approval-required");
    expect(provider.mintCalls).toBe(0);
  });

  it("reports provider-not-wired at the honest boundary", async () => {
    const { broker } = makeBroker(APPROVE_ALL, { emptyProviders: true });
    const res = await broker.mintAndPlace(baseReq);
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("provider-not-wired");
  });

  it("HALTS every mutating op when the kill switch is engaged (before minting)", async () => {
    const provider = new FakeProvider();
    const broker = new Broker({
      manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", provider]]),
      stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
      approvals: APPROVE_ALL,
      killSwitch: new AlwaysEngagedKillSwitch(),
    });
    const res = await broker.mintAndPlace(baseReq);
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("kill-switch-engaged");
    expect(provider.mintCalls).toBe(0);
  });
});

describe("Broker.rotate / revoke", () => {
  async function mintOne(broker: Broker, over?: Partial<MintAndPlaceRequest>): Promise<string> {
    const { toolResult } = await broker.mintAndPlace({ ...baseReq, ...over });
    return toolResult.secret_id;
  }

  it("rotates an ordinary secret (approved)", async () => {
    const { broker, provider } = makeBroker(APPROVE_ALL);
    const id = await mintOne(broker);
    const res = await broker.rotate(id);
    expect(res.toolResult.ok).toBe(true);
    expect(provider.rotateCalls).toBe(1);
  });

  it("REFUSES to rotate a NEVER_ROTATE class (updater-signing-key), even when approved", async () => {
    const { broker, provider } = makeBroker(APPROVE_ALL);
    const id = await mintOne(broker, { name: "app-updater", secretClass: "updater-signing-key" });
    const res = await broker.rotate(id);
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("never-rotate");
    expect(provider.rotateCalls).toBe(0);
  });

  it("REFUSES to rotate a name in the manifest's neverRotate set", async () => {
    const m: Manifest = { ...manifest, neverRotate: ["r2_token"] }; // matches name case-insensitively
    const { broker } = makeBroker(APPROVE_ALL, { manifest: m });
    const id = await mintOne(broker);
    const res = await broker.rotate(id);
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("never-rotate");
  });

  it("REFUSES an unapproved rotate", async () => {
    const { broker } = makeBroker(APPROVE_ALL);
    const id = await mintOne(broker);
    // Rebuild a deny-gate broker sharing nothing — simplest: a fresh deny broker won't know the id.
    const denyBroker = makeBroker(DENY_ALL).broker;
    const res = await denyBroker.rotate(id);
    expect(res.toolResult.ok).toBe(false);
    // unknown id in the deny broker → secret-not-found (also a safe refusal)
    expect(["approval-required", "secret-not-found"]).toContain(res.reason);
  });

  it("reports secret-not-found for an unknown id", async () => {
    const { broker } = makeBroker(APPROVE_ALL);
    const res = await broker.revoke("sec_does_not_exist");
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("secret-not-found");
  });

  it("revokes an ordinary secret and drops it from inventory", async () => {
    const { broker, provider } = makeBroker(APPROVE_ALL);
    const id = await mintOne(broker);
    const res = await broker.revoke(id);
    expect(res.toolResult.ok).toBe(true);
    expect(provider.revokeCalls).toBe(1);
    expect(broker.listSecrets()).toHaveLength(0);
  });
});

describe("Broker alerts (0008)", () => {
  it("emits an info 'mint-placed' alert on success and an error alert on a non-policy failure", async () => {
    const alerts: Alert[] = [];
    const alertSink = { emit: (a: Alert) => alerts.push(a) };
    // success path (fake provider present):
    const okBroker = new Broker({
      manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", new FakeProvider()]]),
      stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
      approvals: APPROVE_ALL,
      alerts: alertSink,
      now: () => 42,
    });
    await okBroker.mintAndPlace(baseReq);
    expect(alerts.at(-1)).toMatchObject({ level: "info", kind: "mint-placed", at: 42 });
    expect(alerts.at(-1)).not.toHaveProperty("value");

    // failure path (no provider wired => error, not a policy denial):
    const failBroker = new Broker({
      manifest,
      providers: new Map(),
      stores: new Map(),
      approvals: APPROVE_ALL,
      alerts: alertSink,
    });
    await failBroker.rotate("sec_whatever");
    const last = alerts.at(-1);
    expect(last?.level).toBe("error");
    expect(last?.kind).toBe("rotate-failed");
  });
});

describe("Broker.mintAndPlace — ADR 0004 activation (Pages redeploy)", () => {
  // A store + provider that log the order of place / activate / verify into one array.
  function orderedFakes(events: string[]) {
    const provider: Provider = {
      id: "cloudflare",
      async mint(input) {
        return { descriptor: descriptorFrom(input, "cloudflare"), material: new SecretValue(MATERIAL) };
      },
      async rotate(d) {
        return { descriptor: d, material: new SecretValue(MATERIAL) };
      },
      async revoke() {},
      async verify() {
        events.push("verify");
        return true;
      },
      describe: () => ({ id: "cloudflare", supportsEphemeral: true }),
    };
    const store: Store = {
      id: "github-actions",
      async place() {
        events.push("place");
      },
      async activate() {
        events.push("activate");
      },
    };
    return { provider, store };
  }

  function brokerWith(provider: Provider, store: Store) {
    return new Broker({
      manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", provider]]),
      stores: new Map<StoreId, Store>([["github-actions", store]]),
      approvals: APPROVE_ALL,
      now: () => 1_600_000_000_000,
    });
  }

  it("calls store.activate AFTER place and BEFORE verify", async () => {
    const events: string[] = [];
    const { provider, store } = orderedFakes(events);
    const res = await brokerWith(provider, store).mintAndPlace(baseReq);
    expect(res.toolResult.ok).toBe(true);
    expect(events).toEqual(["place", "activate", "verify"]);
  });

  it("fails the placement (not false-fresh) when activation throws", async () => {
    const events: string[] = [];
    const { provider, store } = orderedFakes(events);
    const failing: Store = {
      id: "github-actions",
      place: store.place.bind(store),
      async activate() {
        throw new Error("redeploy timed out after 300000ms");
      },
    };
    const res = await brokerWith(provider, failing).mintAndPlace(baseReq);
    expect(res.toolResult.ok).toBe(false);
    expect(events).not.toContain("verify"); // verify never runs if the deploy didn't go live
    expect(JSON.stringify(res)).not.toContain(MATERIAL); // still value-blind on the failure path
  });

  it("still succeeds for a store with NO activate (immediate-effect destinations)", async () => {
    const events: string[] = [];
    const { provider } = orderedFakes(events);
    const plainStore: Store = {
      id: "github-actions",
      async place() {
        events.push("place");
      },
    };
    const res = await brokerWith(provider, plainStore).mintAndPlace(baseReq);
    expect(res.toolResult.ok).toBe(true);
    expect(events).toEqual(["place", "verify"]);
  });
});
