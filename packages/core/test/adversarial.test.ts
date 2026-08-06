/**
 * Adversarial suite — actively try to defeat each invariant. Every test here is written to BREAK
 * something; a green run is the proof the property holds. Where a test constructs a "leak" it asserts
 * the material never escapes.
 */

import { describe, expect, it } from "vitest";
import { allowlistMatch, type Manifest } from "../src/allowlist.js";
import { actionHash } from "../src/approval.js";
import {
  HashChainedAuditSink,
  verifyAuditChain,
  type ChainedEntry,
} from "../src/audit.js";
import type { Alert } from "../src/alert.js";
import { Broker, type MintAndPlaceRequest } from "../src/broker.js";
import { AlwaysEngagedKillSwitch } from "../src/kill-switch.js";
import type { MintInput, MintedSecret, Provider, ProviderInfo, Store } from "../src/provider.js";
import { SecretValue } from "../src/secret-value.js";
import type { PlaceTarget, ProviderId, SecretDescriptor, StoreId } from "../src/types.js";
import { scrub, whitelistSerialize } from "../src/value-blind.js";

const MATERIAL = "SECRET-MATERIAL-XYZ-do-not-leak";

class FakeProvider implements Provider {
  rotateCalls = 0;
  constructor(
    readonly id: ProviderId = "cloudflare",
    private readonly failRotate = false,
  ) {}
  async mint(input: MintInput): Promise<MintedSecret> {
    return { descriptor: desc(input, this.id), material: new SecretValue(MATERIAL) };
  }
  async rotate(d: SecretDescriptor): Promise<MintedSecret> {
    this.rotateCalls += 1;
    // The cloud's error inlines the token — the classic leak channel. The broker must not surface it.
    if (this.failRotate) throw new Error(`cloud rejected: token=${MATERIAL} at ${d.id}`);
    return { descriptor: d, material: new SecretValue(MATERIAL) };
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
function desc(input: MintInput, provider: ProviderId): SecretDescriptor {
  return {
    id: "fake",
    name: input.name,
    provider,
    secretClass: input.secretClass,
    target: input.target,
    scopes: input.scopes,
  };
}

const manifest: Manifest = { version: 1, allow: [{ store: "github-actions", repo: "acme/api" }] };
const target: PlaceTarget = { store: "github-actions", repo: "acme/api", name: "R2_TOKEN" };
const req: MintAndPlaceRequest = { provider: "cloudflare", name: "R2_TOKEN", secretClass: "api-token", target };

function newBroker(over?: Partial<{ failRotate: boolean; alerts: Alert[]; deps: string[] }>) {
  const provider = new FakeProvider("cloudflare", over?.failRotate ?? false);
  const alerts = over?.alerts;
  return {
    provider,
    broker: new Broker({
      manifest: over?.deps ? { ...manifest, brokerDependencies: over.deps } : manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", provider]]),
      stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
      approvals: { check: () => true },
      ...(alerts ? { alerts: { emit: (a: Alert) => alerts.push(a) } } : {}),
      now: () => 1000,
    }),
  };
}

describe("attack: exfiltrate a value", () => {
  it("whitelistSerialize cannot be tricked into emitting material via odd keys or nesting", () => {
    const out = whitelistSerialize({
      ok: true,
      provider: "cloudflare",
      action: "mint",
      secret_id: "sec_1",
      value: MATERIAL,
      token: MATERIAL,
      secretAccessKey: MATERIAL,
      nested: { deep: MATERIAL },
      ["__proto__"]: { polluted: MATERIAL },
    } as Record<string, unknown>);
    expect(JSON.stringify(out)).not.toContain(MATERIAL);
    expect(Object.keys(out).sort()).toEqual(["action", "ok", "placed_at", "provider", "secret_id"]);
  });

  it("SecretValue reveals nothing via spread / entries / property descriptors", () => {
    const s = new SecretValue(MATERIAL);
    expect(JSON.stringify({ ...s })).not.toContain(MATERIAL);
    expect(Object.entries(s)).toEqual([]);
    expect(JSON.stringify(Object.getOwnPropertyDescriptors(s))).not.toContain(MATERIAL);
  });

  it("scrub treats material as a literal (no regex injection) and still masks it", () => {
    const evil = "a.*b+c(d)[e]"; // regex metacharacters
    expect(scrub(`log ${evil} end`, [evil])).toBe("log [REDACTED] end");
  });

  it("a provider error that INLINES the token never reaches the tool result or an alert", async () => {
    const alerts: Alert[] = [];
    const { broker } = newBroker({ failRotate: true, alerts });
    await broker.mintAndPlace(req); // mint ok
    const id = broker.listSecrets()[0]!.id;
    const res = await broker.rotate(id); // rotate throws with material in the message
    expect(res.toolResult.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain(MATERIAL);
    expect(JSON.stringify(alerts)).not.toContain(MATERIAL);
  });
});

describe("attack: bypass the destination allow-list", () => {
  const attempts: PlaceTarget[] = [
    { store: "github-actions", repo: "acme/api ", name: "X" }, // trailing space
    { store: "github-actions", repo: "ACME/API", name: "X" }, // case
    { store: "github-actions", repo: "acme/api2", name: "X" }, // suffix
    { store: "github-actions", repo: "acme/ap", name: "X" }, // prefix
    { store: "github-actions", repo: "acme/api\n", name: "X" }, // newline
    { store: "github-actions", repo: "attacker/evil", name: "X" }, // outright
    { store: "cloudflare-pages", project: "acme/api", name: "X" }, // wrong store
  ];
  it.each(attempts)("refuses %o (default-deny, fails closed)", (t) => {
    expect(allowlistMatch(t, manifest)).toBe(false);
  });
  it("still allows only the exact allow-listed destination", () => {
    expect(allowlistMatch(target, manifest)).toBe(true);
  });
});

describe("attack: defeat the kill switch", () => {
  it("engaged switch halts rotate AND revoke, not just mint", async () => {
    const provider = new FakeProvider();
    const broker = new Broker({
      manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", provider]]),
      stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
      approvals: { check: () => true },
      killSwitch: new AlwaysEngagedKillSwitch(),
    });
    expect((await broker.rotate("sec_x")).reason).toBe("kill-switch-engaged");
    expect((await broker.revoke("sec_x")).reason).toBe("kill-switch-engaged");
  });
});

describe("attack: replay or forge an approval", () => {
  it("different actions hash differently (an approval can't be replayed for another action)", () => {
    const base = { action: "mint" as const, provider: "cloudflare" as const, target };
    const hashes = new Set([
      actionHash(base),
      actionHash({ ...base, provider: "github" }),
      actionHash({ ...base, action: "rotate" }),
      actionHash({ ...base, target: { ...target, repo: "acme/other" } }),
      actionHash({ ...base, scopes: ["extra"] }),
    ]);
    expect(hashes.size).toBe(5); // all distinct
  });
});

describe("attack: tamper with the audit chain", () => {
  const build = (n: number): ChainedEntry[] => {
    const out: ChainedEntry[] = [];
    const sink = new HashChainedAuditSink((line) => out.push(JSON.parse(line) as ChainedEntry));
    for (let i = 0; i < n; i += 1) {
      sink.record({ action: "mint", provider: "cloudflare", secretId: `s${i}`, destination: "d", outcome: "ok", at: i });
    }
    return out;
  };
  it("detects reordered entries", () => {
    const c = build(3);
    const reordered = [c[0]!, c[2]!, c[1]!];
    expect(verifyAuditChain(reordered).ok).toBe(false);
  });
  it("detects a forged appended entry", () => {
    const c = build(2);
    const forged: ChainedEntry = { ...c[1]!, seq: 2, prevHash: c[1]!.hash, hash: "deadbeef", secretId: "rogue" };
    expect(verifyAuditChain([...c, forged]).ok).toBe(false);
  });
});

describe("robustness: a failing scheduled rotation", () => {
  it("does not throw, does not advance the schedule, and alerts an error", async () => {
    let clock = 0;
    const alerts: Alert[] = [];
    const provider = new FakeProvider("cloudflare", true);
    const broker = new Broker({
      manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", provider]]),
      stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
      approvals: { check: () => true },
      alerts: { emit: (a: Alert) => alerts.push(a) },
      now: () => clock,
    });
    await broker.mintAndPlace({ ...req, rotateEveryMs: 100 }); // nextAt = 0 + 100
    clock = 100; // now due
    const results = await broker.runScheduledRotations();
    expect(results).toHaveLength(1);
    expect(results[0]?.toolResult.ok).toBe(false);
    expect(provider.rotateCalls).toBe(1);
    // failed rotation left the secret DUE (schedule not advanced), so it retries next tick
    expect(broker.dueForRotation()).toHaveLength(1);
    expect(alerts.some((a) => a.level === "error" && a.kind === "rotate-failed")).toBe(true);
  });
});

describe("attack: rotate a broker dependency (self-lockout via manifest)", () => {
  it("refuses to rotate a credential the broker itself depends on", async () => {
    // learn the deterministic id, then rebuild with it declared as a broker dependency
    const { broker: b1 } = newBroker();
    await b1.mintAndPlace(req);
    const id = b1.listSecrets()[0]!.id;
    const { broker: b2 } = newBroker({ deps: [id] });
    await b2.mintAndPlace(req); // same inputs => same deterministic id
    const res = await b2.rotate(id);
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("broker-dependency");
  });
});
