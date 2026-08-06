#!/usr/bin/env node
/**
 * `secretsminter` — the daemon entrypoint.
 *
 * Dispatches on `process.argv[2]`:
 *   - `init`   — scaffold the operator config (keypair + signed empty manifest + approvals), then exit.
 *   - `allow`  — append a destination to the allow-list and re-sign, then exit.
 *   - (none)   — the original behavior: assemble the broker from env, start the rotation loop, and
 *                (unless `SECRETSMINTER_SERVE=loop`) serve the MCP over stdio.
 *
 * The `init`/`allow` setup commands touch local files only — they never call a vendor or mint a
 * secret. stdout is the MCP protocol channel; every human-readable line goes to stderr.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { serveStdio } from "@secretsminter/mcp";
import { buildBroker } from "./build.js";
import { configFromEnv } from "./config.js";
import { loadEnvFile } from "./env.js";
import {
  parseAllowArgs,
  parseInitArgs,
  runAllow,
  runInit,
  SetupError,
  type SetupFs,
} from "./init.js";
import { startRotationLoop } from "./loop.js";

/** Real filesystem wiring for the setup commands. */
const realFs: SetupFs = {
  exists: (p) => existsSync(p),
  mkdir: (p) => {
    mkdirSync(p, { recursive: true });
  },
  writeFile: (p, data) => {
    writeFileSync(p, data);
  },
  readFile: (p) => (existsSync(p) ? readFileSync(p, "utf8") : null),
};

function runInitCommand(argv: readonly string[]): void {
  const { dir } = parseInitArgs(argv);
  // Resolve to an absolute dir so the emitted registration (below) is copy-paste-portable regardless
  // of the operator's cwd when the MCP client later launches the daemon.
  // Emit a serve command the client can actually resolve from a fresh clone (no global install needed):
  // `node <abs path to this very cli.js>`. Mirrors how the operator just successfully ran init.
  const result = runInit(realFs, resolve(dir), {
    command: "node",
    baseArgs: [resolve(process.argv[1] ?? "")],
  });
  process.stderr.write(`secretsminter: initialized ${result.dir}\n`);
  process.stderr.write(`  wrote: ${result.written.join(", ")}\n`);
  process.stderr.write(`  env file: ${result.envFile} (SECRETSMINTER_* paths written; add provider bootstraps here)\n\n`);
  process.stderr.write(`Export these (env → ${result.dir}):\n`);
  for (const line of result.envExports) process.stderr.write(`  ${line}\n`);

  process.stderr.write(`\nRegister the MCP server — ready-to-paste one-liner:\n`);
  process.stderr.write(`  ${result.mcpAddLine}\n`);
  process.stderr.write(`\n.mcp.json snippet (generic MCP-client shape):\n`);
  for (const line of result.mcpJsonSnippet.split("\n")) process.stderr.write(`  ${line}\n`);

  process.stderr.write(`\nNext steps:\n`);
  for (const step of result.nextSteps) process.stderr.write(`  - ${step}\n`);
}

function runAllowCommand(argv: readonly string[]): void {
  const { dir, args } = parseAllowArgs(argv);
  const result = runAllow(realFs, dir, args);
  process.stderr.write(`secretsminter: allow-list updated (${dir}) — ${result.allow.length} entr${result.allow.length === 1 ? "y" : "ies"}:\n`);
  for (const e of result.allow) {
    const parts = [
      `store=${e.store}`,
      e.repo ? `repo=${e.repo}` : "",
      e.project ? `project=${e.project}` : "",
      e.environment ? `env=${e.environment}` : "",
      e.namePattern ? `name=${e.namePattern}` : "",
    ].filter((x) => x.length > 0);
    process.stderr.write(`  - ${parts.join(" ")}\n`);
  }
}

/**
 * Read the `--env-file <path>` flag off the serve argv (everything after the bin name). Returns the
 * given path, or undefined if the flag is absent.
 */
function envFileArg(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--env-file");
  if (i >= 0) {
    const val = argv[i + 1];
    if (val !== undefined && !val.startsWith("--")) return val;
  }
  return undefined;
}

/**
 * Load a `.env` into `process.env` before assembling config: an explicit `--env-file <path>`, else an
 * auto-detected `./.env` in the cwd. A missing file is silently skipped (auto or explicit). Only a
 * count — never a value — is written to stderr (stdout is the MCP channel).
 */
function loadServeEnv(argv: readonly string[]): void {
  const explicit = envFileArg(argv);
  const path = explicit ?? "./.env";
  if (!existsSync(path)) return; // missing file = silently skip
  const n = loadEnvFile(readFileSync(path, "utf8"), process.env);
  process.stderr.write(`secretsminter: loaded ${n} vars from ${path}\n`);
}

async function serve(argv: readonly string[]): Promise<void> {
  loadServeEnv(argv);
  const config = configFromEnv();
  const { broker, providers, manifestLoaded } = buildBroker(config);
  const serveMode = (process.env["SECRETSMINTER_SERVE"] ?? "stdio").toLowerCase();

  process.stderr.write(
    `secretsminter daemon — providers: [${providers.join(", ") || "none"}], ` +
      `manifest: ${manifestLoaded ? "verified" : "EMPTY (nothing can be placed until configured)"}, ` +
      `rotation every ${config.rotationIntervalMs}ms, serve: ${serveMode}\n`,
  );

  startRotationLoop(broker, config.rotationIntervalMs); // keeps the process alive

  if (serveMode !== "loop") {
    // Best-effort MCP over stdio. A failure here (e.g. no stdin attached) must NOT stop the rotation
    // loop, which is what keeps the daemon useful in a persistent container.
    serveStdio(broker).catch((err: unknown) => {
      process.stderr.write(`secretsminter MCP (stdio) not serving: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }
}

async function main(): Promise<void> {
  const sub = process.argv[2];
  const rest = process.argv.slice(3);

  if (sub === "init") {
    runInitCommand(rest);
    return;
  }
  if (sub === "allow") {
    runAllowCommand(rest);
    return;
  }
  await serve(process.argv.slice(2));
}

main().catch((err: unknown) => {
  const msg =
    err instanceof SetupError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  process.stderr.write(`secretsminter: ${msg}\n`);
  process.exitCode = 1;
});
