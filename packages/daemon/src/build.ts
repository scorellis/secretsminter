/**
 * The broker builder — assembles the core `Broker` from config: the signed manifest (trust root),
 * providers (each from its own env), stores, durable state, kill switch, approval gate, and sinks.
 *
 * Safe defaults when a piece isn't configured: an **empty allow-list** (nothing can be placed),
 * **deny-all approvals** (nothing mutating runs), a **never-engaged** kill switch, in-memory state.
 * A provider whose bootstrap env isn't present is simply skipped — the daemon runs with whatever is
 * configured. Nothing secret is stored here; provider bootstraps are read from env at assembly time.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import {
  Broker,
  DenyAllGate,
  FileAlertSink,
  FileApprovalGate,
  FileKillSwitch,
  FileStateStore,
  HashChainedAuditSink,
  InMemoryStateStore,
  NeverEngagedKillSwitch,
  NullAlertSink,
  verifyAndLoadManifest,
  type AlertSink,
  type ApprovalGate,
  type AuditSink,
  type KillSwitch,
  type Manifest,
  type Provider,
  type ProviderId,
  type StateStore,
  type Store,
  type StoreId,
} from "@secretsminter/core";
import {
  CloudflarePagesStore,
  CloudflareProvider,
  GithubActionsStore,
  GithubProvider,
  githubWorkflowDispatchHookFromEnv,
  LocalSecretProvider,
  SupabaseProvider,
} from "@secretsminter/providers";
import type { DaemonConfig } from "./config.js";

export interface DaemonIo {
  /** File contents, or null if absent. */
  readText(path: string): string | null;
  env: Record<string, string | undefined>;
}

export const defaultIo: DaemonIo = {
  readText: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  env: process.env,
};

const EMPTY_MANIFEST: Manifest = { version: 1, allow: [] };

export interface AssembledBroker {
  readonly broker: Broker;
  readonly providers: readonly ProviderId[];
  readonly stores: readonly StoreId[];
  readonly manifestLoaded: boolean;
}

export function buildBroker(config: DaemonConfig, io: DaemonIo = defaultIo): AssembledBroker {
  // Manifest — the trust root. Enforced only if all three files are present AND the signature verifies
  // (a tampered manifest throws here, failing the daemon fast rather than running unprotected).
  let manifest = EMPTY_MANIFEST;
  let manifestLoaded = false;
  if (config.manifestPath && config.manifestSigPath && config.manifestPublicKeyPath) {
    const json = io.readText(config.manifestPath);
    const sig = io.readText(config.manifestSigPath);
    const pub = io.readText(config.manifestPublicKeyPath);
    if (json !== null && sig !== null && pub !== null) {
      manifest = verifyAndLoadManifest(json, sig, pub);
      manifestLoaded = true;
    }
  }

  // Providers — each from its own env; a provider whose bootstrap isn't configured is skipped.
  const providers = new Map<ProviderId, Provider>();
  const tryProvider = (id: ProviderId, make: () => Provider): void => {
    try {
      providers.set(id, make());
    } catch {
      /* not configured — skip */
    }
  };
  tryProvider("cloudflare", () => CloudflareProvider.fromEnv(io.env));
  tryProvider("github", () => GithubProvider.fromEnv(io.env));
  tryProvider("supabase", () => SupabaseProvider.fromEnv(io.env));
  // The local random-secret provider needs no bootstrap credential (story 0020), so it registers
  // unconditionally — `fromEnv` never throws, making it always available for minting app secrets.
  tryProvider("local", () => LocalSecretProvider.fromEnv(io.env));

  // Stores — a GitHub Actions store if the GitHub provider is configured (it supplies the auth token).
  const stores = new Map<StoreId, Store>();
  const gh = providers.get("github");
  if (gh instanceof GithubProvider) {
    stores.set(
      "github-actions",
      new GithubActionsStore({ getInstallationToken: async () => (await gh.installationToken()).token }),
    );
  }
  // Cloudflare Pages store — wired when its bootstrap env (SECRETSMINTER_CF_ACCOUNT_ID +
  // SECRETSMINTER_CF_PAGES_TOKEN) is present, so a mint_and_place can target `cloudflare-pages` through
  // the daemon/MCP path, not only the runner script. (Deep review 2026-08-05, finding 1.)
  // For a direct-upload Pages project, an optional redeploy hook (SECRETSMINTER_PAGES_REDEPLOY=github)
  // lets `activate` trigger the operator's deploy pipeline; without it, activate throws a clear error.
  try {
    const redeployHook = githubWorkflowDispatchHookFromEnv(io.env);
    stores.set(
      "cloudflare-pages",
      CloudflarePagesStore.fromEnv(io.env, redeployHook ? { redeployHook } : {}),
    );
  } catch {
    /* not configured — skip, same as the providers above */
  }

  const approvals: ApprovalGate = config.approvalsPath
    ? FileApprovalGate.fromPath(config.approvalsPath)
    : new DenyAllGate();
  const killSwitch: KillSwitch = config.killSwitchPath
    ? FileKillSwitch.fromPath(config.killSwitchPath)
    : new NeverEngagedKillSwitch();
  const alerts: AlertSink = config.alertLogPath
    ? FileAlertSink.toPath(config.alertLogPath)
    : new NullAlertSink();
  const stateStore: StateStore = config.statePath
    ? new FileStateStore(config.statePath)
    : new InMemoryStateStore();
  const auditPath = config.auditLogPath;
  const audit: AuditSink | undefined = auditPath
    ? new HashChainedAuditSink((line) => appendFileSync(auditPath, line))
    : undefined;

  const broker = new Broker({
    manifest,
    providers,
    stores,
    approvals,
    killSwitch,
    alerts,
    stateStore,
    ...(audit ? { audit } : {}),
  });
  return { broker, providers: [...providers.keys()], stores: [...stores.keys()], manifestLoaded };
}
