import { describe, expect, it } from "vitest";
import {
  canTransition,
  IllegalTransitionError,
  isTerminal,
  nextState,
  type RotationState,
} from "../src/rotation.js";

describe("rotation state machine", () => {
  it("walks the full happy path PENDING -> DONE", () => {
    let s: RotationState = "PENDING";
    s = nextState(s, "mint");
    expect(s).toBe("MINTED");
    s = nextState(s, "place");
    expect(s).toBe("PLACED");
    s = nextState(s, "verify");
    expect(s).toBe("VERIFIED");
    s = nextState(s, "revoke");
    expect(s).toBe("REVOKED");
    s = nextState(s, "complete");
    expect(s).toBe("DONE");
    expect(isTerminal(s)).toBe(true);
  });

  it("STRUCTURALLY forbids revoke-before-verify (the old cred stays until verified)", () => {
    expect(canTransition("PLACED", "revoke")).toBe(false);
    expect(() => nextState("PLACED", "revoke")).toThrow(IllegalTransitionError);
    // revoke is only reachable from VERIFIED:
    expect(canTransition("VERIFIED", "revoke")).toBe(true);
  });

  it("can fail from any non-terminal step, leaving the old credential working", () => {
    for (const s of ["PENDING", "MINTED", "PLACED", "VERIFIED"] as RotationState[]) {
      expect(nextState(s, "fail")).toBe("FAILED");
    }
  });

  it("terminal states accept no further transitions", () => {
    expect(() => nextState("DONE", "mint")).toThrow(IllegalTransitionError);
    expect(() => nextState("FAILED", "mint")).toThrow(IllegalTransitionError);
    expect(isTerminal("REVOKED")).toBe(false);
  });
});
