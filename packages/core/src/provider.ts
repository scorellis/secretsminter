/**
 * Provider and Store interfaces.
 *
 * A Provider mints/rotates/revokes/verifies credentials at a cloud vendor. A Store places an
 * already-minted secret at a destination. They are deliberately separate: minting authority
 * (crown-jewel) and placement are different privileges (docs/adrs/0002, 0004).
 *
 * `verify` is a first-class method, not an afterthought: it is a functional health probe with the
 * NEW credential (HEAD a bucket, call an API) that MUST pass before the old one is revoked — the
 * rotation state machine cannot reach REVOKED without it.
 */

import type { SecretValue } from "./secret-value.js";
import type { PlaceTarget, ProviderId, SecretClass, SecretDescriptor, StoreId } from "./types.js";

export interface MintInput {
  readonly name: string;
  readonly secretClass: SecretClass;
  readonly target: PlaceTarget;
  readonly scopes: readonly string[];
  /** Request a short-lived, self-expiring credential where the provider supports it (ephemeral-first). */
  readonly ephemeralTtlSeconds?: number;
}

/**
 * A minted secret's live material. Held ONLY inside the core; it is NEVER placed on a ToolResult,
 * NEVER logged, and crosses process boundaries via stdin only (docs/adrs/0001).
 */
export interface MintedSecret {
  readonly descriptor: SecretDescriptor;
  /** The live value, wrapped so it cannot be accidentally serialized (docs/adrs/0001). Read only
   *  via `.expose()`; the value-blind boundary keeps it out of every ToolResult. */
  readonly material: SecretValue;
  /** Extra material some providers return (e.g. an R2 sessionToken for temporary credentials).
   *  Also wrapped — a sessionToken is a secret. */
  readonly extra?: Readonly<Record<string, SecretValue>>;
  /** ISO-8601; present for ephemeral credentials that self-expire. */
  readonly expiresAt?: string;
}

export interface ProviderInfo {
  readonly id: ProviderId;
  readonly supportsEphemeral: boolean;
  readonly notes?: string;
}

export interface Provider {
  readonly id: ProviderId;
  mint(input: MintInput): Promise<MintedSecret>;
  rotate(descriptor: SecretDescriptor): Promise<MintedSecret>;
  revoke(descriptor: SecretDescriptor): Promise<void>;
  /** Functional health probe with the new credential. MUST pass before revoke. */
  verify(descriptor: SecretDescriptor, secret: MintedSecret): Promise<boolean>;
  describe(): ProviderInfo;
}

export interface Store {
  readonly id: StoreId;
  /** Write the secret to its destination. The destination MUST already have passed the manifest
   *  allow-list check (assertAllowed) before this is called. */
  place(target: PlaceTarget, secret: MintedSecret): Promise<void>;
  /** Optional: finish a placement whose destination is not effective until an out-of-band step runs
   *  (ADR 0004). For Cloudflare Pages this triggers **and awaits** a redeploy so the placed env var
   *  actually goes live; the broker calls it (if present) after `place` and before `verify`. Stores
   *  whose writes are effective immediately (e.g. GitHub Actions) omit it. */
  activate?(target: PlaceTarget): Promise<void>;
}

/** Thrown by provider/store stubs whose live network path is not yet wired. Keeps the honest line
 *  between a real capability and a documented, not-yet-built one (no vaporware). */
export class NotWiredError extends Error {
  constructor(what: string) {
    super(`${what} is not wired yet — see the package's story in docs/stories/. secretsminter never ` +
      `pretends a capability exists before it is built.`);
    this.name = "NotWiredError";
  }
}
