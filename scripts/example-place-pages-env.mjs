#!/usr/bin/env node
/**
 * EXAMPLE runner — place environment variables into a Cloudflare Pages project (story 0013).
 *
 * This is a generic template, not a product-specific ops script. It shows how to drive
 * `CloudflarePagesStore` from the broker environment, value-blind. Adapt the VARS list to your own
 * project's variables.
 *
 * It places three example vars, hands-free:
 *   - MY_PLAIN_VAR -> plain_text  (a non-secret, e.g. a URL)
 *   - MY_SECRET_1  -> secret_text (a secret — never printed)
 *   - MY_SECRET_2  -> secret_text (a secret — never printed)
 *
 * VALUE-BLINDNESS — how the secrets enter:
 *   The secret vars are read from the BROKER ENVIRONMENT (process.env), NEVER passed as a caller/agent
 *   argument in a transcript. This script reads them from env and hands them to the store wrapped in a
 *   SecretValue; they are written into the PATCH body (their destination) but never logged and never
 *   surfaced in a thrown error. Provide them by exporting them in the shell that runs this script (or a
 *   root .env that is git-ignored) — do NOT paste them into a chat.
 *
 * Prereqs:
 *   1. `npm run build`
 *   2. Env (from the broker environment or a git-ignored `.env` at the repo root):
 *        SECRETSMINTER_CF_ACCOUNT_ID=...        # Cloudflare account id
 *        SECRETSMINTER_CF_PAGES_TOKEN=...        # Pages API token VALUE (Account -> Cloudflare Pages -> Edit)
 *        SECRETSMINTER_CF_PAGES_PROJECT=...      # the Pages project name (e.g. example-web)
 *        MY_PLAIN_VAR=https://example.com/config # plain_text
 *        MY_SECRET_1=...                         # secret_text (NEVER echo)
 *        MY_SECRET_2=...                         # secret_text (NEVER echo)
 *   3. `node scripts/example-place-pages-env.mjs`
 *
 * Prints only `<NAME>: ok|FAILED` per var — never a value. Missing vars are named, never their contents.
 *
 * CAVEAT: Cloudflare applies env-var changes on the NEXT deployment; existing running deployments are
 * unchanged. Trigger a redeploy (or push) after this runs for the vars to take effect.
 */

import { existsSync, readFileSync } from "node:fs";
import { SecretValue } from "../packages/core/dist/secret-value.js";
import { CloudflarePagesStore } from "../packages/providers/dist/cloudflare-pages.js";

// Minimal .env loader (no dependency). Does not overwrite already-set env vars.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
}

const project = process.env["SECRETSMINTER_CF_PAGES_PROJECT"];

// The example vars to place. `secret` marks which are value-blind (secret_text) vs plain_text.
// Replace these with your own project's variables.
const VARS = [
  { name: "MY_PLAIN_VAR", env: "MY_PLAIN_VAR", secret: false },
  { name: "MY_SECRET_1", env: "MY_SECRET_1", secret: true },
  { name: "MY_SECRET_2", env: "MY_SECRET_2", secret: true },
];

async function main() {
  // Name (never value) every missing var up front.
  const missing = [];
  if (!process.env["SECRETSMINTER_CF_ACCOUNT_ID"]) missing.push("SECRETSMINTER_CF_ACCOUNT_ID");
  if (!process.env["SECRETSMINTER_CF_PAGES_TOKEN"]) missing.push("SECRETSMINTER_CF_PAGES_TOKEN");
  if (!project) missing.push("SECRETSMINTER_CF_PAGES_PROJECT");
  for (const v of VARS) if (!process.env[v.env]) missing.push(v.env);
  if (missing.length > 0) {
    process.stderr.write(`\n❌ Missing required env var(s): ${missing.join(", ")}\n`);
    process.exit(1);
  }

  const store = CloudflarePagesStore.fromEnv();
  process.stdout.write(`Placing env vars into Pages project '${project}' (production)…\n`);

  let allOk = true;
  for (const v of VARS) {
    const target = { store: "cloudflare-pages", project, name: v.name, environment: "production" };
    try {
      if (v.secret) {
        // Enters via the broker ENV, wrapped so it cannot be logged or serialized.
        await store.place(target, { material: new SecretValue(process.env[v.env]) });
      } else {
        await store.placePlain(target, process.env[v.env]);
      }
      process.stdout.write(`  ${v.name}: ok\n`);
    } catch (err) {
      allOk = false;
      // Message only — the store already scrubs; never print a value or a response body.
      process.stdout.write(`  ${v.name}: FAILED (${err instanceof Error ? err.message : String(err)})\n`);
    }
  }

  if (allOk) {
    process.stdout.write(
      "\n✅ All vars placed. They take effect on the NEXT Pages deployment — trigger a redeploy.\n",
    );
    process.exit(0);
  }
  process.stdout.write("\n❌ One or more vars failed (see per-var status above).\n");
  process.exit(1);
}

main().catch((err) => {
  // Never print the error body — it could echo request material. Message only.
  process.stderr.write(`\n❌ ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
