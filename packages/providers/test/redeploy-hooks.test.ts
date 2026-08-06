import { describe, expect, it } from "vitest";
import type { HttpFn } from "../src/cloudflare-pages.js";
import {
  githubWorkflowDispatchHook,
  githubWorkflowDispatchHookFromEnv,
} from "../src/redeploy-hooks.js";

interface Captured {
  url?: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

/** An injected HTTP that returns a fixed status/body and records the single call it receives. */
function capHttp(status: number, body = "", captured?: Captured): HttpFn {
  return async (url, init) => {
    if (captured) {
      captured.url = url;
      captured.method = init.method;
      captured.body = init.body;
      captured.headers = init.headers;
    }
    return { status, text: async () => body };
  };
}

describe("githubWorkflowDispatchHook", () => {
  it("POSTs the workflow_dispatch endpoint with a {ref} body + Bearer auth, resolving on HTTP 204", async () => {
    const cap: Captured = {};
    const hook = githubWorkflowDispatchHook({
      owner: "acme",
      repo: "example-web",
      workflow: "deploy.yml",
      ref: "main",
      token: "GH_TOKEN_VALUE",
      http: capHttp(204, "", cap),
    });
    await expect(hook()).resolves.toBeUndefined();
    expect(cap.url).toBe(
      "https://api.github.com/repos/acme/example-web/actions/workflows/deploy.yml/dispatches",
    );
    expect(cap.method).toBe("POST");
    expect(cap.headers?.Authorization).toBe("Bearer GH_TOKEN_VALUE");
    expect(JSON.parse(cap.body ?? "{}")).toEqual({ ref: "main" });
  });

  it("throws status-only on a 4xx, never leaking the response body or the token", async () => {
    const hook = githubWorkflowDispatchHook({
      owner: "o",
      repo: "r",
      workflow: "w.yml",
      ref: "main",
      token: "SUPER_SECRET_GH_TOKEN",
      http: capHttp(404, "LEAK-response-body-with-hints"),
    });
    let err: unknown;
    await hook().catch((e: unknown) => {
      err = e;
    });
    expect(String(err)).toMatch(/HTTP 4\d\d/);
    expect(String(err)).not.toContain("LEAK");
    expect(String(err)).not.toContain("SUPER_SECRET_GH_TOKEN");
  });
});

describe("githubWorkflowDispatchHookFromEnv", () => {
  const configured = {
    SECRETSMINTER_PAGES_REDEPLOY: "github",
    SECRETSMINTER_PAGES_REDEPLOY_GH_OWNER: "acme",
    SECRETSMINTER_PAGES_REDEPLOY_GH_REPO: "example-web",
    SECRETSMINTER_PAGES_REDEPLOY_GH_WORKFLOW: "deploy.yml",
    SECRETSMINTER_PAGES_REDEPLOY_GH_TOKEN: "t",
  };

  it("returns undefined when not opted in", () => {
    expect(githubWorkflowDispatchHookFromEnv({})).toBeUndefined();
    expect(
      githubWorkflowDispatchHookFromEnv({ SECRETSMINTER_PAGES_REDEPLOY: "gitlab" }),
    ).toBeUndefined();
  });

  it("throws naming the required fields when opted in but a field is missing", () => {
    const { SECRETSMINTER_PAGES_REDEPLOY_GH_TOKEN: _omit, ...partial } = configured;
    expect(() => githubWorkflowDispatchHookFromEnv(partial)).toThrow(/_GH_TOKEN/);
  });

  it("returns a hook function when fully configured (ref defaults to 'main')", () => {
    const hook = githubWorkflowDispatchHookFromEnv(configured);
    expect(typeof hook).toBe("function");
  });
});
