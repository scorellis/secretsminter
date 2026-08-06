/**
 * A file-backed, out-of-band {@link ApprovalGate} (docs/adrs/0005, story 0007).
 *
 * An operator approves an action by writing an entry — an action hash + an expiry — into a store the
 * broker reads. The agent has NO tool that writes this store, which is exactly what makes approval
 * out-of-band: a prompt-injected agent cannot approve its own action. Default-deny throughout: a
 * missing store, an unparseable store, an unknown hash, or an expired entry all mean "not approved."
 */

import type { ApprovalGate } from "./approval.js";
import { defaultFileReader, type FileReader } from "./kill-switch.js";

interface StoredApproval {
  readonly actionHash: string;
  readonly expiresAtEpochMs: number;
}

function isStoredApproval(e: unknown): e is StoredApproval {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as StoredApproval).actionHash === "string" &&
    typeof (e as StoredApproval).expiresAtEpochMs === "number"
  );
}

export class FileApprovalGate implements ApprovalGate {
  readonly #read: () => string | null;

  constructor(read: () => string | null) {
    this.#read = read;
  }

  check(hash: string, nowEpochMs: number): boolean {
    let raw: string | null;
    try {
      raw = this.#read();
    } catch {
      return false; // deny on read error
    }
    if (raw === null) return false; // no approvals store => nothing approved
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false; // deny on unparseable store
    }
    if (!Array.isArray(parsed)) return false;
    return parsed.some(
      (e) => isStoredApproval(e) && e.actionHash === hash && nowEpochMs < e.expiresAtEpochMs,
    );
  }

  /** Build one backed by a JSON file at `path` (an array of `{ actionHash, expiresAtEpochMs }`). */
  static fromPath(path: string, fs: FileReader = defaultFileReader): FileApprovalGate {
    return new FileApprovalGate(() => (fs.exists(path) ? fs.read(path) : null));
  }
}
