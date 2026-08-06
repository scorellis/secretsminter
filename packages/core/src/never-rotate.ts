/**
 * NEVER_ROTATE — enforced by NAME and by CLASS (docs/adrs/0010).
 *
 * Ported from the reference rotate_secrets.py NEVER_ROTATE frozenset: an unconditional,
 * case-insensitive exclusion that always wins. Two differences here, both from the security review:
 *
 *   - It is a COMMITTED CONSTANT, not runtime config — a prompt-injected agent cannot add or remove
 *     entries through a tool call.
 *   - It matches by name AND by class. A signing key minted under a fresh name evades a name-only
 *     list, so the *class* is the real guard.
 *
 * The canonical case: an updater/release signing key whose public half is baked into already-shipped
 * builds. Rotating it bricks the updater. It may be minted and placed, never rotated or revoked.
 */

import type { SecretClass, SecretDescriptor } from "./types.js";

/** Names that must never rotate, matched case-insensitively. */
export const NEVER_ROTATE_NAMES: ReadonlySet<string> = new Set(
  ["updater-signing-key", "release-signing-key", "tauri-signing-key"].map((n) => n.toLowerCase()),
);

/** Classes that must never rotate regardless of name. */
export const NEVER_ROTATE_CLASSES: ReadonlySet<SecretClass> = new Set<SecretClass>([
  "updater-signing-key",
]);

export class NeverRotateError extends Error {
  constructor(
    public readonly descriptorId: string,
    reason: string,
  ) {
    super(`refusing to rotate '${descriptorId}': ${reason}`);
    this.name = "NeverRotateError";
  }
}

export function isRotatable(d: SecretDescriptor): boolean {
  if (NEVER_ROTATE_NAMES.has(d.name.toLowerCase())) return false;
  if (NEVER_ROTATE_CLASSES.has(d.secretClass)) return false;
  return true;
}

/** Hard-fail if a secret must never rotate. Called at BOTH the scheduler level (never enqueue) and
 *  the executor level (rotate/revoke refuse) — double enforcement. */
export function assertRotatable(d: SecretDescriptor): void {
  if (NEVER_ROTATE_NAMES.has(d.name.toLowerCase())) {
    throw new NeverRotateError(d.id, `name '${d.name}' is in NEVER_ROTATE`);
  }
  if (NEVER_ROTATE_CLASSES.has(d.secretClass)) {
    throw new NeverRotateError(d.id, `class '${d.secretClass}' is never-rotatable`);
  }
}
