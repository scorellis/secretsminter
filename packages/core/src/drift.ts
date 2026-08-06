/**
 * Drift reconciliation (docs/adrs/0011, story 0008).
 *
 * Periodically compares what the broker *manages* against what actually *exists* at the providers. A
 * credential that exists at a provider but maps to nothing the broker manages is the signal that
 * matters most: an out-of-band mint, a leaked bootstrap credential, or a compromise. The reverse — a
 * managed secret missing at the provider — signals an out-of-band deletion.
 *
 * This is pure comparison logic. Fetching the provider-side inventory is the live provider's job
 * (stories 0003-0005); `reconcile` takes both sides as data so it is fully testable without network.
 */

import type { Alert } from "./alert.js";
import type { ProviderId } from "./types.js";

export interface ManagedRef {
  readonly provider: ProviderId;
  readonly id: string;
}

export interface ProviderRef {
  readonly provider: ProviderId;
  readonly externalRef: string;
  /** The managed id this provider-side credential maps to, if any. Absent => not managed by us. */
  readonly managedId?: string;
}

export type DriftKind = "unmanaged-at-provider" | "missing-at-provider";

export interface DriftFinding {
  readonly kind: DriftKind;
  readonly provider: ProviderId;
  readonly ref: string;
}

/** Compare the managed set against the provider-side inventory and return every divergence. */
export function reconcile(
  managed: readonly ManagedRef[],
  atProvider: readonly ProviderRef[],
): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const managedIds = new Set(managed.map((m) => m.id));
  const matched = new Set<string>();

  for (const p of atProvider) {
    if (p.managedId !== undefined && managedIds.has(p.managedId)) {
      matched.add(p.managedId);
    } else {
      findings.push({ kind: "unmanaged-at-provider", provider: p.provider, ref: p.externalRef });
    }
  }
  for (const m of managed) {
    if (!matched.has(m.id)) {
      findings.push({ kind: "missing-at-provider", provider: m.provider, ref: m.id });
    }
  }
  return findings;
}

/** Turn drift findings into warn-level alerts to emit on an {@link AlertSink}. */
export function driftAlerts(findings: readonly DriftFinding[], at: number): Alert[] {
  return findings.map((f) => ({
    level: "warn" as const,
    kind: `drift-${f.kind}`,
    at,
    provider: f.provider,
    destination: f.ref,
  }));
}
