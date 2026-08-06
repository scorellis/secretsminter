/**
 * Daemon configuration — all from the environment (12-factor). No secrets live here; the bootstrap
 * credentials for providers are read from their own `SECRETSMINTER_<VENDOR>_*` vars at assembly time and
 * are expected to be injected by a secret manager / workload identity in production.
 */

export interface DaemonConfig {
  /** Signed manifest (the trust root). All three are needed to enforce a real allow-list. */
  readonly manifestPath?: string | undefined;
  readonly manifestSigPath?: string | undefined;
  readonly manifestPublicKeyPath?: string | undefined;
  /** Durable, value-free broker state. If unset, state is in-memory (lost on restart). */
  readonly statePath?: string | undefined;
  /** Out-of-band fail-closed kill switch file. If unset, the switch is never engaged. */
  readonly killSwitchPath?: string | undefined;
  /** Out-of-band approval store. If unset, approvals default-deny (nothing mutating runs). */
  readonly approvalsPath?: string | undefined;
  /** Append-only JSONL alert log. If unset, alerts are discarded. */
  readonly alertLogPath?: string | undefined;
  /** Append-only hash-chained audit log. If unset, no audit is written. */
  readonly auditLogPath?: string | undefined;
  /** How often the rotation loop ticks. */
  readonly rotationIntervalMs: number;
}

function str(v: string | undefined): string | undefined {
  return v && v.length > 0 ? v : undefined;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): DaemonConfig {
  const interval = Number(env["SECRETSMINTER_ROTATION_INTERVAL_MS"]);
  return {
    manifestPath: str(env["SECRETSMINTER_MANIFEST"]),
    manifestSigPath: str(env["SECRETSMINTER_MANIFEST_SIG"]),
    manifestPublicKeyPath: str(env["SECRETSMINTER_MANIFEST_PUBKEY"]),
    statePath: str(env["SECRETSMINTER_STATE"]),
    killSwitchPath: str(env["SECRETSMINTER_KILL_SWITCH"]),
    approvalsPath: str(env["SECRETSMINTER_APPROVALS"]),
    alertLogPath: str(env["SECRETSMINTER_ALERT_LOG"]),
    auditLogPath: str(env["SECRETSMINTER_AUDIT_LOG"]),
    rotationIntervalMs: Number.isFinite(interval) && interval > 0 ? interval : 60_000,
  };
}
