/**
 * The secretsminter domain model.
 *
 * Design note: none of these types carry a secret *value*. Live material lives only in
 * {@link MintedSecret}, which never crosses the tool boundary (see value-blind.ts).
 */

export type ProviderId = "cloudflare" | "github" | "supabase" | "local";

export type SecretAction = "mint" | "place" | "rotate" | "revoke" | "verify" | "plan" | "status";

export type StoreId = "github-actions" | "cloudflare-pages" | "file";

/**
 * The *class* of a secret is orthogonal to its name. NEVER_ROTATE is enforced by name AND by
 * class — because a signing key minted under a fresh name would evade a name-only denylist
 * (see docs/adrs/0010-rotation-safety.md).
 */
export type SecretClass =
  | "api-token" // e.g. a Cloudflare R2 API token
  | "ephemeral-cred" // short-lived, self-expiring (R2 Temporary Credentials, GH installation token)
  | "jwt-signing-key" // rotatable asymmetric signing key (e.g. Supabase): create -> activate -> revoke
  | "app-secret" // symmetric app/HMAC secret minted locally, e.g. a download-signing secret; rotatable
  | "updater-signing-key"; // crown jewel: public half baked into shipped builds. NEVER rotate.

/**
 * Where a minted secret is written. Free-form target args are NEVER trusted: a target is only
 * valid if it matches the signed manifest allow-list (see allowlist.ts, docs/adrs/0008).
 */
export interface PlaceTarget {
  readonly store: StoreId;
  readonly repo?: string; // github: "owner/name"
  readonly project?: string; // cloudflare pages / supabase project ref
  readonly environment?: string;
  readonly name: string; // the secret's name at the destination
}

export interface SecretDescriptor {
  readonly id: string;
  readonly name: string;
  readonly provider: ProviderId;
  readonly secretClass: SecretClass;
  readonly target: PlaceTarget;
  readonly scopes: readonly string[];
}

/**
 * The ONLY shape a tool ever returns to the agent. A positive whitelist: it cannot leak a field
 * (like a secret value) that a provider response happened to include. See value-blind.ts.
 */
export interface ToolResult {
  readonly ok: boolean;
  readonly provider: ProviderId | null;
  readonly action: SecretAction;
  readonly secret_id: string;
  readonly placed_at: string | null;
}
