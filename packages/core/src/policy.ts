/**
 * The single rotation-safety gate (docs/adrs/0010).
 *
 * `NEVER_ROTATE` (never-rotate.ts) and the self-lockout guard (guard.ts) are two independent reasons a
 * rotation must be refused. They are composed here so a live caller cannot accidentally enforce one
 * and forget the other — every `rotate`/`revoke` path calls `assertMayRotate`, not the two checks
 * by hand. Defense against a wiring mistake, not just a logic bug.
 */

import { assertNotSelfLockout } from "./guard.js";
import { assertRotatable } from "./never-rotate.js";
import type { SecretDescriptor } from "./types.js";

/** Throws if the secret must never rotate (by name or class) or if the broker itself depends on it. */
export function assertMayRotate(d: SecretDescriptor, brokerDeps: ReadonlySet<string>): void {
  assertRotatable(d); // NEVER_ROTATE by name AND class
  assertNotSelfLockout(d.id, brokerDeps); // broker-dependency / self-lockout
}
