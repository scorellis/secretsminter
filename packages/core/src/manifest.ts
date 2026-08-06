/**
 * Signed-manifest loader (docs/adrs/0008, story 0006).
 *
 * The manifest is the trust root: a values-free declaration of which destinations/scopes are allowed,
 * plus the deployment's extra NEVER_ROTATE names and the broker-dependency set. Because it is the
 * trust root, the broker must refuse to run on a manifest that is not exactly the one an operator
 * signed — a tampered or unsigned manifest is fatal, not a warning.
 *
 * The signature is a detached **Ed25519** signature over the RAW manifest bytes (the file as written).
 * Verifying the exact bytes, then parsing, avoids any canonicalization ambiguity. The operator holds
 * the private key out-of-band; the broker is configured with only the public key.
 */

import { sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import type { AllowlistEntry, Manifest } from "./allowlist.js";
import { NEVER_ROTATE_NAMES } from "./never-rotate.js";
import type { StoreId } from "./types.js";

export class ManifestError extends Error {
  constructor(reason: string) {
    super(`manifest rejected: ${reason}`);
    this.name = "ManifestError";
  }
}

/** The known destination stores — the single source of truth for store-id validation. */
export const STORE_IDS: readonly StoreId[] = ["github-actions", "cloudflare-pages", "file"];

const VALID_STORES: ReadonlySet<StoreId> = new Set<StoreId>(STORE_IDS);

/** Narrow an arbitrary string to a {@link StoreId} (e.g. to validate operator `--store` input). */
export function isKnownStore(s: string): s is StoreId {
  return (VALID_STORES as ReadonlySet<string>).has(s);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function validateEntry(raw: unknown, i: number): AllowlistEntry {
  if (typeof raw !== "object" || raw === null) {
    throw new ManifestError(`allow[${i}] is not an object`);
  }
  const e = raw as Record<string, unknown>;
  if (typeof e["store"] !== "string" || !VALID_STORES.has(e["store"] as StoreId)) {
    throw new ManifestError(`allow[${i}].store is not a known store`);
  }
  for (const k of ["repo", "project", "environment", "namePattern"]) {
    if (e[k] !== undefined && typeof e[k] !== "string") {
      throw new ManifestError(`allow[${i}].${k} must be a string when present`);
    }
  }
  // Build the entry with only the present optional fields (exactOptionalPropertyTypes-safe).
  const entry: { -readonly [K in keyof AllowlistEntry]?: AllowlistEntry[K] } = {
    store: e["store"] as StoreId,
  };
  if (typeof e["repo"] === "string") entry.repo = e["repo"];
  if (typeof e["project"] === "string") entry.project = e["project"];
  if (typeof e["environment"] === "string") entry.environment = e["environment"];
  if (typeof e["namePattern"] === "string") entry.namePattern = e["namePattern"];
  return entry as AllowlistEntry;
}

/** Parse + shape-validate an already-verified manifest string. Throws {@link ManifestError}. */
export function parseManifest(json: string): Manifest {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ManifestError("not valid JSON");
  }
  if (typeof raw !== "object" || raw === null) throw new ManifestError("not an object");
  const m = raw as Record<string, unknown>;
  if (typeof m["version"] !== "number") throw new ManifestError("version must be a number");
  if (!Array.isArray(m["allow"])) throw new ManifestError("allow must be an array");
  const allow = m["allow"].map((e, i) => validateEntry(e, i));

  const manifest: { -readonly [K in keyof Manifest]?: Manifest[K] } = {
    version: m["version"],
    allow,
  };
  if (m["neverRotate"] !== undefined) {
    if (!isStringArray(m["neverRotate"])) throw new ManifestError("neverRotate must be string[]");
    manifest.neverRotate = m["neverRotate"];
  }
  if (m["brokerDependencies"] !== undefined) {
    if (!isStringArray(m["brokerDependencies"])) {
      throw new ManifestError("brokerDependencies must be string[]");
    }
    manifest.brokerDependencies = m["brokerDependencies"];
  }
  return manifest as Manifest;
}

/**
 * Produce a detached Ed25519 signature over the raw manifest bytes (base64). The inverse of
 * {@link verifyAndLoadManifest}: sign the EXACT bytes that will be written to disk, so the pair
 * round-trips without any canonicalization step. Operator-side only (init/allow scaffolding); the
 * broker never signs — it only verifies.
 *
 * @param json           the raw manifest bytes to sign (must be byte-identical to what is stored)
 * @param privateKeyPem  the operator's Ed25519 private key, PEM (PKCS8)
 */
export function signManifest(json: string, privateKeyPem: string): string {
  return cryptoSign(null, Buffer.from(json, "utf8"), privateKeyPem).toString("base64");
}

/**
 * Verify a detached Ed25519 signature over the raw manifest bytes, then parse. This is the ONLY
 * supported way to load a manifest into the broker.
 *
 * @param json           the raw manifest file contents (bytes that were signed)
 * @param signature      the detached signature (base64)
 * @param publicKeyPem   the operator's Ed25519 public key, PEM (SPKI)
 */
export function verifyAndLoadManifest(json: string, signature: string, publicKeyPem: string): Manifest {
  let ok = false;
  try {
    ok = cryptoVerify(
      null,
      Buffer.from(json, "utf8"),
      publicKeyPem,
      Buffer.from(signature, "base64"),
    );
  } catch (err) {
    throw new ManifestError(`signature could not be verified (${(err as Error).name})`);
  }
  if (!ok) throw new ManifestError("signature does not match — manifest is unsigned or tampered");
  return parseManifest(json);
}

/** The effective NEVER_ROTATE name set: the committed constant unioned with the manifest's additions. */
export function effectiveNeverRotateNames(manifest: Manifest): ReadonlySet<string> {
  const set = new Set<string>(NEVER_ROTATE_NAMES);
  for (const n of manifest.neverRotate ?? []) set.add(n.toLowerCase());
  return set;
}

/** The broker-dependency (self-lockout) set declared by the manifest. */
export function brokerDependencySet(manifest: Manifest): ReadonlySet<string> {
  return new Set<string>(manifest.brokerDependencies ?? []);
}
