import { describe, expect, it } from "vitest";
import { verifyAndLoadManifest } from "@secretsminter/core";
import {
  DEFAULT_DIR,
  dirPaths,
  parseAllowArgs,
  parseInitArgs,
  runAllow,
  runInit,
  SetupError,
  type SetupFs,
} from "../src/init.js";

/** An in-memory filesystem so tests never hit disk timing or real fs. */
function memFs(seed: Record<string, string> = {}): SetupFs & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>();
  return {
    files,
    exists: (p) => files.has(p) || dirs.has(p),
    mkdir: (p) => {
      dirs.add(p);
    },
    writeFile: (p, data) => {
      files.set(p, data);
    },
    readFile: (p) => (files.has(p) ? (files.get(p) as string) : null),
  };
}

const DIR = "/cfg";

describe("runInit", () => {
  it("writes the full file set and a signature that verifies", () => {
    const fs = memFs();
    const p = dirPaths(DIR);
    const result = runInit(fs, DIR);

    // All five files present.
    for (const f of [p.key, p.pub, p.manifest, p.sig, p.approvals]) {
      expect(fs.files.has(f)).toBe(true);
    }
    expect(result.written).toEqual([p.key, p.pub, p.manifest, p.sig, p.approvals]);

    // The manifest is empty + default-deny.
    const manifest = JSON.parse(fs.files.get(p.manifest) as string);
    expect(manifest).toEqual({ version: 1, allow: [] });
    expect(fs.files.get(p.approvals)).toBe("[]\n");

    // The signature verifies against the written public key.
    const m = verifyAndLoadManifest(
      fs.files.get(p.manifest) as string,
      fs.files.get(p.sig) as string,
      fs.files.get(p.pub) as string,
    );
    expect(m.allow).toEqual([]);

    // Key material is PEM and never appears in the returned result.
    expect(fs.files.get(p.key)).toContain("PRIVATE KEY");
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
  });

  it("prints the exact env exports pointed into the dir (stderr channel)", () => {
    const fs = memFs();
    const p = dirPaths(DIR);
    const { envExports } = runInit(fs, DIR);
    expect(envExports).toEqual([
      `export SECRETSMINTER_MANIFEST=${p.manifest}`,
      `export SECRETSMINTER_MANIFEST_SIG=${p.sig}`,
      `export SECRETSMINTER_MANIFEST_PUBKEY=${p.pub}`,
      `export SECRETSMINTER_APPROVALS=${p.approvals}`,
      `export SECRETSMINTER_STATE=${p.state}`,
      `export SECRETSMINTER_AUDIT_LOG=${p.audit}`,
    ]);
    expect(envExports).toHaveLength(6);
  });

  it("REFUSES to clobber an existing signing key (non-zero via thrown SetupError)", () => {
    const p = dirPaths(DIR);
    const fs = memFs({ [p.key]: "-----BEGIN PRIVATE KEY-----\nexisting\n-----END PRIVATE KEY-----\n" });
    expect(() => runInit(fs, DIR)).toThrow(SetupError);
    // The pre-existing key is untouched.
    expect(fs.files.get(p.key)).toContain("existing");
  });
});

describe("runAllow", () => {
  it("appends a destination, re-signs, and the manifest still verifies", () => {
    const fs = memFs();
    const p = dirPaths(DIR);
    runInit(fs, DIR);

    const result = runAllow(fs, DIR, { store: "github-actions", repo: "acme/api", namePattern: "R2_*" });
    expect(result.allow).toHaveLength(1);
    expect(result.allow[0]).toEqual({ store: "github-actions", repo: "acme/api", namePattern: "R2_*" });

    const m = verifyAndLoadManifest(
      fs.files.get(p.manifest) as string,
      fs.files.get(p.sig) as string,
      fs.files.get(p.pub) as string,
    );
    expect(m.allow).toHaveLength(1);
    expect(m.allow[0]?.repo).toBe("acme/api");
  });

  it("maps --env to environment and --name to namePattern, omitting absent fields", () => {
    const fs = memFs();
    runInit(fs, DIR);
    const { allow } = runAllow(fs, DIR, { store: "cloudflare-pages", project: "site", environment: "production" });
    expect(allow[0]).toEqual({ store: "cloudflare-pages", project: "site", environment: "production" });
    // No stray repo/namePattern keys.
    expect(Object.keys(allow[0] as object).sort()).toEqual(["environment", "project", "store"]);
  });

  it("appends across multiple calls, each re-signed and verifying", () => {
    const fs = memFs();
    const p = dirPaths(DIR);
    runInit(fs, DIR);
    runAllow(fs, DIR, { store: "github-actions", repo: "a/b" });
    const second = runAllow(fs, DIR, { store: "file", namePattern: "TOK_*" });
    expect(second.allow).toHaveLength(2);
    const m = verifyAndLoadManifest(
      fs.files.get(p.manifest) as string,
      fs.files.get(p.sig) as string,
      fs.files.get(p.pub) as string,
    );
    expect(m.allow).toHaveLength(2);
  });

  it("errors clearly on a non-init'd dir (no manifest)", () => {
    const fs = memFs();
    expect(() => runAllow(fs, DIR, { store: "github-actions" })).toThrow(/not initialized/);
  });

  it("errors clearly when the manifest exists but the signing key is missing", () => {
    const p = dirPaths(DIR);
    const fs = memFs({ [p.manifest]: JSON.stringify({ version: 1, allow: [] }) });
    expect(() => runAllow(fs, DIR, { store: "github-actions" })).toThrow(/not initialized/);
  });

  it("rejects an unknown --store", () => {
    const fs = memFs();
    runInit(fs, DIR);
    expect(() => runAllow(fs, DIR, { store: "s3-direct" })).toThrow(/unknown --store/);
  });

  it("preserves existing optional manifest fields (neverRotate) across a re-sign", () => {
    const fs = memFs();
    const p = dirPaths(DIR);
    runInit(fs, DIR);
    // Hand-edit the manifest to add neverRotate, then re-sign via runInit? Instead, simulate an
    // operator-provided manifest by writing one and its key back is the same init key.
    const withNever = JSON.stringify({ version: 1, allow: [], neverRotate: ["deploy-key"] });
    fs.writeFile(p.manifest, withNever);
    // Re-sign is not needed for runAllow's read (it parses, then re-signs the updated result).
    const { allow } = runAllow(fs, DIR, { store: "github-actions", repo: "x/y" });
    expect(allow).toHaveLength(1);
    const m = verifyAndLoadManifest(
      fs.files.get(p.manifest) as string,
      fs.files.get(p.sig) as string,
      fs.files.get(p.pub) as string,
    );
    expect(m.neverRotate).toEqual(["deploy-key"]);
  });
});

describe("arg parsing", () => {
  it("parseInitArgs defaults the dir and reads --dir", () => {
    expect(parseInitArgs([]).dir).toBe(DEFAULT_DIR);
    expect(parseInitArgs(["--dir", "/tmp/x"]).dir).toBe("/tmp/x");
  });

  it("parseAllowArgs reads flags and maps --env/--name", () => {
    const { dir, args } = parseAllowArgs([
      "--store", "github-actions",
      "--repo", "acme/api",
      "--env", "production",
      "--name", "R2_*",
      "--dir", "/cfg",
    ]);
    expect(dir).toBe("/cfg");
    expect(args).toEqual({
      store: "github-actions",
      repo: "acme/api",
      environment: "production",
      namePattern: "R2_*",
    });
  });

  it("parseAllowArgs requires --store", () => {
    expect(() => parseAllowArgs(["--repo", "a/b"])).toThrow(SetupError);
  });

  it("parseAllowArgs defaults dir when --dir absent", () => {
    expect(parseAllowArgs(["--store", "file"]).dir).toBe(DEFAULT_DIR);
  });
});
