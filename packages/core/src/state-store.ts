/**
 * Durable broker state (story: durable-state-store).
 *
 * For "give it the token once and walk away," the broker must survive a restart: it has to remember
 * *which secrets it manages* and *their rotation schedule*, or a restart forgets everything and the
 * self-maintaining loop stops. This is that persistence.
 *
 * **The persisted state is value-free by construction** — it is descriptors (names, providers,
 * destinations, ids) and schedule times. It contains **no secret material**, so writing it to disk
 * does not violate value-blindness. (Live credential material lives only in a `SecretValue` in memory
 * and is never part of the state.)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { SecretDescriptor } from "./types.js";

export interface ScheduleEntry {
  readonly id: string;
  readonly cadenceMs: number;
  readonly nextAt: number;
}

export interface BrokerState {
  readonly secrets: readonly SecretDescriptor[];
  readonly schedule: readonly ScheduleEntry[];
}

export interface StateStore {
  /** Return the last saved state, or null if none / unreadable / malformed (start fresh). */
  load(): BrokerState | null;
  save(state: BrokerState): void;
}

/** Non-durable default: state lives only in memory, lost on restart. For tests + the demo server. */
export class InMemoryStateStore implements StateStore {
  #state: BrokerState | null = null;
  load(): BrokerState | null {
    return this.#state;
  }
  save(state: BrokerState): void {
    this.#state = state;
  }
}

function isBrokerState(v: unknown): v is BrokerState {
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray((v as BrokerState).secrets) &&
    Array.isArray((v as BrokerState).schedule)
  );
}

/** Minimal filesystem seam so the file store stays unit-testable without touching disk. */
export interface StateFs {
  /** File contents, or null if it does not exist. Throws on a real I/O error. */
  read(path: string): string | null;
  write(path: string, contents: string): void;
}

export const defaultStateFs: StateFs = {
  read: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
  write: (p, c) => writeFileSync(p, c, "utf8"),
};

/**
 * Durable state as a JSON file. Load is defensive — a missing, unreadable, unparseable, or
 * shape-invalid file yields `null` (the broker starts fresh) rather than crashing.
 */
export class FileStateStore implements StateStore {
  readonly #path: string;
  readonly #fs: StateFs;

  constructor(path: string, fs: StateFs = defaultStateFs) {
    this.#path = path;
    this.#fs = fs;
  }

  load(): BrokerState | null {
    let raw: string | null;
    try {
      raw = this.#fs.read(this.#path);
    } catch {
      return null;
    }
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isBrokerState(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  save(state: BrokerState): void {
    this.#fs.write(this.#path, JSON.stringify(state, null, 2));
  }
}
