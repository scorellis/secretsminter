import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  Broker,
  SecretValue,
  type ApprovalGate,
  type Manifest,
  type MintInput,
  type MintedSecret,
  type PlaceTarget,
  type Provider,
  type ProviderId,
  type ProviderInfo,
  type SecretDescriptor,
  type Store,
  type StoreId,
} from "@secretsminter/core";
import { beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const MATERIAL = "SUPER-SECRET-VALUE-do-not-leak";

class FakeProvider implements Provider {
  constructor(readonly id: ProviderId = "cloudflare") {}
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
      material: new SecretValue(MATERIAL),
    };
  }
  async rotate(d: SecretDescriptor): Promise<MintedSecret> {
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
  constructor(readonly id: StoreId = "github-actions") {}
  async place(): Promise<void> {}
}

const APPROVE_ALL: ApprovalGate = { check: () => true };
const DENY_ALL: ApprovalGate = { check: () => false };
const allowed: PlaceTarget = { store: "github-actions", repo: "acme/api", name: "R2_TOKEN" };

async function connectClient(broker: Broker): Promise<Client> {
  const server = createServer(broker);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

function parse(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const first = result.content[0];
  return JSON.parse(first?.text ?? "null");
}

describe("MCP server (in-memory transport)", () => {
  let client: Client;

  beforeAll(async () => {
    const broker = new Broker({
      manifest: { version: 1, allow: [{ store: "github-actions", repo: "acme/api" }] } satisfies Manifest,
      providers: new Map<ProviderId, Provider>([["cloudflare", new FakeProvider()]]),
      stores: new Map<StoreId, Store>([["github-actions", new FakeStore()]]),
      approvals: APPROVE_ALL,
      now: () => 1_600_000_000_000,
    });
    client = await connectClient(broker);
  });

  it("serves and lists all six narrow tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ["list_secrets", "mint_and_place", "plan", "revoke", "rotate", "status"].sort(),
    );
  });

  it("plan (read-only) reports allow-list decisions without mutating", async () => {
    const res = await client.callTool({
      name: "plan",
      arguments: { provider: "cloudflare", name: "R2_TOKEN", secretClass: "api-token", target: allowed },
    });
    expect((parse(res as never) as { allowed: boolean }).allowed).toBe(true);
  });

  it("mint_and_place succeeds through the full stack and returns NO value", async () => {
    const res = (await client.callTool({
      name: "mint_and_place",
      arguments: { provider: "cloudflare", name: "R2_TOKEN", secretClass: "api-token", target: allowed },
    })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    expect(res.isError).toBeFalsy();
    const body = parse(res) as { ok: boolean; secret_id: string };
    expect(body.ok).toBe(true);
    expect(body.secret_id).toMatch(/^sec_/);
    // The invariant, end to end through MCP: the value never appears in the wire response.
    expect(JSON.stringify(res)).not.toContain(MATERIAL);
  });

  it("then reports the secret in the inventory (by id, never value)", async () => {
    const res = await client.callTool({ name: "list_secrets", arguments: {} });
    const body = parse(res as never) as { secrets: unknown[] };
    expect(body.secrets.length).toBe(1);
    expect(JSON.stringify(res)).not.toContain(MATERIAL);
  });
});

describe("MCP server refuses through the stack (empty allow-list + deny-all)", () => {
  it("mint_and_place to an unconfigured broker is an error with a safe reason", async () => {
    const broker = new Broker({
      manifest: { version: 1, allow: [] },
      providers: new Map(),
      stores: new Map(),
      approvals: DENY_ALL,
    });
    const client = await connectClient(broker);
    const res = (await client.callTool({
      name: "mint_and_place",
      arguments: { provider: "cloudflare", name: "R2_TOKEN", secretClass: "api-token", target: allowed },
    })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const body = parse(res) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("destination-not-allow-listed");
  });
});
