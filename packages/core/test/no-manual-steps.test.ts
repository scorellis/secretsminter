/**
 * The executable manual-steps ledger (docs/MANUAL-STEPS.md — the project rule that each eliminated step is backed by a test).
 *
 * Each `E#` test proves a manual token-handling step is ELIMINATED — the automation works, so a human
 * never has to do it. Each `B#`/`C#` test proves a step that is deliberately NOT automated (the
 * irreducible bootstrap root, or a human control) stays that way. A regression that reintroduces manual
 * toil, or that automates a control it shouldn't, fails here.
 */

import { describe, expect, it } from "vitest";
import type { Manifest } from "../src/allowlist.js";
import type { ApprovalGate } from "../src/approval.js";
import { Broker, type MintAndPlaceRequest } from "../src/broker.js";
import { AlwaysEngagedKillSwitch } from "../src/kill-switch.js";
import type { MintInput, MintedSecret, Provider, ProviderInfo, Store } from "../src/provider.js";
import { SecretValue } from "../src/secret-value.js";
import type { ProviderId, SecretDescriptor, StoreId } from "../src/types.js";

const MATERIAL = "SECRET-no-human-should-touch";

class FakeProvider implements Provider {
  mintCalls = 0;
  rotateCalls = 0;
  revokeCalls = 0;
  verifyCalls = 0;
  readonly id: ProviderId = "cloudflare";
  async mint(input: MintInput): Promise<MintedSecret> {
    this.mintCalls += 1;
    return { descriptor: d(input), material: new SecretValue(MATERIAL) };
  }
  async rotate(desc: SecretDescriptor): Promise<MintedSecret> {
    this.rotateCalls += 1;
    return { descriptor: desc, material: new SecretValue(MATERIAL + "-v2") };
  }
  async revoke(): Promise<void> {
    this.revokeCalls += 1;
  }
  async verify(): Promise<boolean> {
    this.verifyCalls += 1;
    return true;
  }
  describe(): ProviderInfo {
    return { id: this.id, supportsEphemeral: true };
  }
}
class FakeStore implements Store {
  placeCalls = 0;
  readonly id: StoreId = "github-actions";
  async place(): Promise<void> {
    this.placeCalls += 1;
  }
}
function d(input: MintInput): SecretDescriptor {
  return {
    id: "d",
    name: input.name,
    provider: "cloudflare",
    secretClass: input.secretClass,
    target: input.target,
    scopes: input.scopes,
  };
}

const manifest: Manifest = { version: 1, allow: [{ store: "github-actions", repo: "acme/api" }] };
const req: MintAndPlaceRequest = {
  provider: "cloudflare",
  name: "R2_TOKEN",
  secretClass: "api-token",
  target: { store: "github-actions", repo: "acme/api", name: "R2_TOKEN" },
};
const APPROVE: ApprovalGate = { check: () => true };
const DENY: ApprovalGate = { check: () => false };

function build(over?: { approvals?: ApprovalGate; kill?: boolean; deps?: string[]; now?: () => number }) {
  const provider = new FakeProvider();
  const store = new FakeStore();
  const broker = new Broker({
    manifest: over?.deps ? { ...manifest, brokerDependencies: over.deps } : manifest,
    providers: new Map<ProviderId, Provider>([["cloudflare", provider]]),
    stores: new Map<StoreId, Store>([["github-actions", store]]),
    approvals: over?.approvals ?? APPROVE,
    ...(over?.kill ? { killSwitch: new AlwaysEngagedKillSwitch() } : {}),
    now: over?.now ?? (() => 1000),
  });
  return { broker, provider, store };
}

describe("ELIMINATED manual steps (each proven automated)", () => {
  it("E1: minting a credential is automated and value-blind (no human creates or sees it)", async () => {
    const { broker, provider } = build();
    const res = await broker.mintAndPlace(req);
    expect(res.toolResult.ok).toBe(true);
    expect(provider.mintCalls).toBe(1); // the broker minted it
    expect(JSON.stringify(res)).not.toContain(MATERIAL); // no human/agent ever sees the value
  });

  it("E2: placing the secret where it's consumed is automated (no human copies it)", async () => {
    const { broker, store } = build();
    await broker.mintAndPlace(req);
    expect(store.placeCalls).toBe(1);
  });

  it("E3: the new credential is verified automatically before it counts (no manual check)", async () => {
    const { broker, provider } = build();
    await broker.mintAndPlace(req);
    expect(provider.verifyCalls).toBe(1);
  });

  it("E4: rotation on schedule is automated (no human remembers to rotate)", async () => {
    let clock = 0;
    const { broker, provider } = build({ now: () => clock });
    await broker.mintAndPlace({ ...req, rotateEveryMs: 100 });
    clock = 100;
    await broker.runScheduledRotations();
    expect(provider.rotateCalls).toBe(1);
  });

  it("E5: revoking a credential is automated (no human handles the old secret)", async () => {
    const { broker, provider } = build();
    const { toolResult } = await broker.mintAndPlace(req);
    await broker.revoke(toolResult.secret_id);
    expect(provider.revokeCalls).toBe(1);
    expect(broker.listSecrets()).toHaveLength(0);
  });

  it("E6: an ephemeral credential is re-minted automatically (no human re-issues it)", async () => {
    const { broker, provider } = build();
    const { toolResult } = await broker.mintAndPlace(req);
    const res = await broker.rotate(toolResult.secret_id);
    expect(res.toolResult.ok).toBe(true);
    expect(provider.rotateCalls).toBe(1); // fresh material minted with no human input
  });
});

describe("Steps that stay manual on purpose", () => {
  it("B2: the broker REFUSES to automate rotating its own root (secret zero stays out-of-band)", async () => {
    const { broker: b1 } = build();
    const { toolResult } = await b1.mintAndPlace(req);
    const id = toolResult.secret_id;
    const { broker: b2 } = build({ deps: [id] });
    await b2.mintAndPlace(req); // same inputs => same deterministic id, now declared a broker dependency
    const res = await b2.rotate(id);
    expect(res.toolResult.ok).toBe(false);
    expect(res.reason).toBe("broker-dependency");
  });

  it("C1: a sensitive action stays gated on a human approval", async () => {
    const { broker, provider } = build({ approvals: DENY });
    const res = await broker.mintAndPlace(req);
    expect(res.reason).toBe("approval-required");
    expect(provider.mintCalls).toBe(0); // nothing happens without the human's approval
  });

  it("C2: the operator kill switch halts automation", async () => {
    const { broker, provider } = build({ kill: true });
    const res = await broker.mintAndPlace(req);
    expect(res.reason).toBe("kill-switch-engaged");
    expect(provider.mintCalls).toBe(0);
  });
});
