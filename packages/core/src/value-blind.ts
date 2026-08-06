/**
 * Value-blindness as a MECHANISM, not an outcome (docs/adrs/0001).
 *
 * Every mint pulls a raw secret value into core memory. Value-blindness is the discipline at the
 * serialization boundary that keeps it there. Two enforced primitives:
 *
 *   1. whitelistSerialize — a POSITIVE projection onto the allowed fields. A blacklist copy would
 *      leak any newly-added provider field; a whitelist cannot.
 *   2. scrub — a redaction pass over every error string and log line, masking any live secret
 *      material that slipped into a message (the classic leak channel is an error that inlines
 *      provider stderr or a command's argv).
 *
 * Reminder (docs/adrs/0001): value-blindness stops the agent *reading* a secret. It does NOT stop
 * a prompt-injected agent *directing* a live secret to an attacker — that is the allow-list's job
 * (allowlist.ts). Both layers are required.
 */

import { exposeMaterial, type SecretValue } from "./secret-value.js";
import type { SecretAction, ToolResult } from "./types.js";

export const TOOL_RESULT_FIELDS = ["ok", "provider", "action", "secret_id", "placed_at"] as const;

/** The closed set of actions a ToolResult may report. Validated on the way out (positive whitelist). */
export const TOOL_ACTIONS: ReadonlySet<SecretAction> = new Set<SecretAction>([
  "mint",
  "place",
  "rotate",
  "revoke",
  "verify",
  "plan",
  "status",
]);

export const REDACTED = "[REDACTED]";

/** Minimum length of material we will actively mask, to avoid over-redacting short common strings. */
export const MIN_SCRUB_LENGTH = 6;

/**
 * Project an arbitrary result object onto the strict {@link ToolResult} whitelist. Any extra field
 * — notably a leaked `value` / `token` / `secretAccessKey` — is dropped, because we build the
 * output field-by-field rather than copying-then-deleting.
 */
export function whitelistSerialize(raw: Record<string, unknown>): ToolResult {
  const provider = raw["provider"];
  const action = raw["action"];
  const placedAt = raw["placed_at"];
  return {
    ok: raw["ok"] === true,
    provider:
      provider === "cloudflare" || provider === "github" || provider === "supabase" || provider === "local"
        ? provider
        : null,
    // Positive whitelist for the enum too: an unrecognized action never passes through — it falls
    // back to the read-only "status" rather than being emitted verbatim.
    action:
      typeof action === "string" && TOOL_ACTIONS.has(action as SecretAction)
        ? (action as SecretAction)
        : "status",
    secret_id: typeof raw["secret_id"] === "string" ? raw["secret_id"] : "",
    placed_at: typeof placedAt === "string" ? placedAt : null,
  };
}

/**
 * Mask any occurrence of known secret material in a string (error messages, log lines). Idempotent,
 * order-independent; ignores empty/short material so it never over-masks. Belt-and-suspenders on top
 * of {@link whitelistSerialize}: even if a raw value reaches a log/error path, it is redacted here.
 *
 * Accepts {@link SecretValue} wrappers directly, so callers can pass a minted secret's material
 * without hand-exposing it. Limitation (documented, not a bug): scrub masks EXACT occurrences only —
 * a value that a provider transformed (URL-encoded, base64'd) before putting it in a message will not
 * match. Value-blindness does not rely on scrub alone; the whitelist + SecretValue wrapper are the
 * primary defenses and scrub is the backstop.
 */
export function scrub(text: string, material: readonly (string | SecretValue)[]): string {
  let out = text;
  for (const item of material) {
    const m = exposeMaterial(item);
    if (m.length < MIN_SCRUB_LENGTH) continue;
    out = out.split(m).join(REDACTED);
  }
  return out;
}

/**
 * Scrub an unknown thrown value into a safe, value-free message string, following the `cause` chain
 * (a provider client often wraps the underlying error — which may inline a token — as `cause`). The
 * `.stack` is deliberately NOT included: callers must log this returned string, never `err.stack`.
 */
export function scrubError(err: unknown, material: readonly (string | SecretValue)[]): string {
  const parts: string[] = [];
  let current: unknown = err;
  let depth = 0;
  while (current !== undefined && current !== null && depth < 8) {
    parts.push(current instanceof Error ? current.message : String(current));
    current = current instanceof Error ? (current.cause as unknown) : undefined;
    depth += 1;
  }
  return scrub(parts.join(": "), material);
}
