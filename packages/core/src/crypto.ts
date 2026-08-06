import { createHash, createHmac } from "node:crypto";

/**
 * Cloudflare R2's S3-compatible `secretAccessKey` is the SHA-256 hex digest of the API token's
 * value (the `accessKeyId` is the token id). This is non-obvious and shown-once; encode it here so
 * a caller never re-derives it by hand. Pure, no network. See docs/spikes/0001.
 */
export function r2SecretAccessKeyFromToken(tokenValue: string): string {
  return createHash("sha256").update(tokenValue, "utf8").digest("hex");
}

/**
 * A short, non-reversible fingerprint of secret material for the audit log (docs/adrs/0011). The
 * audit never stores a value; it stores this so two rotations of the same logical secret can be
 * correlated. Keyed HMAC so fingerprints are not comparable across installs.
 */
export function auditFingerprint(material: string, auditKey: string, length = 12): string {
  return createHmac("sha256", auditKey).update(material, "utf8").digest("hex").slice(0, length);
}
