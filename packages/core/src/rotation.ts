/**
 * The rotation state machine (docs/adrs/0010).
 *
 * Rotation is explicit, persisted, and resumable — never a fire-and-forget call. The ordering is
 * the safety property: the OLD credential is retained until the NEW one is functionally VERIFIED,
 * and revoke is only reachable from VERIFIED. There is no transition that revokes before verify, so
 * "verify-before-revoke" is structural, not a convention a caller might forget.
 *
 *   PENDING -> MINTED -> PLACED -> VERIFIED -> REVOKED -> DONE
 *
 * `fail` drops any non-terminal state to FAILED (the old credential is left working). A dual-
 * credential overlap window and a minimum rotation interval live in the scheduler, not here.
 */

export type RotationState =
  | "PENDING"
  | "MINTED"
  | "PLACED"
  | "VERIFIED"
  | "REVOKED"
  | "DONE"
  | "FAILED";

export type RotationEvent = "mint" | "place" | "verify" | "revoke" | "complete" | "fail";

const TRANSITIONS: Readonly<Record<RotationState, Partial<Record<RotationEvent, RotationState>>>> = {
  PENDING: { mint: "MINTED", fail: "FAILED" },
  MINTED: { place: "PLACED", fail: "FAILED" },
  PLACED: { verify: "VERIFIED", fail: "FAILED" },
  VERIFIED: { revoke: "REVOKED", fail: "FAILED" },
  REVOKED: { complete: "DONE" },
  DONE: {},
  FAILED: {},
};

export const TERMINAL_STATES: ReadonlySet<RotationState> = new Set<RotationState>(["DONE", "FAILED"]);

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: RotationState,
    public readonly event: RotationEvent,
  ) {
    super(`illegal rotation transition: ${from} -/-> (${event})`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition(from: RotationState, event: RotationEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

export function nextState(from: RotationState, event: RotationEvent): RotationState {
  const to = TRANSITIONS[from][event];
  if (to === undefined) throw new IllegalTransitionError(from, event);
  return to;
}

export function isTerminal(state: RotationState): boolean {
  return TERMINAL_STATES.has(state);
}
