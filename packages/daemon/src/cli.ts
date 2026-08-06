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
import { serveStdio } from "@secretsminter/mcp";
import { buildBroker } from "./build.js";
import { configFromEnv } from "./config.js";
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
  const result = runInit(realFs, dir);
  process.stderr.write(`secretsminter: initialized ${result.dir}\n`);
  process.stderr.write(`  wrote: ${result.written.join(", ")}\n\n`);
  process.stderr.write(`Export these (env → ${result.dir}):\n`);
  for (const line of result.envExports) process.stderr.write(`  ${line}\n`);
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

async function serve(): Promise<void> {
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
  await serve();
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
