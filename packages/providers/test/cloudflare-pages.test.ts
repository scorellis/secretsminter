import type { MintedSecret, PlaceTarget } from "@secretsminter/core";
import { describe, expect, it } from "vitest";
import { CloudflarePagesStore, type HttpFn, type RedeployHook } from "../src/cloudflare-pages.js";

const target: PlaceTarget = {
  store: "cloudflare-pages",
  project: "example-web",
  name: "MY_SECRET_1",
};

/** A minimal stand-in for a MintedSecret carrying only the material the store reads. */
function minted(value: string): MintedSecret {
  return { material: { expose: () => value } } as unknown as MintedSecret;
}

interface Captured {
  url?: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

function okHttp(captured?: Captured): HttpFn {
  return async (url, init) => {
    if (captured) {
      captured.url = url;
      captured.method = init.method;
      captured.body = init.body;
      captured.headers = init.headers;
    }
    return { status: 200, text: async () => JSON.stringify({ success: true }) };
  };
}

function store(over?: { http?: HttpFn }): CloudflarePagesStore {
  return new CloudflarePagesStore({
    accountId: "acct123",
    apiToken: "PAGES_TOKEN_VALUE",
    http: over?.http ?? okHttp(),
  });
}

describe("CloudflarePagesStore.place (secret_text env var)", () => {
  it("PATCHes the project with a secret_text env var at the fixed host", async () => {
    const cap: Captured = {};
    await store({ http: okHttp(cap) }).place(target, minted("super-secret-role-key"));
    expect(cap.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct123/pages/projects/example-web",
    );
    expect(cap.method).toBe("PATCH");
    expect(cap.headers?.["Authorization"]).toBe("Bearer PAGES_TOKEN_VALUE");
    expect(JSON.parse(cap.body ?? "{}")).toEqual({
      deployment_configs: {
        production: {
          env_vars: {
            MY_SECRET_1: { type: "secret_text", value: "super-secret-role-key" },
          },
        },
      },
    });
  });

  it("honors target.environment=preview", async () => {
    const cap: Captured = {};
    await store({ http: okHttp(cap) }).place(
      { ...target, environment: "preview" },
      minted("k"),
    );
    expect(Object.keys(JSON.parse(cap.body ?? "{}").deployment_configs)).toEqual(["preview"]);
  });

  it("rejects an unknown environment (no arbitrary config key)", async () => {
    await expect(
      store().place({ ...target, environment: "staging" }, minted("k")),
    ).rejects.toThrow(/environment/);
  });

  it("requires target.project", async () => {
    await expect(
      store().place({ store: "cloudflare-pages", name: "X" }, minted("k")),
    ).rejects.toThrow(/requires target.project/);
  });

  it("throws status-only on an HTTP error, never leaking the response body", async () => {
    const s = store({ http: async () => ({ status: 403, text: async () => "LEAK-super-secret-role-key" }) });
    await expect(s.place(target, minted("super-secret-role-key"))).rejects.toThrow(/HTTP 403/);
    await s.place(target, minted("super-secret-role-key")).catch((e: unknown) => {
      expect((e as Error).message).not.toContain("super-secret-role-key");
      expect((e as Error).message).not.toContain("LEAK");
    });
  });

  it("scrubs the secret value out of a thrown network error", async () => {
    const s = store({
      http: async () => {
        throw new Error("connect ECONNREFUSED body=super-secret-role-key");
      },
    });
    await s.place(target, minted("super-secret-role-key")).catch((e: unknown) => {
      expect((e as Error).message).not.toContain("super-secret-role-key");
    });
  });
});

describe("CloudflarePagesStore.placePlain (plain_text env var)", () => {
  it("PATCHes the project with a plain_text env var", async () => {
    const cap: Captured = {};
    await store({ http: okHttp(cap) }).placePlain(
      { ...target, name: "MY_PLAIN_VAR" },
      "https://example.com/config",
    );
    expect(JSON.parse(cap.body ?? "{}")).toEqual({
      deployment_configs: {
        production: {
          env_vars: { MY_PLAIN_VAR: { type: "plain_text", value: "https://example.com/config" } },
        },
      },
    });
  });

  it("requires target.project", async () => {
    await expect(
      store().placePlain({ store: "cloudflare-pages", name: "X" }, "v"),
    ).rejects.toThrow(/requires target.project/);
  });

  it("throws status-only on an HTTP error", async () => {
    await expect(
      store({ http: async () => ({ status: 500, text: async () => "err" }) }).placePlain(
        { ...target, name: "MY_PLAIN_VAR" },
        "v",
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("CloudflarePagesStore identity + fromEnv (bootstrap seam)", () => {
  it("has the cloudflare-pages store id", () => {
    expect(store().id).toBe("cloudflare-pages");
  });

  const full = {
    SECRETSMINTER_CF_ACCOUNT_ID: "a",
    SECRETSMINTER_CF_PAGES_TOKEN: "t",
  };

  it("builds when both vars are present", () => {
    expect(() => CloudflarePagesStore.fromEnv(full)).not.toThrow();
  });

  it("throws naming exactly what's missing", () => {
    const { SECRETSMINTER_CF_PAGES_TOKEN: _omit, ...partial } = full;
    expect(() => CloudflarePagesStore.fromEnv(partial)).toThrow(/apiToken/);
  });
});

describe("CloudflarePagesStore.activate (ADR 0004: trigger + await redeploy)", () => {
  const projectUrl =
    "https://api.cloudflare.com/client/v4/accounts/acct123/pages/projects/example-web";
  const deploymentsUrl = `${projectUrl}/deployments`;

  /** A "get deployment" response body carrying a single id + latest_stage (Git-connected poll path). */
  const dep = (stage: { name: string; status: string }) =>
    JSON.stringify({ success: true, result: { id: "dep-1", latest_stage: stage } });

  /** A "get project" response marking a Git-connected project (non-null `result.source`). */
  const gitProject = JSON.stringify({ success: true, result: { source: { type: "github", config: {} } } });
  /** A "get project" response marking a direct-upload project (no `result.source`). */
  const directProject = JSON.stringify({ success: true, result: { source: null } });

  /** A "list deployments" response body (`result` newest-first) for the direct-upload path. */
  const depList = (...items: Array<{ id: string; stage: { name: string; status: string } }>) =>
    JSON.stringify({
      success: true,
      result: items.map((d) => ({ id: d.id, environment: "production", latest_stage: d.stage })),
    });

  type Resp = { status: number; body: string };
  type Route = () => Resp;
  const once = (status: number, body: string): Route => () => ({ status, body });
  const seq = (...responses: Resp[]): Route => {
    let i = 0;
    return () => responses[Math.min(i++, responses.length - 1)]!;
  };

  /**
   * A method+URL-routing HTTP mock. activate() now interleaves a project-type GET, a POST trigger, and
   * poll GETs (of either a single deployment id or the deployments list), so routing by shape is far more
   * robust than a fixed response sequence. Every call is recorded in `calls`.
   */
  function routeHttp(
    routes: { project?: Route; post?: Route; pollId?: Route; list?: Route },
    calls: Captured[] = [],
  ): HttpFn {
    return async (url, init) => {
      calls.push({ url, method: init.method, body: init.body, headers: init.headers });
      const path = url.split("?")[0]!;
      const isList = path.endsWith("/deployments");
      const isId = /\/deployments\/[^/]+$/.test(path);
      let route: Route | undefined;
      if (init.method === "GET" && !isList && !isId) route = routes.project;
      else if (init.method === "POST" && isList) route = routes.post;
      else if (init.method === "GET" && isId) route = routes.pollId;
      else if (init.method === "GET" && isList) route = routes.list;
      if (!route) throw new Error(`test http: no route for ${init.method} ${path}`);
      const r = route();
      return { status: r.status, text: async () => r.body };
    };
  }

  function activatingStore(http: HttpFn, redeployHook?: RedeployHook): CloudflarePagesStore {
    return new CloudflarePagesStore({
      accountId: "acct123",
      apiToken: "PAGES_TOKEN_VALUE",
      http,
      redeployPollMs: 0,
      ...(redeployHook ? { redeployHook } : {}),
    });
  }

  describe("Git-connected project (CF rebuilds directly)", () => {
    it("GETs the project first, POSTs a new deployment, then polls until deploy:success", async () => {
      const calls: Captured[] = [];
      const http = routeHttp(
        {
          project: once(200, gitProject),
          post: once(200, dep({ name: "queued", status: "active" })), // trigger → id dep-1
          pollId: seq(
            { status: 200, body: dep({ name: "build", status: "active" }) }, // poll 1: not done
            { status: 200, body: dep({ name: "deploy", status: "success" }) }, // poll 2: live
          ),
        },
        calls,
      );
      await activatingStore(http).activate(target);
      // Project-type GET happens FIRST (no /deployments), gating the rebuild path.
      expect(calls[0]?.method).toBe("GET");
      expect(calls[0]?.url).toBe(projectUrl);
      // Then the POST trigger, with auth.
      expect(calls[1]?.method).toBe("POST");
      expect(calls[1]?.url).toBe(deploymentsUrl);
      expect(calls[1]?.headers?.Authorization).toBe("Bearer PAGES_TOKEN_VALUE");
      // Then polls of the returned deployment id.
      expect(calls[2]?.method).toBe("GET");
      expect(calls[2]?.url).toContain("/deployments/dep-1");
      expect(calls.length).toBe(4); // project GET + trigger + 2 polls
    });

    it("throws when the redeploy reaches a failed stage (no false-fresh)", async () => {
      const http = routeHttp({
        project: once(200, gitProject),
        post: once(200, dep({ name: "queued", status: "active" })),
        pollId: once(200, dep({ name: "deploy", status: "failure" })),
      });
      await expect(activatingStore(http).activate(target)).rejects.toThrow(/did not succeed/);
    });

    it("throws status-only when the trigger POST errors, never leaking a body", async () => {
      const http = routeHttp({
        project: once(200, gitProject),
        post: once(403, "LEAK-token-material"),
      });
      let err: unknown;
      await activatingStore(http)
        .activate(target)
        .catch((e: unknown) => {
          err = e;
        });
      expect(String(err)).toMatch(/HTTP 403/);
      expect(String(err)).not.toContain("LEAK");
    });

    it("times out instead of polling forever", async () => {
      let t = 0;
      const http = routeHttp({
        project: once(200, gitProject),
        post: once(200, dep({ name: "queued", status: "active" })),
        pollId: once(200, dep({ name: "build", status: "active" })), // never terminal
      });
      const s = new CloudflarePagesStore({
        accountId: "a",
        apiToken: "t",
        http,
        redeployPollMs: 0,
        redeployTimeoutMs: 10,
        now: () => (t += 6), // two ticks → 12 > 10 → timeout
      });
      await expect(s.activate(target)).rejects.toThrow(/timed out/);
    });

    it("requires target.project", async () => {
      await expect(
        activatingStore(okHttp()).activate({ store: "cloudflare-pages", name: "X" }),
      ).rejects.toThrow(/requires target.project/);
    });
  });

  describe("Direct-upload project (external redeploy via hook)", () => {
    it("fires the redeployHook, then polls the list until a NEW deployment reaches deploy:success", async () => {
      const calls: Captured[] = [];
      let hookCalls = 0;
      const hook: RedeployHook = async () => {
        hookCalls++;
      };
      const http = routeHttp(
        {
          project: once(200, directProject),
          list: seq(
            // Pre-trigger snapshot: the current production deployment.
            { status: 200, body: depList({ id: "old-1", stage: { name: "deploy", status: "success" } }) },
            // After the hook fires: a NEW deployment (different id) that has gone live.
            {
              status: 200,
              body: depList(
                { id: "new-2", stage: { name: "deploy", status: "success" } },
                { id: "old-1", stage: { name: "deploy", status: "success" } },
              ),
            },
          ),
        },
        calls,
      );
      await activatingStore(http, hook).activate(target);
      expect(hookCalls).toBe(1); // the operator's pipeline was triggered exactly once
      // Project-type GET first, then the snapshot list, then (after the hook) the poll list.
      expect(calls[0]?.method).toBe("GET");
      expect(calls[0]?.url).toBe(projectUrl);
      expect(calls[1]?.method).toBe("GET");
      expect(calls[1]?.url).toBe(deploymentsUrl);
      expect(calls.length).toBe(3); // project GET + snapshot list + one poll list
    });

    it("throws when the fresh deployment fails (a new id that did not succeed)", async () => {
      const hook: RedeployHook = async () => {};
      const http = routeHttp({
        project: once(200, directProject),
        list: seq(
          { status: 200, body: depList({ id: "old-1", stage: { name: "deploy", status: "success" } }) },
          { status: 200, body: depList({ id: "new-2", stage: { name: "deploy", status: "failure" } }) },
        ),
      });
      await expect(activatingStore(http, hook).activate(target)).rejects.toThrow(/did not succeed/);
    });

    it("throws a clear /direct-upload/ error when no redeployHook is configured", async () => {
      const http = routeHttp({ project: once(200, directProject) });
      await expect(activatingStore(http).activate(target)).rejects.toThrow(/direct-upload/);
    });
  });
});
