#!/usr/bin/env node
/**
 * Live Cloudflare check (story 0003). Proves the real path end to end against your account:
 * mint R2 Temporary Credentials -> verify them with a signed S3 HEAD -> they self-expire.
 *
 * Prereqs:
 *   1. `npm run build`
 *   2. A `.env` in the repo root with (from a bucket-scoped R2 API token — see docs/USING.md):
 *        SECRETSMINTER_CF_ACCOUNT_ID=...
 *        SECRETSMINTER_CF_API_TOKEN=...            # the R2 API token VALUE (Bearer)
 *        SECRETSMINTER_CF_PARENT_ACCESS_KEY_ID=... # the R2 API token Access Key ID
 *        SECRETSMINTER_CF_BUCKET=secretsminter-test
 *   3. `node scripts/live-cloudflare.mjs`
 *
 * It prints only non-secret confirmations — never a credential value.
 */

import { existsSync, readFileSync } from "node:fs";
import { CloudflareProvider } from "../packages/providers/dist/cloudflare.js";

// Minimal .env loader (no dependency). Does not overwrite already-set env vars.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  const provider = CloudflareProvider.fromEnv();
  process.stdout.write("Minting R2 temporary credentials…\n");
  const minted = await provider.mint({
    name: "live-test",
    secretClass: "ephemeral-cred",
    target: { store: "file", name: "live-test" },
    scopes: [],
  });
  process.stdout.write(`  minted (value hidden): ${JSON.stringify(minted.descriptor)}\n`);
  process.stdout.write(`  expires: ${minted.expiresAt}\n`);

  process.stdout.write("Verifying with a signed S3 HEAD against the bucket…\n");
  const ok = await provider.verify(minted.descriptor, minted);
  if (ok) {
    process.stdout.write("\n✅ PASS — real R2 mint + verify works. No value was returned to the caller.\n");
    process.exit(0);
  }
  process.stdout.write("\n❌ FAIL — verify did not succeed (check the token permission + bucket name).\n");
  process.exit(1);
}

main().catch((err) => {
  // Never print the error body — it could echo request material. Message only.
  process.stderr.write(`\n❌ ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
