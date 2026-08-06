/**
 * Cloudflare Pages env-var store (story 0013).
 *
 * A {@link Store} that PLACES an environment variable into a Cloudflare Pages project — the analog of
 * {@link GithubActionsStore}, but for Pages instead of Actions. It is how secretsminter sets a Pages
 * project's deployment vars (e.g. a project URL as plain_text plus one or more API keys as secret_text)
 * hands-free.
 *
 * Confirmed API (developers.cloudflare.com — "Update project"):
 *   - `PATCH https://api.cloudflare.com/client/v4/accounts/{account_id}/pages/projects/{project_name}`
 *   - Auth: `Authorization: Bearer <token>` — a Pages API token scoped Account → Cloudflare Pages → Edit.
 *   - Body (partial update): `{ deployment_configs: { production: { env_vars: {
 *       <NAME>: { type: "plain_text" | "secret_text", value: <string> } } } } }`.
 *     `secret_text` is stored encrypted at rest and write-only; `plain_text` is a normal var (e.g. a URL).
 *
 * CAVEAT (documented, not a bug): a Pages env-var change takes effect on the NEXT deployment. It does
 * not mutate an already-running deployment. The story spells this out.
 *
 * Value-blindness: a secret value lives only in a {@link SecretValue}; it is written into the PATCH body
 * (that is its destination) but NEVER into a log line or a thrown error. On an HTTP failure the error
 * carries a status code only — never the response body. Any thrown network error is passed through
 * {@link scrubError} so a value that a client inlined into a message cannot escape. Fixed outbound host
 * (no SSRF), injectable {@link HttpFn} seam so every branch is unit-tested without network or a real key.
 *
 * Placement targets are trusted ONLY after the core has matched them against the signed allow-list
 * (assertAllowed) — the store, like GithubActionsStore, assumes that check already passed (provider.ts).
 */

import { scrubError, SecretValue, type MintedSecret, type PlaceTarget, type Store } from "@secretsminter/core";

const CF_API = "https://api.cloudflare.com/client/v4";

/** The two Pages deployment configs a var can be written to. A closed set — never an arbitrary key. */
type PagesEnvironment = "production" | "preview";
const VALID_ENVIRONMENTS: ReadonlySet<string> = new Set<PagesEnvironment>(["production", "preview"]);

export interface HttpResponse {
  readonly status: number;
  text(): Promise<string>;
}

export type HttpFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponse>;

export interface CloudflarePagesConfig {
  readonly accountId: string;
  /** A Cloudflare Pages API token VALUE (Account → Cloudflare Pages → Edit). The Bearer for the PATCH. */
  readonly apiToken: string;
  readonly http?: HttpFn;
  /** Poll interval while awaiting a triggered redeploy (ms). Default 5000; tests set 0. */
  readonly redeployPollMs?: number;
  /** Give-up timeout while awaiting a triggered redeploy (ms). Default 300000 (5 min). */
  readonly redeployTimeoutMs?: number;
  /** Injectable clock/sleep so the await loop is unit-tested without real time. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Injectable monotonic clock (ms) for the timeout, so tests don't depend on wall time. */
  readonly now?: () => number;
  /**
   * How to redeploy a **direct-upload** project (one with no Git connection — CF cannot rebuild it from
   * source). The hook TRIGGERS the operator's own deploy pipeline (e.g. a GitHub Actions
   * `workflow_dispatch` that runs `wrangler pages deploy`); the store then awaits the resulting fresh
   * deployment via the CF API. Omit for Git-connected projects (the store rebuilds those directly);
   * omitting it on a direct-upload project makes `activate` throw a clear, actionable error rather than
   * fail obscurely. See {@link githubWorkflowDispatchHook}.
   */
  readonly redeployHook?: RedeployHook;
}

/**
 * Triggers an external redeploy of a direct-upload Pages project and returns once the trigger is
 * accepted (NOT once the deploy finishes — the store awaits completion via the CF API). Injectable so
 * the trigger mechanism (GitHub Actions, GitLab CI, a webhook, …) is pluggable and unit-testable.
 */
export type RedeployHook = () => Promise<void>;

const defaultHttp: HttpFn = async (url, init) => {
  const r = await fetch(url, init);
  return { status: r.status, text: () => r.text() };
};

/** Pull the deployment id out of a CF "create deployment" response (`{ result: { id } }`). Tolerant of
 *  shape drift: returns "" if absent rather than throwing, so the caller emits a clear domain error. */
function readDeploymentId(bodyText: string): string {
  try {
    const j = JSON.parse(bodyText) as { result?: { id?: unknown } };
    return typeof j.result?.id === "string" ? j.result.id : "";
  } catch {
    return "";
  }
}

/** Pull `result.latest_stage` (`{ name, status }`) out of a CF "get deployment" response. Unknown/absent
 *  reads back as a non-terminal `{ name: "?", status: "?" }` so the poll loop keeps waiting, not crashes. */
function readLatestStage(bodyText: string): { name: string; status: string } {
  try {
    const j = JSON.parse(bodyText) as { result?: { latest_stage?: { name?: unknown; status?: unknown } } };
    const s = j.result?.latest_stage ?? {};
    return {
      name: typeof s.name === "string" ? s.name : "?",
      status: typeof s.status === "string" ? s.status : "?",
    };
  } catch {
    return { name: "?", status: "?" };
  }
}

/** True iff a CF "get project" response has a non-null `result.source` — i.e. it is a Git-connected
 *  project CF can rebuild. A direct-upload project has no source, so this reads false. */
function readHasSource(bodyText: string): boolean {
  try {
    const j = JSON.parse(bodyText) as { result?: { source?: unknown } };
    const s = j.result?.source;
    return s !== null && s !== undefined && typeof s === "object";
  } catch {
    return false;
  }
}

/** The newest deployment for `environment` from a CF "list deployments" response (`result` is an array,
 *  newest first), as `{ id, stage }`, or null if none match. Used to (a) snapshot the current deployment
 *  before an external redeploy and (b) detect the fresh one afterward. */
function readNewestDeployment(
  bodyText: string,
  environment: string,
): { id: string; stage: { name: string; status: string } } | null {
  try {
    const j = JSON.parse(bodyText) as {
      result?: Array<{ id?: unknown; environment?: unknown; latest_stage?: { name?: unknown; status?: unknown } }>;
    };
    for (const d of j.result ?? []) {
      if (typeof d.id === "string" && d.environment === environment) {
        const s = d.latest_stage ?? {};
        return {
          id: d.id,
          stage: {
            name: typeof s.name === "string" ? s.name : "?",
            status: typeof s.status === "string" ? s.status : "?",
          },
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export class CloudflarePagesStore implements Store {
  readonly id = "cloudflare-pages" as const;
  readonly #accountId: string;
  readonly #apiToken: string;
  readonly #http: HttpFn;
  readonly #redeployPollMs: number;
  readonly #redeployTimeoutMs: number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #redeployHook: RedeployHook | undefined;

  constructor(cfg: CloudflarePagesConfig) {
    this.#accountId = cfg.accountId;
    this.#apiToken = cfg.apiToken;
    this.#http = cfg.http ?? defaultHttp;
    this.#redeployPollMs = cfg.redeployPollMs ?? 5000;
    this.#redeployTimeoutMs = cfg.redeployTimeoutMs ?? 300000;
    this.#sleep = cfg.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = cfg.now ?? (() => Date.now());
    this.#redeployHook = cfg.redeployHook;
  }

  /**
   * Build the store from environment variables — the bootstrap ("secret zero") seam. In production these
   * are injected by the broker env, not pasted (see docs/MANUAL-STEPS.md / the story).
   */
  static fromEnv(
    env: Record<string, string | undefined> = process.env,
    opts?: { redeployHook?: RedeployHook },
  ): CloudflarePagesStore {
    const accountId = env["SECRETSMINTER_CF_ACCOUNT_ID"];
    const apiToken = env["SECRETSMINTER_CF_PAGES_TOKEN"];
    const missing = Object.entries({ accountId, apiToken })
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (missing.length > 0) {
      throw new Error(`CloudflarePagesStore.fromEnv: missing SECRETSMINTER_CF_* for ${missing.join(", ")}`);
    }
    return new CloudflarePagesStore({
      accountId: accountId!,
      apiToken: apiToken!,
      ...(opts?.redeployHook ? { redeployHook: opts.redeployHook } : {}),
    });
  }

  /**
   * Place a SECRET env var (`secret_text`) into the Pages project. The Store-interface method: the
   * value lives in `secret.material` (a SecretValue) and is exposed only into the request body.
   */
  async place(target: PlaceTarget, secret: MintedSecret): Promise<void> {
    await this.#patch(target, "secret_text", secret.material.expose(), secret.material);
  }

  /**
   * Place a NON-secret env var (`plain_text`) into the Pages project — e.g. a URL that is fine to store
   * and echo. A separate method precisely because it is NOT value-blind material; the type carries that.
   */
  async placePlain(target: PlaceTarget, value: string): Promise<void> {
    await this.#patch(target, "plain_text", value);
  }

  /**
   * ADR 0004: a Pages env-var change is effective only on the **next deploy**, so a placement is not
   * complete until a redeploy is **triggered and awaited**. HOW to redeploy depends on the project type,
   * which this method detects first:
   *
   *  - **Git-connected** project → CF can rebuild it: POST a fresh production deployment, poll to success.
   *  - **Direct-upload** project (no Git `source`) → CF *cannot* rebuild it; the operator's own pipeline
   *    must deploy. We fire the configured {@link RedeployHook} (e.g. a CI `workflow_dispatch`) and then
   *    await the fresh deployment it produces via the CF API. With no hook configured, we throw a clear,
   *    actionable error rather than silently POST a rebuild that a direct-upload project rejects.
   *
   * Either way it returns only on `deploy: success`; a failed/canceled deploy or a timeout throws, so a
   * rotation never reports a secret live while the old deployment still serves. No secret value is
   * involved in a redeploy (deploy metadata is non-secret) — but HTTP errors still surface status only.
   */
  async activate(target: PlaceTarget): Promise<void> {
    if (target.project === undefined) throw new Error("cloudflare-pages store requires target.project");
    const projectUrl = `${CF_API}/accounts/${this.#accountId}/pages/projects/${encodeURIComponent(target.project)}`;
    const deployments = `${projectUrl}/deployments`;
    const auth = { Authorization: `Bearer ${this.#apiToken}` };
    const environment = target.environment ?? "production";

    if (await this.#isGitConnected(projectUrl, auth)) {
      // Git-connected: CF rebuilds from the connected branch.
      const id = await this.#triggerRebuild(deployments, auth);
      await this.#awaitDeploymentId(deployments, auth, id);
      return;
    }

    // Direct-upload: CF can't rebuild. Require an external redeploy trigger.
    if (!this.#redeployHook) {
      throw new Error(
        `cloudflare-pages: '${target.project}' is a direct-upload project (no Git connection), so CF ` +
          `cannot rebuild it from source. Configure a redeployHook (e.g. a GitHub Actions workflow_dispatch) ` +
          `so secretsminter can trigger your deploy pipeline. See githubWorkflowDispatchHook.`,
      );
    }
    // Snapshot the current newest deployment, fire the operator's pipeline, then await a NEW one succeed.
    const priorId = await this.#newestDeploymentId(deployments, auth, environment);
    await this.#redeployHook();
    await this.#awaitFreshDeployment(deployments, auth, environment, priorId);
  }

  /** GET the project; true iff it has a Git `source` (CF-rebuildable), false for a direct-upload project. */
  async #isGitConnected(projectUrl: string, auth: Record<string, string>): Promise<boolean> {
    let res: HttpResponse;
    try {
      res = await this.#http(projectUrl, { method: "GET", headers: auth });
    } catch (err) {
      throw new Error(`cloudflare-pages project read failed: ${scrubError(err, [])}`);
    }
    if (res.status >= 400) throw new Error(`cloudflare-pages project read failed (HTTP ${res.status})`);
    return readHasSource(await res.text());
  }

  /** POST a rebuild (Git-connected only); return the new deployment id (throws on error / missing id). */
  async #triggerRebuild(deployments: string, auth: Record<string, string>): Promise<string> {
    let res: HttpResponse;
    try {
      res = await this.#http(deployments, { method: "POST", headers: auth });
    } catch (err) {
      throw new Error(`cloudflare-pages redeploy trigger failed: ${scrubError(err, [])}`);
    }
    if (res.status >= 400) throw new Error(`cloudflare-pages redeploy trigger failed (HTTP ${res.status})`);
    const id = readDeploymentId(await res.text());
    if (!id) throw new Error("cloudflare-pages redeploy trigger returned no deployment id");
    return id;
  }

  /** Poll one known deployment id to deploy:success (throws on failure/canceled/timeout). */
  async #awaitDeploymentId(deployments: string, auth: Record<string, string>, id: string): Promise<void> {
    const deadline = this.#now() + this.#redeployTimeoutMs;
    for (;;) {
      const stage = await this.#pollStage(`${deployments}/${encodeURIComponent(id)}`, auth);
      if (stage.name === "deploy" && stage.status === "success") return;
      if (stage.status === "failure" || stage.status === "canceled")
        throw new Error(`cloudflare-pages redeploy did not succeed (${stage.name}:${stage.status})`);
      if (this.#now() >= deadline)
        throw new Error(`cloudflare-pages redeploy timed out after ${this.#redeployTimeoutMs}ms (last ${stage.name}:${stage.status})`);
      await this.#sleep(this.#redeployPollMs);
    }
  }

  /** The id of the newest deployment for `environment`, or null if none — the pre-trigger snapshot. */
  async #newestDeploymentId(deployments: string, auth: Record<string, string>, environment: string): Promise<string | null> {
    let res: HttpResponse;
    try {
      res = await this.#http(deployments, { method: "GET", headers: auth });
    } catch (err) {
      throw new Error(`cloudflare-pages deployment list failed: ${scrubError(err, [])}`);
    }
    if (res.status >= 400) throw new Error(`cloudflare-pages deployment list failed (HTTP ${res.status})`);
    return readNewestDeployment(await res.text(), environment)?.id ?? null;
  }

  /** Await a NEW deployment (a different id than the pre-trigger `priorId`) reaching deploy:success —
   *  for a direct-upload project whose deploy was just kicked off externally by the redeploy hook. */
  async #awaitFreshDeployment(
    deployments: string,
    auth: Record<string, string>,
    environment: string,
    priorId: string | null,
  ): Promise<void> {
    const deadline = this.#now() + this.#redeployTimeoutMs;
    for (;;) {
      let res: HttpResponse;
      try {
        res = await this.#http(deployments, { method: "GET", headers: auth });
      } catch (err) {
        throw new Error(`cloudflare-pages deployment list failed: ${scrubError(err, [])}`);
      }
      if (res.status >= 400) throw new Error(`cloudflare-pages deployment list failed (HTTP ${res.status})`);
      const newest = readNewestDeployment(await res.text(), environment);
      if (newest && newest.id !== priorId) {
        if (newest.stage.name === "deploy" && newest.stage.status === "success") return;
        if (newest.stage.status === "failure" || newest.stage.status === "canceled")
          throw new Error(`cloudflare-pages redeploy did not succeed (${newest.stage.name}:${newest.stage.status})`);
      }
      if (this.#now() >= deadline)
        throw new Error(`cloudflare-pages redeploy timed out after ${this.#redeployTimeoutMs}ms (no fresh successful deployment)`);
      await this.#sleep(this.#redeployPollMs);
    }
  }

  async #pollStage(url: string, auth: Record<string, string>): Promise<{ name: string; status: string }> {
    let poll: HttpResponse;
    try {
      poll = await this.#http(url, { method: "GET", headers: auth });
    } catch (err) {
      throw new Error(`cloudflare-pages redeploy poll failed: ${scrubError(err, [])}`);
    }
    if (poll.status >= 400) throw new Error(`cloudflare-pages redeploy poll failed (HTTP ${poll.status})`);
    return readLatestStage(await poll.text());
  }

  async #patch(
    target: PlaceTarget,
    type: "secret_text" | "plain_text",
    value: string,
    material?: SecretValue,
  ): Promise<void> {
    if (target.project === undefined) throw new Error("cloudflare-pages store requires target.project");
    // Defense in depth (the allow-list already matched this target): an env-var name is a single token —
    // never a '/' — and the project is percent-encoded so a crafted project can't traverse or reshape
    // the URL path within the fixed api.cloudflare.com host.
    if (target.name.includes("/")) throw new Error("cloudflare-pages store: env-var name must not contain '/'");
    const environment = target.environment ?? "production";
    if (!VALID_ENVIRONMENTS.has(environment)) {
      throw new Error(
        `cloudflare-pages store: unknown environment '${environment}' (expected production|preview)`,
      );
    }
    const url = `${CF_API}/accounts/${this.#accountId}/pages/projects/${encodeURIComponent(target.project)}`;
    const body = JSON.stringify({
      deployment_configs: { [environment]: { env_vars: { [target.name]: { type, value } } } },
    });

    let res: HttpResponse;
    try {
      res = await this.#http(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.#apiToken}` },
        body,
      });
    } catch (err) {
      // A thrown network error might inline the request body (and thus the value); scrub it out.
      throw new Error(`cloudflare-pages set-env failed: ${scrubError(err, material ? [material] : [])}`);
    }
    // Status only — never the response body.
    if (res.status >= 400) {
      throw new Error(`cloudflare-pages set-env '${target.name}' failed (HTTP ${res.status})`);
    }
  }
}
