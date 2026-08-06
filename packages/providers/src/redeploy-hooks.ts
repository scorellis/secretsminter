/**
 * Redeploy hooks — how secretsminter triggers a **direct-upload** Cloudflare Pages project's own deploy
 * pipeline (CF cannot rebuild a project that has no Git connection; see cloudflare-pages.ts::activate).
 *
 * A {@link RedeployHook} only TRIGGERS the pipeline; the CloudflarePagesStore awaits the resulting fresh
 * deployment via the CF API. Today the one implementation is a GitHub Actions `workflow_dispatch` — the
 * common case for a Pages site deployed by `wrangler pages deploy` in CI.
 */

import { scrubError } from "@secretsminter/core";
import type { HttpFn, HttpResponse, RedeployHook } from "./cloudflare-pages.js";

const GITHUB_API = "https://api.github.com";

const defaultHttp: HttpFn = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, text: () => r.text() };
};

export interface GithubWorkflowDispatchConfig {
  /** Repo owner (user or org), e.g. "acme". */
  readonly owner: string;
  /** Repo name, e.g. "example-web". */
  readonly repo: string;
  /** The workflow file name (e.g. "deploy.yml") or its numeric id. Must have an `on: workflow_dispatch`. */
  readonly workflow: string;
  /** The branch/tag to run the workflow on, e.g. "main". */
  readonly ref: string;
  /** A GitHub token with `actions: write` on the repo. A bootstrap credential — never logged. */
  readonly token: string;
  readonly http?: HttpFn;
}

/**
 * Build a {@link RedeployHook} that fires a GitHub Actions `workflow_dispatch`. Returns once GitHub
 * accepts the trigger (HTTP 204); the store then awaits the fresh Pages deployment the workflow uploads.
 * The token is a Bearer credential — HTTP failures surface a status code only, never the response body.
 */
export function githubWorkflowDispatchHook(cfg: GithubWorkflowDispatchConfig): RedeployHook {
  const http = cfg.http ?? defaultHttp;
  const url =
    `${GITHUB_API}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}` +
    `/actions/workflows/${encodeURIComponent(cfg.workflow)}/dispatches`;
  return async () => {
    let res: HttpResponse;
    try {
      res = await http(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "secretsminter",
        },
        body: JSON.stringify({ ref: cfg.ref }),
      });
    } catch (err) {
      throw new Error(`github workflow_dispatch failed: ${scrubError(err, [])}`);
    }
    // 204 No Content on success; anything >= 400 is a real failure (bad token, missing workflow, etc.).
    if (res.status >= 400) throw new Error(`github workflow_dispatch failed (HTTP ${res.status})`);
  };
}

/**
 * Build a GitHub dispatch hook from env, or undefined if not configured. Read by the daemon to wire a
 * direct-upload Pages project's redeploy without code changes:
 *   SECRETSMINTER_PAGES_REDEPLOY=github        (opt-in switch)
 *   SECRETSMINTER_PAGES_REDEPLOY_GH_OWNER, _REPO, _WORKFLOW, _REF, _TOKEN
 */
export function githubWorkflowDispatchHookFromEnv(
  env: Record<string, string | undefined> = process.env,
): RedeployHook | undefined {
  if ((env["SECRETSMINTER_PAGES_REDEPLOY"] ?? "").toLowerCase() !== "github") return undefined;
  const owner = env["SECRETSMINTER_PAGES_REDEPLOY_GH_OWNER"];
  const repo = env["SECRETSMINTER_PAGES_REDEPLOY_GH_REPO"];
  const workflow = env["SECRETSMINTER_PAGES_REDEPLOY_GH_WORKFLOW"];
  const ref = env["SECRETSMINTER_PAGES_REDEPLOY_GH_REF"] ?? "main";
  const token = env["SECRETSMINTER_PAGES_REDEPLOY_GH_TOKEN"];
  if (!owner || !repo || !workflow || !token) {
    throw new Error(
      "SECRETSMINTER_PAGES_REDEPLOY=github requires _GH_OWNER, _GH_REPO, _GH_WORKFLOW, _GH_TOKEN " +
        "(and optionally _GH_REF, default 'main').",
    );
  }
  return githubWorkflowDispatchHook({ owner, repo, workflow, ref, token });
}
