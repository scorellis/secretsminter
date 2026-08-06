/**
 * Operator setup commands: `secretsminter init` and `secretsminter allow` (story 0023).
 *
 * These stand up the trust root without any hand-signing: `init` generates an Ed25519 keypair,
 * writes an empty (default-deny) manifest, signs it, and scaffolds the approvals file; `allow`
 * appends one destination to the allow-list and re-signs. Both touch local files only — they never
 * call a vendor or mint a secret.
 *
 * The logic is kept fs/argv-injectable so it is testable without real disk timing or real
 * `process.argv`; `cli.ts` wires the real Node fs + argv. No secret value is ever returned or
 * printed by these functions — `manifest.key` is written but never surfaced.
 */

import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";
import {
  isKnownStore,
  parseManifest,
  signManifest,
  STORE_IDS,
  verifyAndLoadManifest,
  type AllowlistEntry,
  type Manifest,
} from "@secretsminter/core";

/** A clean, operator-facing failure (missing init, clobber refusal, unknown store, …). */
export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SetupError";
  }
}

/** The minimal filesystem surface these commands need — injectable for tests. */
export interface SetupFs {
  /** True if a file exists at `path`. */
  exists(path: string): boolean;
  /** Create `path` (recursively); a no-op if it already exists. */
  mkdir(path: string): void;
  /** Write `data` to `path`, overwriting. */
  writeFile(path: string, data: string): void;
  /** Read `path` as UTF-8, or null if it does not exist. */
  readFile(path: string): string | null;
}

export const DEFAULT_DIR = "./.secretsminter";

/** The fixed file names inside an operator config dir. */
export interface DirPaths {
  readonly manifest: string;
  readonly sig: string;
  readonly pub: string;
  readonly key: string;
  readonly approvals: string;
  readonly state: string;
  readonly audit: string;
}

export function dirPaths(dir: string): DirPaths {
  return {
    manifest: join(dir, "manifest.json"),
    sig: join(dir, "manifest.sig"),
    pub: join(dir, "manifest.pub"),
    key: join(dir, "manifest.key"),
    approvals: join(dir, "approvals.json"),
    state: join(dir, "state.json"),
    audit: join(dir, "audit.log"),
  };
}

/** Serialize a manifest the one canonical way both commands write it (stable, human-readable). */
function serializeManifest(m: Manifest): string {
  return JSON.stringify(m, null, 2);
}

export interface InitResult {
  readonly dir: string;
  /** Files written, in order. */
  readonly written: readonly string[];
  /** `export …` lines the operator should run (env → this dir). Human channel only. */
  readonly envExports: readonly string[];
  /** Human next-steps guidance. */
  readonly nextSteps: readonly string[];
}

/**
 * Scaffold an operator config dir. Refuses to overwrite an existing signing key (a crown jewel).
 * Self-verifies the freshly-signed manifest before returning, so a bad write fails loudly.
 */
export function runInit(fs: SetupFs, dir: string): InitResult {
  const p = dirPaths(dir);

  // 1. Create the dir (recursive, idempotent).
  fs.mkdir(dir);

  // 2. Refuse to clobber an existing signing key.
  if (fs.exists(p.key)) {
    throw new SetupError(
      `refusing to overwrite an existing signing key at ${p.key}. ` +
        `A signing key is a crown jewel; delete or move it deliberately before re-initializing.`,
    );
  }

  // 3. Generate the Ed25519 keypair.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  // 4. Empty, default-deny manifest.
  const manifest: Manifest = { version: 1, allow: [] };
  const json = serializeManifest(manifest);

  // 5. Sign it.
  const sig = signManifest(json, keyPem);

  // Write everything: key + pub, then manifest + sig, then approvals.
  fs.writeFile(p.key, keyPem);
  fs.writeFile(p.pub, pubPem);
  fs.writeFile(p.manifest, json);
  fs.writeFile(p.sig, sig);
  fs.writeFile(p.approvals, "[]\n");

  // Self-check: the scaffold must verify immediately.
  verifyAndLoadManifest(json, sig, pubPem);

  const envExports = [
    `export SECRETSMINTER_MANIFEST=${p.manifest}`,
    `export SECRETSMINTER_MANIFEST_SIG=${p.sig}`,
    `export SECRETSMINTER_MANIFEST_PUBKEY=${p.pub}`,
    `export SECRETSMINTER_APPROVALS=${p.approvals}`,
    `export SECRETSMINTER_STATE=${p.state}`,
    `export SECRETSMINTER_AUDIT_LOG=${p.audit}`,
  ];
  const nextSteps = [
    `Keep ${p.key} OUT of git — it is the signing key (the trust root).`,
    `Add a destination:  secretsminter allow --store <id> [--repo owner/name] [--project p] [--env e] [--name <pattern>]${dir === DEFAULT_DIR ? "" : ` --dir ${dir}`}`,
    `Provide provider bootstraps via SECRETSMINTER_* env (never in chat/logs).`,
    `Register the MCP server (run 'secretsminter' with the env above exported).`,
  ];

  return {
    dir,
    written: [p.key, p.pub, p.manifest, p.sig, p.approvals],
    envExports,
    nextSteps,
  };
}

/** Parsed `allow` inputs; store is validated inside {@link runAllow}. */
export interface AllowArgs {
  readonly store: string;
  readonly repo?: string;
  readonly project?: string;
  /** `--env` maps to the manifest's `environment` field. */
  readonly environment?: string;
  /** `--name` maps to the manifest's `namePattern` field. */
  readonly namePattern?: string;
}

export interface AllowResult {
  readonly dir: string;
  /** The full, value-free allow-list after appending. */
  readonly allow: readonly AllowlistEntry[];
}

/**
 * Append one destination to the allow-list and re-sign. Errors clearly if the dir isn't init'd or
 * the `--store` is unknown. Self-verifies the re-signed manifest before returning.
 */
export function runAllow(fs: SetupFs, dir: string, args: AllowArgs): AllowResult {
  const p = dirPaths(dir);

  const json = fs.readFile(p.manifest);
  if (json === null) {
    throw new SetupError(
      `not initialized: no manifest found at ${p.manifest}. ` +
        `Run 'secretsminter init${dir === DEFAULT_DIR ? "" : ` --dir ${dir}`}' first.`,
    );
  }
  const keyPem = fs.readFile(p.key);
  if (keyPem === null) {
    throw new SetupError(
      `not initialized: no signing key found at ${p.key}. ` +
        `Run 'secretsminter init${dir === DEFAULT_DIR ? "" : ` --dir ${dir}`}' first.`,
    );
  }

  if (!isKnownStore(args.store)) {
    throw new SetupError(
      `unknown --store '${args.store}'. Known stores: ${STORE_IDS.join(", ")}.`,
    );
  }

  // Parse the existing (already-signed) manifest, then append. exactOptionalPropertyTypes-safe:
  // only attach the optional fields that are actually present.
  const existing = parseManifest(json);
  const entry: { -readonly [K in keyof AllowlistEntry]?: AllowlistEntry[K] } = {
    store: args.store,
  };
  if (args.repo !== undefined) entry.repo = args.repo;
  if (args.project !== undefined) entry.project = args.project;
  if (args.environment !== undefined) entry.environment = args.environment;
  if (args.namePattern !== undefined) entry.namePattern = args.namePattern;

  const updated: Manifest = {
    ...existing,
    allow: [...existing.allow, entry as AllowlistEntry],
  };
  const newJson = serializeManifest(updated);
  const sig = signManifest(newJson, keyPem);

  fs.writeFile(p.manifest, newJson);
  fs.writeFile(p.sig, sig);

  // Self-check against the public key if present (init always writes it).
  const pubPem = fs.readFile(p.pub);
  if (pubPem !== null) verifyAndLoadManifest(newJson, sig, pubPem);

  return { dir, allow: updated.allow };
}

// ---------------------------------------------------------------------------------------------
// Argument parsing (pure; takes the flag args AFTER the subcommand, e.g. process.argv.slice(3)).
// ---------------------------------------------------------------------------------------------

/** Read `--flag value` pairs; unknown flags are ignored so callers can be lenient. */
function readFlags(argv: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok !== undefined && tok.startsWith("--")) {
      const key = tok.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        out.set(key, val);
        i++;
      } else {
        out.set(key, "");
      }
    }
  }
  return out;
}

export function parseInitArgs(argv: readonly string[]): { dir: string } {
  const flags = readFlags(argv);
  const dir = flags.get("dir");
  return { dir: dir && dir.length > 0 ? dir : DEFAULT_DIR };
}

export function parseAllowArgs(argv: readonly string[]): { dir: string; args: AllowArgs } {
  const flags = readFlags(argv);
  const store = flags.get("store");
  if (store === undefined || store.length === 0) {
    throw new SetupError(
      "missing required --store <id>. " +
        `Known stores: ${STORE_IDS.join(", ")}.`,
    );
  }
  const dir = flags.get("dir");
  const args: { -readonly [K in keyof AllowArgs]?: AllowArgs[K] } = { store };
  const repo = flags.get("repo");
  const project = flags.get("project");
  const env = flags.get("env");
  const name = flags.get("name");
  if (repo) args.repo = repo;
  if (project) args.project = project;
  if (env) args.environment = env;
  if (name) args.namePattern = name;
  return {
    dir: dir && dir.length > 0 ? dir : DEFAULT_DIR,
    args: args as AllowArgs,
  };
}
