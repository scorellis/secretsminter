/**
 * The kill switch (docs/adrs/0005).
 *
 * An out-of-band, agent-unreachable halt for ALL mutating operations. It is deliberately NOT an MCP
 * tool — if the agent could toggle it, a prompt-injected agent would disable it. An operator engages
 * it out-of-band (writing a file, an admin endpoint with separate auth).
 *
 * It is **fail-closed**: if the switch's state cannot be read, the system assumes ENGAGED and refuses
 * to mint. "I'm not sure whether I'm allowed to act" must resolve to "don't act," never "go ahead."
 */

import { existsSync, readFileSync } from "node:fs";

export interface KillSwitch {
  /** True means: halt. Every mutating broker op and the scheduler must refuse while this is true. */
  engaged(): boolean;
}

export class KillSwitchEngagedError extends Error {
  constructor() {
    super("refused: the kill switch is engaged (all mutating operations halted)");
    this.name = "KillSwitchEngagedError";
  }
}

/** The default for local/demo use: never engaged. Production MUST configure a real one. */
export class NeverEngagedKillSwitch implements KillSwitch {
  engaged(): boolean {
    return false;
  }
}

/** Always halts — useful in tests and as an explicit "hard stop" configuration. */
export class AlwaysEngagedKillSwitch implements KillSwitch {
  engaged(): boolean {
    return true;
  }
}

/**
 * Reads kill-state from an out-of-band source via an injected reader. The reader returns the source's
 * contents, `null` if the source is absent, or THROWS if it exists but cannot be read.
 *
 * Semantics (fail-closed):
 *   - source present and non-empty        -> ENGAGED
 *   - source absent (`null`)              -> not engaged (the operator has not engaged it)
 *   - reader throws (unreadable/error)    -> ENGAGED (we cannot confirm it is safe to act)
 */
export class FileKillSwitch implements KillSwitch {
  readonly #read: () => string | null;

  constructor(read: () => string | null) {
    this.#read = read;
  }

  engaged(): boolean {
    try {
      const contents = this.#read();
      if (contents === null) return false;
      return contents.trim().length > 0;
    } catch {
      return true; // fail-closed: unreadable state means halt
    }
  }

  /** Build one backed by a file at `path`. Present + non-empty => engaged; missing => not engaged;
   *  a read error (permissions, I/O) => engaged (fail-closed). */
  static fromPath(path: string, fs: FileReader = defaultFileReader): FileKillSwitch {
    return new FileKillSwitch(() => (fs.exists(path) ? fs.read(path) : null));
  }
}

/** Minimal filesystem seam so the file-backed switch/gate stay unit-testable without touching disk. */
export interface FileReader {
  exists(path: string): boolean;
  /** Read the file; throw on I/O error (that throw is what makes the kill switch fail closed). */
  read(path: string): string;
}

export const defaultFileReader: FileReader = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, "utf8"),
};
