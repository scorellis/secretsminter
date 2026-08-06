/**
 * Self-lockout guard (docs/adrs/0010).
 *
 * The broker depends on some credentials to function at all: its own store-writer cred, the GitHub
 * App private key it mints installation tokens from, the approval-signing key, any bootstrap cred.
 * If the scheduler ever rotated one of these, the broker would cut off its own hands mid-rotation.
 * These are refused unconditionally — they rotate out-of-band, by a human/hardware path.
 */

export class SelfLockoutError extends Error {
  constructor(public readonly secretId: string) {
    super(`refusing to rotate '${secretId}': the broker itself depends on this credential`);
    this.name = "SelfLockoutError";
  }
}

/** True if the secret is one the broker itself depends on. */
export function dependsOnBroker(secretId: string, brokerDeps: ReadonlySet<string>): boolean {
  return brokerDeps.has(secretId);
}

export function assertNotSelfLockout(secretId: string, brokerDeps: ReadonlySet<string>): void {
  if (dependsOnBroker(secretId, brokerDeps)) throw new SelfLockoutError(secretId);
}
