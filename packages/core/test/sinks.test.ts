import { describe, expect, it } from "vitest";
import {
  FileAlertSink,
  MultiSink,
  NullAlertSink,
  type Alert,
  type AlertSink,
} from "../src/alert.js";
import {
  HashChainedAuditSink,
  verifyAuditChain,
  type AuditEntry,
  type ChainedEntry,
} from "../src/audit.js";
import { driftAlerts, reconcile } from "../src/drift.js";

function collectSink(): { sink: AlertSink; alerts: Alert[] } {
  const alerts: Alert[] = [];
  return { sink: { emit: (a) => alerts.push(a) }, alerts };
}

describe("alert sinks", () => {
  it("FileAlertSink writes one JSON line per alert", () => {
    const lines: string[] = [];
    const sink = new FileAlertSink((line) => lines.push(line));
    sink.emit({ level: "error", kind: "rotation-failed", at: 5, secretId: "sec_1" });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(lines[0] ?? "{}");
    expect(parsed).toMatchObject({ level: "error", kind: "rotation-failed", secretId: "sec_1" });
  });

  it("MultiSink fans out and survives a throwing sink", () => {
    const good = collectSink();
    const bad: AlertSink = {
      emit: () => {
        throw new Error("sink down");
      },
    };
    const multi = new MultiSink([bad, good.sink]);
    expect(() => multi.emit({ level: "info", kind: "x", at: 1 })).not.toThrow();
    expect(good.alerts).toHaveLength(1);
  });

  it("NullAlertSink discards", () => {
    expect(() => new NullAlertSink().emit({ level: "info", kind: "x", at: 1 })).not.toThrow();
  });

  it("FileAlertSink.toPath appends to the given path via the file appender", () => {
    const appended: Array<{ path: string; line: string }> = [];
    const sink = FileAlertSink.toPath("secretsminter.log", {
      append: (path, line) => appended.push({ path, line }),
    });
    sink.emit({ level: "warn", kind: "drift-detected", at: 7 });
    expect(appended).toHaveLength(1);
    expect(appended[0]?.path).toBe("secretsminter.log");
    expect(JSON.parse(appended[0]?.line ?? "{}")).toMatchObject({ kind: "drift-detected" });
  });
});

describe("hash-chained audit", () => {
  const entries = (
    outcomes: Array<AuditEntry["outcome"]>,
  ): ChainedEntry[] => {
    const out: ChainedEntry[] = [];
    const sink = new HashChainedAuditSink((line) => out.push(JSON.parse(line) as ChainedEntry));
    outcomes.forEach((outcome, i) =>
      sink.record({ action: "mint", provider: "cloudflare", secretId: `sec_${i}`, destination: "d", outcome, at: i }),
    );
    return out;
  };

  it("produces an intact, verifiable chain", () => {
    const chain = entries(["ok", "ok", "denied"]);
    expect(chain).toHaveLength(3);
    expect(verifyAuditChain(chain).ok).toBe(true);
  });

  it("detects a TAMPERED entry (outcome flipped after the fact)", () => {
    const chain = entries(["ok", "ok", "ok"]);
    const tampered = chain.map((e, i) => (i === 1 ? { ...e, outcome: "denied" as const } : e));
    const res = verifyAuditChain(tampered);
    expect(res.ok).toBe(false);
    expect(res.brokenAt).toBe(1);
  });

  it("detects a DELETED entry (chain link missing)", () => {
    const chain = entries(["ok", "ok", "ok"]);
    const withHole = [chain[0]!, chain[2]!]; // drop the middle entry
    expect(verifyAuditChain(withHole).ok).toBe(false);
  });
});

describe("drift reconciliation", () => {
  it("flags a credential that exists at the provider but is not managed", () => {
    const findings = reconcile(
      [{ provider: "cloudflare", id: "sec_a" }],
      [
        { provider: "cloudflare", externalRef: "token_a", managedId: "sec_a" },
        { provider: "cloudflare", externalRef: "token_rogue" }, // no managedId => out-of-band mint
      ],
    );
    expect(findings).toEqual([
      { kind: "unmanaged-at-provider", provider: "cloudflare", ref: "token_rogue" },
    ]);
  });

  it("flags a managed secret missing at the provider", () => {
    const findings = reconcile(
      [{ provider: "github", id: "sec_x" }],
      [],
    );
    expect(findings).toEqual([{ kind: "missing-at-provider", provider: "github", ref: "sec_x" }]);
  });

  it("is clean when both sides agree, and maps findings to warn alerts", () => {
    const managed = [{ provider: "cloudflare" as const, id: "sec_a" }];
    const atProvider = [{ provider: "cloudflare" as const, externalRef: "t", managedId: "sec_a" }];
    expect(reconcile(managed, atProvider)).toEqual([]);
    const alerts = driftAlerts(
      reconcile([{ provider: "cloudflare", id: "sec_gone" }], []),
      99,
    );
    expect(alerts[0]).toMatchObject({ level: "warn", kind: "drift-missing-at-provider", at: 99 });
  });
});
