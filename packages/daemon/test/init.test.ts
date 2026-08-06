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

  it("emits a ready-to-paste 'claude mcp add' line and a .mcp.json snippet with the dir's manifest path", () => {
    const fs = memFs();
    const p = dirPaths(DIR);
    const { mcpAddLine, mcpJsonSnippet, envFile } = runInit(fs, DIR);

    // The one-liner points --env-file at the dir's .env.
    expect(mcpAddLine).toBe(`claude mcp add secretsminter -- secretsminter --env-file ${p.env}`);
    expect(envFile).toBe(p.env);

    // The .mcp.json snippet is valid JSON with the generic MCP-client shape, pointed into the dir.
    const parsed = JSON.parse(mcpJsonSnippet);
    const server = parsed.mcpServers.secretsminter;
    expect(server.command).toBe("secretsminter");
    expect(server.args).toEqual(["--env-file", p.env]);
    expect(server.env.SECRETSMINTER_MANIFEST).toBe(p.manifest);
    expect(server.env.SECRETSMINTER_APPROVALS).toBe(p.approvals);
  });

  it("emits a resolvable `node <cli>` serve command when given one (so a fresh clone needs no global install)", () => {
    const fs = memFs();
    const p = dirPaths(DIR);
    const cli = "/repo/packages/daemon/dist/cli.js";
    const { mcpAddLine, mcpJsonSnippet } = runInit(fs, DIR, { command: "node", baseArgs: [cli] });

    expect(mcpAddLine).toBe(`claude mcp add secretsminter -- node ${cli} --env-file ${p.env}`);
    const server = JSON.parse(mcpJsonSnippet).mcpServers.secretsminter;
    expect(server.command).toBe("node");
    expect(server.args).toEqual([cli, "--env-file", p.env]);
  });

  it("quotes serve args that contain spaces (Windows paths)", () => {
    const fs = memFs();
    const cli = "/Program Files/sm/cli.js";
    const { mcpAddLine } = runInit(fs, DIR, { command: "node", baseArgs: [cli] });
    expect(mcpAddLine).toContain(`node "${cli}"`);
  });

  it("writes the SECRETSMINTER_* config lines into <dir>/.env when none exists", () => {
    const fs = memFs();
    const p = dirPaths(DIR);
    runInit(fs, DIR);

    const env = fs.files.get(p.env) as string;
    expect(env).toBeTypeOf("string");
    expect(env).toContain(`SECRETSMINTER_MANIFEST=${p.manifest}`);
    expect(env).toContain(`SECRETSMINTER_MANIFEST_SIG=${p.sig}`);
    expect(env).toContain(`SECRETSMINTER_MANIFEST_PUBKEY=${p.pub}`);
    expect(env).toContain(`SECRETSMINTER_APPROVALS=${p.approvals}`);
    expect(env).toContain(`SECRETSMINTER_STATE=${p.state}`);
    expect(env).toContain(`SECRETSMINTER_AUDIT_LOG=${p.audit}`);
    // The signing key is never written into the .env.
    expect(env).not.toContain("SECRETSMINTER_MANIFEST_KEY");
    expect(env).not.toContain(p.key);
  });

  it("does NOT clobber an existing .env — appends only the missing SECRETSMINTER_* lines", () => {
    const p = dirPaths(DIR);
    // Operator already put a provider bootstrap + one manifest path in place.
    const preexisting =
      "SECRETSMINTER_CF_ACCOUNT_ID=acct-123\n" + `SECRETSMINTER_MANIFEST=${p.manifest}\n`;
    const fs = memFs({ [p.env]: preexisting });
    runInit(fs, DIR);

    const env = fs.files.get(p.env) as string;
    // Provider cred preserved untouched.
    expect(env).toContain("SECRETSMINTER_CF_ACCOUNT_ID=acct-123");
    // The already-present manifest line is not duplicated.
    expect(env.match(/SECRETSMINTER_MANIFEST=/g)).toHaveLength(1);
    // The missing lines were appended.
    expect(env).toContain(`SECRETSMINTER_APPROVALS=${p.approvals}`);
    expect(env).toContain(`SECRETSMINTER_STATE=${p.state}`);
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
