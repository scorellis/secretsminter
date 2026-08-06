/**
 * The destination allow-list — the real trust root (docs/adrs/0008).
 *
 * Value-blindness stops the agent *reading* a secret. It does nothing to stop a prompt-injected
 * agent from *directing* a live secret to an attacker: "mint an R2 token and place it into
 * attacker/evil's Actions secrets" exfiltrates a working credential the agent never sees. The only
 * thing that stops that is this: placement targets must MATCH a pre-registered, human-approved,
 * signed allow-list. Anything else is refused.
 *
 * Semantics are strict default-deny. An entry matches a target only if every identifying field the
 * entry declares is exactly equal to the target's, and a field the entry omits must ALSO be absent
 * on the target. `undefined` never means "wildcard" — that would be the footgun this exists to
 * prevent. `namePattern` is the one optional narrowing (a simple `*` glob); omitted = any name at
 * that exact destination.
 */

import type { PlaceTarget, StoreId } from "./types.js";

export interface AllowlistEntry {
  readonly store: StoreId;
  readonly repo?: string;
  readonly project?: string;
  readonly environment?: string;
  readonly namePattern?: string;
}

export interface Manifest {
  readonly version: number;
  readonly allow: readonly AllowlistEntry[];
  /** Extra secret names that must never rotate, unioned with the committed NEVER_ROTATE_NAMES
   *  constant. Operators declare deployment-specific un-rotatable names here. */
  readonly neverRotate?: readonly string[];
  /** Secret ids the broker itself depends on — the self-lockout set (guard.ts). */
  readonly brokerDependencies?: readonly string[];
}

export class DestinationDeniedError extends Error {
  constructor(target: PlaceTarget) {
    const where = target.repo ?? target.project ?? "?";
    super(`destination denied (not in signed allow-list): ${target.store}:${where}/${target.name}`);
    this.name = "DestinationDeniedError";
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function nameMatches(pattern: string | undefined, name: string): boolean {
  if (pattern === undefined) return true;
  const re = new RegExp("^" + pattern.split("*").map(escapeRegExp).join(".*") + "$");
  return re.test(name);
}

function eq(a: string | undefined, b: string | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

export function allowlistMatch(target: PlaceTarget, manifest: Manifest): boolean {
  return manifest.allow.some(
    (e) =>
      e.store === target.store &&
      eq(e.repo, target.repo) &&
      eq(e.project, target.project) &&
      eq(e.environment, target.environment) &&
      nameMatches(e.namePattern, target.name),
  );
}

/** Hard-fail if a placement destination is not in the signed allow-list. Called in the core before
 *  any place/rotate touches a store. */
export function assertAllowed(target: PlaceTarget, manifest: Manifest): void {
  if (!allowlistMatch(target, manifest)) throw new DestinationDeniedError(target);
}
