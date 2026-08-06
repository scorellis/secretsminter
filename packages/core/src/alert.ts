/**
 * Alert sinks (story 0008).
 *
 * A **sink** is a pluggable destination for a stream of records — the same idea logging libraries call
 * an appender / transport / handler. Code that emits an alert doesn't care where it goes; the operator
 * injects the sink. Alerts are the *attention-worthy* subset of events (a rotation failed, a
 * high-privilege mint happened, drift was detected) — distinct from the full audit trail (audit.ts).
 *
 * **Alerts are value-free.** They carry a level, a kind, a timestamp, ids, a destination label, and a
 * safe reason CODE — never a secret value. Same discipline as everything else in secretsminter.
 *
 * Operational note: `FileAlertSink` appends JSON-lines to a file (e.g. `secretsminter.log`). It is
 * append-only and never rotated by secretsminter itself — an operator truncates/rotates it. See AGENTS.md.
 */

import { appendFileSync } from "node:fs";
import type { ProviderId } from "./types.js";

export type AlertLevel = "info" | "warn" | "error";

export interface Alert {
  readonly level: AlertLevel;
  readonly kind: string;
  readonly at: number;
  readonly provider?: ProviderId | null;
  readonly secretId?: string;
  readonly destination?: string;
  readonly reason?: string;
}

export interface AlertSink {
  emit(alert: Alert): void;
}

/** The default: discard. secretsminter emits nothing unless an operator wires a real sink. */
export class NullAlertSink implements AlertSink {
  emit(): void {
    /* discard */
  }
}

/** Writes each alert to stderr as a JSON line (stdout is reserved for MCP protocol traffic). */
export class ConsoleAlertSink implements AlertSink {
  emit(alert: Alert): void {
    process.stderr.write(JSON.stringify(alert) + "\n");
  }
}

/** Minimal append seam so the file sink stays unit-testable without touching disk. */
export interface FileAppender {
  append(path: string, line: string): void;
}

export const defaultFileAppender: FileAppender = {
  append: (path, line) => appendFileSync(path, line),
};

/** Appends each alert to a file as a JSON line (JSONL). Append-only; rotation is the operator's job. */
export class FileAlertSink implements AlertSink {
  readonly #write: (line: string) => void;

  constructor(write: (line: string) => void) {
    this.#write = write;
  }

  emit(alert: Alert): void {
    this.#write(JSON.stringify(alert) + "\n");
  }

  /** Build one that appends to `path` (e.g. "secretsminter.log"). */
  static toPath(path: string, fs: FileAppender = defaultFileAppender): FileAlertSink {
    return new FileAlertSink((line) => fs.append(path, line));
  }
}

/** Fans out to several sinks. A sink that throws does not stop the others. */
export class MultiSink implements AlertSink {
  readonly #sinks: readonly AlertSink[];

  constructor(sinks: readonly AlertSink[]) {
    this.#sinks = sinks;
  }

  emit(alert: Alert): void {
    for (const sink of this.#sinks) {
      try {
        sink.emit(alert);
      } catch {
        /* one bad sink must not break the rest */
      }
    }
  }
}
