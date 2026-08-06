import { describe, expect, it } from "vitest";
import type { Manifest } from "../src/allowlist.js";
import type { ApprovalGate } from "../src/approval.js";
import { Broker, type MintAndPlaceRequest } from "../src/broker.js";
import type { MintInput, MintedSecret, Provider, ProviderInfo, Store } from "../src/provider.js";
import { SecretValue } from "../src/secret-value.js";
import { FileStateStore, InMemoryStateStore, type StateFs } from "../src/state-store.js";
import type { ProviderId, SecretDescriptor, StoreId } from "../src/types.js";

class FakeProvider implements Provider {
  readonly id: ProviderId = "cloudflare";
  async mint(input: MintInput): Promise<MintedSecret> {
    return {
      descriptor: {
        id: "d",
        name: input.name,
        provider: this.id,
        secretClass: input.secretClass,
        target: input.target,
        scopes: input.scopes,
      },
      material: new SecretValue("SECRET"),
    };
  }
  async rotate(d: SecretDescriptor): Promise<MintedSecret> {
    return { descriptor: d, material: new SecretValue("SECRET2") };
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

/** An in-memory fake filesystem for the file-backed store. */
function fakeFs(): { fs: StateFs; files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    fs: {
      read: (p) => (files.has(p) ? (files.get(p) as string) : null),
      write: (p, c) => void files.set(p, c),
    },
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

function makeBroker(stateStore: FileStateStore | InMemoryStateStore, now: () => number) {
  return new Broker({
    manifest,
    providers: new Map<ProviderId, Provider>([["cloudflare", new FakeProvider()]]),
    stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
    approvals: APPROVE,
    stateStore,
    now,
  });
}

describe("FileStateStore", () => {
  it("round-trips a value-free state", () => {
    const { fs } = fakeFs();
    const store = new FileStateStore("/state.json", fs);
    expect(store.load()).toBeNull();
    store.save({ secrets: [], schedule: [{ id: "x", cadenceMs: 10, nextAt: 20 }] });
    expect(store.load()?.schedule[0]).toEqual({ id: "x", cadenceMs: 10, nextAt: 20 });
  });

  it("returns null (start fresh) on a missing / unparseable / malformed file", () => {
    const bad = fakeFs();
    bad.files.set("/s.json", "not json");
    expect(new FileStateStore("/s.json", bad.fs).load()).toBeNull();
    bad.files.set("/s.json", JSON.stringify({ secrets: "nope" }));
    expect(new FileStateStore("/s.json", bad.fs).load()).toBeNull();
  });

  it("persisted state never contains secret material", () => {
    const { fs, files } = fakeFs();
    const broker = makeBroker(new FileStateStore("/state.json", fs), () => 1000);
    return broker.mintAndPlace({ ...req, rotateEveryMs: 500 }).then(() => {
      const written = [...files.values()].join("\n");
      expect(written).not.toContain("SECRET");
      expect(written).toContain("R2_TOKEN"); // the name is not secret
    });
  });
});

describe("broker survives a restart via durable state", () => {
  it("a fresh broker on the same store restores managed secrets + schedule", async () => {
    const shared = new FileStateStore("/state.json", fakeFs().fs);
    let clock = 0;

    // Broker #1 mints a scheduled secret, then "crashes" (we drop the instance).
    const b1 = makeBroker(shared, () => clock);
    const { toolResult } = await b1.mintAndPlace({ ...req, rotateEveryMs: 1000 });
    const id = toolResult.secret_id;
    expect(b1.listSecrets()).toHaveLength(1);

    // Broker #2 — a fresh instance, same store (a restart).
    const b2 = makeBroker(shared, () => clock);
    expect(b2.listSecrets().map((s) => s.id)).toEqual([id]); // registry restored
    clock = 1000;
    expect(b2.dueForRotation()).toEqual([id]); // schedule restored — the loop keeps going
  });

  it("InMemoryStateStore does NOT survive across instances (the non-durable default)", async () => {
    let clock = 0;
    const s1 = new InMemoryStateStore();
    const b1 = makeBroker(s1, () => clock);
    await b1.mintAndPlace(req);
    const b2 = makeBroker(new InMemoryStateStore(), () => clock); // different store => fresh
    expect(b2.listSecrets()).toHaveLength(0);
  });
});
