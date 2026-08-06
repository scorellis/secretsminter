/**
 * Approval gate (docs/adrs/0005).
 *
 * Every mutating action is bound to a deterministic **action hash** (provider + action + destination +
 * scope) so an approval cannot be replayed for a different action. The gate that decides whether an
 * action is approved lives OUT-OF-BAND — the agent never holds an approval and cannot call the gate.
 *
 * This module provides the interface, the action-hash, and a `DenyAllGate` default. The real
 * out-of-band channel (a human confirming on a separate device, with expiry) is story 0007; the broker
 * depends only on this interface, so wiring the real channel later changes nothing in the pipeline.
 */

import { createHash } from "node:crypto";
import type { PlaceTarget, ProviderId, SecretAction } from "./types.js";

export interface ActionRequest {
  readonly action: SecretAction;
  readonly provider: ProviderId;
  readonly target?: PlaceTarget;
  readonly secretId?: string;
  readonly scopes?: readonly string[];
}

/** Deterministic hash of the exact action. Binding an approval to this prevents replay for a
 *  different action (different destination, scope, provider, ...). */
export function actionHash(req: ActionRequest): string {
  const canonical = JSON.stringify({
    action: req.action,
    provider: req.provider,
    target: req.target ?? null,
    secretId: req.secretId ?? null,
    scopes: [...(req.scopes ?? [])].sort(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export class ApprovalDeniedError extends Error {
  constructor(hash: string) {
    super(`action not approved (or approval expired): ${hash.slice(0, 12)}…`);
    this.name = "ApprovalDeniedError";
  }
}

/**
 * The gate the broker consults before any mutating action. `check` returns true iff the operator has
 * approved exactly this action hash and the approval has not expired at `nowEpochMs`. Default-deny.
 */
export interface ApprovalGate {
  check(hash: string, nowEpochMs: number): boolean;
}

/** The safe default: nothing is approved. The broker refuses every mutating action. */
export class DenyAllGate implements ApprovalGate {
  check(): boolean {
    return false;
  }
}
