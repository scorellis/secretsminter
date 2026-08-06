import { describe, expect, it } from "vitest";
import { FileApprovalGate } from "../src/file-approval.js";
import { actionHash } from "../src/approval.js";
import {
  AlwaysEngagedKillSwitch,
  FileKillSwitch,
  NeverEngagedKillSwitch,
  type FileReader,
} from "../src/kill-switch.js";

/** A fake filesystem: a map of path -> contents; a path mapped to a thrown marker simulates I/O error. */
function fakeFs(files: Record<string, string | "THROW">): FileReader {
  return {
    exists: (p) => p in files,
    read: (p) => {
      const v = files[p];
      if (v === "THROW") throw new Error("EACCES: simulated unreadable file");
      return v ?? "";
    },
  };
}

describe("KillSwitch", () => {
  it("NeverEngaged / AlwaysEngaged behave as named", () => {
    expect(new NeverEngagedKillSwitch().engaged()).toBe(false);
    expect(new AlwaysEngagedKillSwitch().engaged()).toBe(true);
  });

  it("FileKillSwitch: present + non-empty => engaged", () => {
    const ks = FileKillSwitch.fromPath("/kill", fakeFs({ "/kill": "HALT" }));
    expect(ks.engaged()).toBe(true);
  });

  it("FileKillSwitch: absent => not engaged", () => {
    const ks = FileKillSwitch.fromPath("/kill", fakeFs({}));
    expect(ks.engaged()).toBe(false);
  });

  it("FileKillSwitch: empty/whitespace file => not engaged", () => {
    const ks = FileKillSwitch.fromPath("/kill", fakeFs({ "/kill": "   \n" }));
    expect(ks.engaged()).toBe(false);
  });

  it("FileKillSwitch is FAIL-CLOSED: unreadable state => engaged", () => {
    const ks = FileKillSwitch.fromPath("/kill", fakeFs({ "/kill": "THROW" }));
    expect(ks.engaged()).toBe(true);
  });
});

describe("FileApprovalGate (out-of-band)", () => {
  const now = 1_000_000;
  const hash = actionHash({ action: "mint", provider: "cloudflare" });

  it("approves an unexpired entry matching the action hash", () => {
    const store = JSON.stringify([{ actionHash: hash, expiresAtEpochMs: now + 60_000 }]);
    const gate = FileApprovalGate.fromPath("/approvals", fakeFs({ "/approvals": store }));
    expect(gate.check(hash, now)).toBe(true);
  });

  it("denies an expired entry", () => {
    const store = JSON.stringify([{ actionHash: hash, expiresAtEpochMs: now - 1 }]);
    const gate = FileApprovalGate.fromPath("/approvals", fakeFs({ "/approvals": store }));
    expect(gate.check(hash, now)).toBe(false);
  });

  it("denies a different action hash (no replay for another action)", () => {
    const store = JSON.stringify([{ actionHash: "some-other-hash", expiresAtEpochMs: now + 60_000 }]);
    const gate = FileApprovalGate.fromPath("/approvals", fakeFs({ "/approvals": store }));
    expect(gate.check(hash, now)).toBe(false);
  });

  it("default-denies when the store is missing, unparseable, or unreadable", () => {
    expect(FileApprovalGate.fromPath("/x", fakeFs({})).check(hash, now)).toBe(false);
    expect(FileApprovalGate.fromPath("/x", fakeFs({ "/x": "not json" })).check(hash, now)).toBe(false);
    expect(FileApprovalGate.fromPath("/x", fakeFs({ "/x": "THROW" })).check(hash, now)).toBe(false);
  });
});
