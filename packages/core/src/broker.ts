/**
 * The Broker — the internal, key-holding tier (docs/adrs/0009).
 *
 * This is where every security invariant is enforced, once, on the path an agent's request actually
 * takes. The agent-facing MCP server (@secretsminter/mcp) calls these methods; it never bypasses them.
 * Every method returns a **value-blind** `ToolResult` (or value-free inventory); a live secret value
 * never appears in a return value, and failures collapse to a safe reason CODE (never a raw message,
 * which could inline a token).
 *
 * The provider/store maps are injected, so the pipeline is fully testable with fakes and the same code
 * runs against live providers once they are wired (stories 0003–0005).
 */

import { createHash } from "node:crypto";
import { NullAlertSink, type AlertLevel, type AlertSink } from "./alert.js";
import { assertAllowed, allowlistMatch, type Manifest } from "./allowlist.js";
import { actionHash, ApprovalDeniedError, type ActionRequest, type ApprovalGate } from "./approval.js";
import type { AuditEntry, AuditSink } from "./audit.js";
import { assertNotSelfLockout } from "./guard.js";
import { KillSwitchEngagedError, NeverEngagedKillSwitch, type KillSwitch } from "./kill-switch.js";
import { brokerDependencySet, effectiveNeverRotateNames } from "./manifest.js";
import { assertRotatable, NeverRotateError } from "./never-rotate.js";
import { NotWiredError, type Provider, type Store } from "./provider.js";
import { InMemoryStateStore, type StateStore } from "./state-store.js";
import type {
  PlaceTarget,
  ProviderId,
  SecretAction,
  SecretClass,
  SecretDescriptor,
  StoreId,
  ToolResult,
} from "./types.js";
import { scrub, whitelistSerialize } from "./value-blind.js";

export interface MintAndPlaceRequest {
  readonly provider: ProviderId;
  readonly name: string;
  readonly secretClass: SecretClass;
  readonly target: PlaceTarget;
  readonly scopes?: readonly string[];
  readonly ephemeralTtlSeconds?: number;
  /** If set, the broker records a recurring rotation cadence for this secret so the scheduler keeps
   *  it fresh hands-free (the self-maintaining loop). Ephemeral creds self-expire and don't need it. */
  readonly rotateEveryMs?: number;
}

export interface PlanResult {
  readonly action: SecretAction;
  readonly provider: ProviderId;
  readonly destination: string;
  readonly allowed: boolean;
  readonly reason: string;
}

export interface SecretSummary {
  readonly id: string;
  readonly name: string;
  readonly provider: ProviderId;
  readonly secretClass: SecretClass;
  readonly destination: string;
}

export interface BrokerResult {
  readonly toolResult: ToolResult;
  /** A safe, non-secret reason CODE for a failure (e.g. "destination-not-allow-listed"). Never a raw
   *  provider message. */
  readonly reason?: string;
}

export interface BrokerConfig {
  readonly manifest: Manifest;
  readonly providers: ReadonlyMap<ProviderId, Provider>;
  readonly stores: ReadonlyMap<StoreId, Store>;
  readonly approvals: ApprovalGate;
  /** The fail-closed halt for all mutating ops. Defaults to never-engaged; production must set one. */
  readonly killSwitch?: KillSwitch;
  /** The full value-free audit trail (hash-chained in production). */
  readonly audit?: AuditSink;
  /** Attention-worthy events (mint placed, rotation failed, drift). Defaults to discard. */
  readonly alerts?: AlertSink;
  /** Durable, value-free persistence of the managed-secret registry + schedule. Lets the broker
   *  survive a restart and keep the self-maintaining loop running. Defaults to non-durable in-memory. */
  readonly stateStore?: StateStore;
  /** Injected clock (ms since epoch). Defaults to Date.now. Injectable for deterministic tests. */
  readonly now?: () => number;
}

function describeTarget(t: PlaceTarget): string {
  return `${t.store}:${t.repo ?? t.project ?? "-"}/${t.name}`;
}

/** Map any thrown error to a safe, non-secret reason code — never the raw message. */
function classifyError(err: unknown): string {
  if (err instanceof KillSwitchEngagedError) return "kill-switch-engaged";
  if (err instanceof ApprovalDeniedError) return "approval-required";
  if (err instanceof NeverRotateError) return "never-rotate";
  if (err instanceof NotWiredError) return "provider-not-wired";
  const name = err instanceof Error ? err.name : "";
  if (name === "DestinationDeniedError") return "destination-not-allow-listed";
  if (name === "SelfLockoutError") return "broker-dependency";
  if (name === "SecretNotFoundError") return "secret-not-found";
  return "error";
}

class SecretNotFoundError extends Error {
  constructor(id: string) {
    super(`no managed secret with id ${id}`);
    this.name = "SecretNotFoundError";
  }
}

export class Broker {
  readonly #manifest: Manifest;
  readonly #providers: ReadonlyMap<ProviderId, Provider>;
  readonly #stores: ReadonlyMap<StoreId, Store>;
  readonly #approvals: ApprovalGate;
  readonly #killSwitch: KillSwitch;
  readonly #audit: AuditSink | undefined;
  readonly #alerts: AlertSink;
  readonly #stateStore: StateStore;
  readonly #now: () => number;
  readonly #secrets = new Map<string, SecretDescriptor>();
  /** Per-secret rotation cadence for the self-maintaining loop (story 0009). */
  readonly #schedule = new Map<string, { cadenceMs: number; nextAt: number }>();

  constructor(cfg: BrokerConfig) {
    this.#manifest = cfg.manifest;
    this.#providers = cfg.providers;
    this.#stores = cfg.stores;
    this.#approvals = cfg.approvals;
    this.#killSwitch = cfg.killSwitch ?? new NeverEngagedKillSwitch();
    this.#audit = cfg.audit;
    this.#alerts = cfg.alerts ?? new NullAlertSink();
    this.#stateStore = cfg.stateStore ?? new InMemoryStateStore();
    this.#now = cfg.now ?? (() => Date.now());
    this.#restore();
  }

  /** Rehydrate the managed-secret registry + schedule from durable state (survives a restart). */
  #restore(): void {
    const state = this.#stateStore.load();
    if (state === null) return;
    for (const d of state.secrets) this.#secrets.set(d.id, d);
    for (const s of state.schedule) this.#schedule.set(s.id, { cadenceMs: s.cadenceMs, nextAt: s.nextAt });
  }

  /** Persist the value-free state after any change to the registry or schedule. */
  #persist(): void {
    this.#stateStore.save({
      secrets: [...this.#secrets.values()],
      schedule: [...this.#schedule.entries()].map(([id, s]) => ({ id, cadenceMs: s.cadenceMs, nextAt: s.nextAt })),
    });
  }

  // ---- read-only tools -----------------------------------------------------

  listSecrets(): readonly SecretSummary[] {
    return [...this.#secrets.values()].map((d) => ({
      id: d.id,
      name: d.name,
      provider: d.provider,
      secretClass: d.secretClass,
      destination: describeTarget(d.target),
    }));
  }

  status(): { readonly count: number; readonly secrets: readonly SecretSummary[] } {
    return { count: this.#secrets.size, secrets: this.listSecrets() };
  }

  /** Ids of managed secrets whose scheduled rotation is due at the current time. */
  dueForRotation(): readonly string[] {
    const now = this.#now();
    const due: string[] = [];
    for (const [id, s] of this.#schedule) {
      if (s.nextAt <= now) due.push(id);
    }
    return due;
  }

  /**
   * Rotate every secret currently due — the self-maintaining loop's per-tick work (story 0009). Each
   * rotation goes through the full gate (kill switch, approval, NEVER_ROTATE, self-lockout) and, on
   * success, reschedules itself. This is what a {@link Scheduler} calls on each tick.
   */
  async runScheduledRotations(): Promise<readonly BrokerResult[]> {
    const results: BrokerResult[] = [];
    for (const id of this.dueForRotation()) {
      results.push(await this.rotate(id));
    }
    return results;
  }

  /** Dry-run: report what a mint+place WOULD do, checked against the allow-list. No mutation. */
  plan(req: MintAndPlaceRequest): PlanResult {
    const allowed = allowlistMatch(req.target, this.#manifest);
    return {
      action: "plan",
      provider: req.provider,
      destination: describeTarget(req.target),
      allowed,
      reason: allowed ? "would-mint-and-place" : "destination-not-allow-listed",
    };
  }

  // ---- mutating tools ------------------------------------------------------

  async mintAndPlace(req: MintAndPlaceRequest): Promise<BrokerResult> {
    const ar: ActionRequest = {
      action: "mint",
      provider: req.provider,
      target: req.target,
      ...(req.scopes ? { scopes: req.scopes } : {}),
    };
    const dest = describeTarget(req.target);
    try {
      // Order is principled: the kill switch (outermost hard halt) first, then the trust root (the
      // destination allow-list), then the human approval gate, then capability (provider/store
      // wiring). A disallowed destination is refused before we even consult whether a provider exists.
      this.#assertLive(); // fail-closed kill switch
      assertAllowed(req.target, this.#manifest); // destination allow-list (default-deny)
      this.#requireApproval(ar);
      const provider = this.#requireProvider(req.provider);
      const store = this.#requireStore(req.target.store);

      const descriptor = this.#makeDescriptor(req);
      const secret = await provider.mint({
        name: req.name,
        secretClass: req.secretClass,
        target: req.target,
        scopes: req.scopes ?? [],
        ...(req.ephemeralTtlSeconds !== undefined
          ? { ephemeralTtlSeconds: req.ephemeralTtlSeconds }
          : {}),
      });
      await store.place(req.target, secret);
      // ADR 0004: some destinations aren't effective until an out-of-band step (Cloudflare Pages needs a
      // redeploy). If the store declares `activate`, run it (trigger + await) BEFORE verify, so verify
      // probes the consumer-visible state — never a false-fresh secret while the old deploy still serves.
      if (store.activate) await store.activate(req.target);
      const verified = await provider.verify(descriptor, secret);
      if (!verified) throw new Error("verify probe failed");

      this.#secrets.set(descriptor.id, descriptor);
      if (req.rotateEveryMs !== undefined) {
        this.#schedule.set(descriptor.id, {
          cadenceMs: req.rotateEveryMs,
          nextAt: this.#now() + req.rotateEveryMs,
        });
      }
      this.#persist();
      this.#record("mint", req.provider, descriptor.id, dest, "ok");
      this.#alert("info", "mint-placed", req.provider, descriptor.id, dest);
      return {
        toolResult: whitelistSerialize({
          ok: true,
          provider: req.provider,
          action: "mint",
          secret_id: descriptor.id,
          placed_at: new Date(this.#now()).toISOString(),
        }),
      };
    } catch (err) {
      const reason = this.#scrubReason(err);
      const outcome = this.#deniedOrError(reason);
      this.#record("mint", req.provider, "", dest, outcome);
      this.#alert(outcome === "denied" ? "warn" : "error", "mint-failed", req.provider, "", dest, reason);
      return {
        toolResult: whitelistSerialize({ ok: false, provider: req.provider, action: "mint", secret_id: "" }),
        reason,
      };
    }
  }

  async rotate(secretId: string): Promise<BrokerResult> {
    return this.#rotateOrRevoke("rotate", secretId);
  }

  async revoke(secretId: string): Promise<BrokerResult> {
    return this.#rotateOrRevoke("revoke", secretId);
  }

  async #rotateOrRevoke(
    action: "rotate" | "revoke",
    secretId: string,
  ): Promise<BrokerResult> {
    let provider: ProviderId | null = null;
    let dest = "-";
    try {
      this.#assertLive(); // fail-closed kill switch, before anything
      const descriptor = this.#secrets.get(secretId);
      if (descriptor === undefined) throw new SecretNotFoundError(secretId);
      provider = descriptor.provider;
      dest = describeTarget(descriptor.target);

      const ar: ActionRequest = { action, provider: descriptor.provider, secretId };
      this.#requireApproval(ar);
      this.#assertMayRotate(descriptor); // NEVER_ROTATE (name+class, incl. manifest) + self-lockout

      const p = this.#requireProvider(descriptor.provider);
      if (action === "rotate") {
        const secret = await p.rotate(descriptor);
        const verified = await p.verify(descriptor, secret);
        if (!verified) throw new Error("verify probe failed");
        // Self-maintaining loop: advance this secret's next rotation from now.
        const sched = this.#schedule.get(secretId);
        if (sched !== undefined) sched.nextAt = this.#now() + sched.cadenceMs;
      } else {
        await p.revoke(descriptor);
        this.#secrets.delete(secretId);
        this.#schedule.delete(secretId);
      }
      this.#persist();
      this.#record(action, descriptor.provider, secretId, dest, "ok");
      this.#alert("info", `${action}-ok`, descriptor.provider, secretId, dest);
      return {
        toolResult: whitelistSerialize({
          ok: true,
          provider: descriptor.provider,
          action,
          secret_id: secretId,
          placed_at: new Date(this.#now()).toISOString(),
        }),
      };
    } catch (err) {
      const reason = this.#scrubReason(err);
      const outcome = this.#deniedOrError(reason);
      this.#record(action, provider, secretId, dest, outcome);
      // A rotation/revoke that fails for a non-policy reason is operationally important — error alert.
      this.#alert(outcome === "denied" ? "warn" : "error", `${action}-failed`, provider, secretId, dest, reason);
      return {
        toolResult: whitelistSerialize({ ok: false, provider, action, secret_id: secretId }),
        reason,
      };
    }
  }

  // ---- internals -----------------------------------------------------------

  #requireProvider(id: ProviderId): Provider {
    const p = this.#providers.get(id);
    if (p === undefined) throw new NotWiredError(`provider '${id}'`);
    return p;
  }

  #requireStore(id: StoreId): Store {
    const s = this.#stores.get(id);
    if (s === undefined) throw new NotWiredError(`store '${id}'`);
    return s;
  }

  #assertLive(): void {
    if (this.#killSwitch.engaged()) throw new KillSwitchEngagedError();
  }

  #requireApproval(ar: ActionRequest): void {
    const hash = actionHash(ar);
    if (!this.#approvals.check(hash, this.#now())) throw new ApprovalDeniedError(hash);
  }

  #assertMayRotate(d: SecretDescriptor): void {
    // Name check against the EFFECTIVE set (committed constant ∪ manifest additions)...
    if (effectiveNeverRotateNames(this.#manifest).has(d.name.toLowerCase())) {
      throw new NeverRotateError(d.id, `name '${d.name}' is in NEVER_ROTATE`);
    }
    // ...plus the class-based rule, and the self-lockout guard from the manifest's dependency set.
    assertRotatable(d);
    assertNotSelfLockout(d.id, brokerDependencySet(this.#manifest));
  }

  #makeDescriptor(req: MintAndPlaceRequest): SecretDescriptor {
    const key = `${req.provider}|${req.name}|${describeTarget(req.target)}`;
    const id = "sec_" + createHash("sha256").update(key, "utf8").digest("hex").slice(0, 16);
    return {
      id,
      name: req.name,
      provider: req.provider,
      secretClass: req.secretClass,
      target: req.target,
      scopes: req.scopes ?? [],
    };
  }

  /** A safe reason code, additionally scrubbed of any managed-secret names as belt-and-suspenders. */
  #scrubReason(err: unknown): string {
    return scrub(classifyError(err), []);
  }

  #record(
    action: SecretAction,
    provider: ProviderId | null,
    secretId: string,
    destination: string,
    outcome: AuditEntry["outcome"],
  ): void {
    this.#audit?.record({ action, provider, secretId, destination, outcome, at: this.#now() });
  }

  #alert(
    level: AlertLevel,
    kind: string,
    provider: ProviderId | null,
    secretId: string,
    destination: string,
    reason?: string,
  ): void {
    this.#alerts.emit({
      level,
      kind,
      at: this.#now(),
      provider,
      secretId,
      destination,
      ...(reason !== undefined ? { reason } : {}),
    });
  }

  /** A safe reason code maps to an audit outcome: policy refusals are "denied", the rest are "error". */
  #deniedOrError(reason: string): "denied" | "error" {
    const denied =
      reason === "approval-required" ||
      reason === "destination-not-allow-listed" ||
      reason === "kill-switch-engaged" ||
      reason === "never-rotate" ||
      reason === "broker-dependency";
    return denied ? "denied" : "error";
  }
}
