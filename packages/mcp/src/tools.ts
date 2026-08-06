/**
 * The MCP tool catalog — narrow, pre-defined tools. There is deliberately NO generic "call this
 * API" tool, and NO tool that accepts a caller-supplied secret value (mint-only, docs/adrs/0001).
 *
 * Note what is NOT here: the kill switch and the approval mechanism are NOT tools. If the agent
 * could call them, a prompt-injected agent could self-approve or self-disable them. They live
 * out-of-band, on a separate channel (docs/adrs/0005).
 *
 * Every mutating tool defaults to a dry run: `apply` must be explicitly true, and even then the
 * action is gated by an out-of-band, action-hash-bound approval before the core executes it.
 */

export type ToolMutation = "read-only" | "mutating";

export interface ToolSpec {
  readonly name: string;
  readonly summary: string;
  readonly mutation: ToolMutation;
  /** For mutating tools: the action does nothing unless the caller passes apply:true AND an
   *  out-of-band approval matching the action hash is present. Dry-run is the default. */
  readonly defaultsToDryRun: boolean;
}

export const TOOLS: readonly ToolSpec[] = [
  {
    name: "list_secrets",
    summary: "Inventory of managed secrets (names, providers, destinations) — never values.",
    mutation: "read-only",
    defaultsToDryRun: false,
  },
  {
    name: "status",
    summary: "Health + drift: which secrets are fresh, due for rotation, or diverged from the manifest.",
    mutation: "read-only",
    defaultsToDryRun: false,
  },
  {
    name: "plan",
    summary: "Dry-run: what a mint/place/rotate would do, diffed against the signed manifest. DEFAULT.",
    mutation: "read-only",
    defaultsToDryRun: true,
  },
  {
    name: "mint_and_place",
    summary: "Mint a fresh secret and place it at an allow-listed destination. apply:true + approval.",
    mutation: "mutating",
    defaultsToDryRun: true,
  },
  {
    name: "rotate",
    summary: "Rotate a secret by id (mint -> place -> verify -> revoke). Refuses NEVER_ROTATE.",
    mutation: "mutating",
    defaultsToDryRun: true,
  },
  {
    name: "revoke",
    summary: "Revoke a secret by id. Refuses NEVER_ROTATE and broker-dependency (self-lockout).",
    mutation: "mutating",
    defaultsToDryRun: true,
  },
];

export const TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);
