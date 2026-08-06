/**
 * The audit trail (docs/adrs/0011, story 0008).
 *
 * The full, value-free record of every action the broker takes. Two properties make it trustworthy:
 *
 *   - **Value-free.** An entry records the action, provider, secret id, destination, and outcome —
 *     never a secret value. (For correlation without values, an entry may carry an HMAC fingerprint,
 *     produced by `auditFingerprint` in crypto.ts.)
 *   - **Hash-chained (interior-tamper-evident).** Each entry's hash covers the previous entry's hash, so
 *     editing or deleting an *interior* entry breaks the chain and `verifyAuditChain` reports exactly
 *     where. **Honest limit:** the chain is currently **unkeyed** (a plain SHA-256) and its genesis is a
 *     public constant, so **tail-truncation and a wholesale rewrite from genesis are NOT detected** by
 *     `verifyAuditChain` alone — an attacker who can rewrite the file can recompute a shorter valid
 *     chain. That gap is mitigated operationally by writing the chain to an **external append-only store
 *     with separate credentials** (a broker compromise can't reach it), not by the hash alone. Making the
 *     chain self-defending — an **HMAC keyed by a separate secret plus a pinned head/length** in
 *     `verifyAuditChain` — is a roadmap item (story 0017).
 */

import { createHash } from "node:crypto";
import type { ProviderId, SecretAction } from "./types.js";

export interface AuditEntry {
  readonly action: SecretAction;
  readonly provider: ProviderId | null;
  readonly secretId: string;
  readonly destination: string;
  readonly outcome: "ok" | "denied" | "error";
  readonly at: number;
}

export interface AuditSink {
  record(entry: AuditEntry): void;
}

export interface ChainedEntry extends AuditEntry {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

export const GENESIS_HASH = "GENESIS";

function canonical(e: AuditEntry): string {
  return JSON.stringify([e.action, e.provider, e.secretId, e.destination, e.outcome, e.at]);
}

function chainHash(prevHash: string, seq: number, entry: AuditEntry): string {
  return createHash("sha256")
    .update(`${prevHash}|${seq}|${canonical(entry)}`, "utf8")
    .digest("hex");
}

/** An {@link AuditSink} that chains each entry to the previous one and writes it as a JSON line. */
export class HashChainedAuditSink implements AuditSink {
  #prevHash: string;
  #seq = 0;
  readonly #write: (line: string) => void;

  constructor(write: (line: string) => void, genesisHash: string = GENESIS_HASH) {
    this.#write = write;
    this.#prevHash = genesisHash;
  }

  record(entry: AuditEntry): void {
    const seq = this.#seq;
    const hash = chainHash(this.#prevHash, seq, entry);
    const chained: ChainedEntry = { ...entry, seq, prevHash: this.#prevHash, hash };
    this.#write(JSON.stringify(chained) + "\n");
    this.#prevHash = hash;
    this.#seq += 1;
  }
}

/** Recompute the chain and report whether it is intact, and if not, the index where it first breaks. */
export function verifyAuditChain(
  entries: readonly ChainedEntry[],
  genesisHash: string = GENESIS_HASH,
): { ok: boolean; brokenAt?: number } {
  let prev = genesisHash;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (e === undefined) return { ok: false, brokenAt: i };
    if (e.prevHash !== prev) return { ok: false, brokenAt: i };
    if (e.hash !== chainHash(prev, e.seq, e)) return { ok: false, brokenAt: i };
    prev = e.hash;
  }
  return { ok: true };
}
