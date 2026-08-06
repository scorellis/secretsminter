/**
 * Minimal `.env` loading for the serve path (story 0025).
 *
 * The daemon reads `process.env` only, so a newcomer used to need a hand-rolled launcher just to get
 * the SECRETSMINTER_* config + provider bootstraps into the environment. {@link loadEnvFile} closes
 * that last-mile gap with the same tiny parser the example scripts use — kept pure and injectable so
 * it unit-tests without disk timing, and it NEVER clobbers an already-set real env var, and NEVER
 * prints a value (stdout is the MCP channel; only counts go to stderr).
 */

/** One `KEY=VALUE` line. Keys are upper-snake; the value is everything after the first `=`. */
const LINE = /^([A-Z0-9_]+)\s*=\s*(.*)$/;

/**
 * Parse `text` as a simple `.env` and set each `KEY=VALUE` into `env` ONLY if the key is not already
 * set (a real env var always wins — we never overwrite it). Blank lines and `#` comments are skipped,
 * as is any line that does not match `KEY=VALUE`. Surrounding single/double quotes on a value are
 * stripped. Returns the number of vars actually applied (never the values).
 */
export function loadEnvFile(text: string, env: Record<string, string | undefined>): number {
  let applied = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const m = LINE.exec(line);
    if (m === null) continue;
    const key = m[1] as string;
    let val = (m[2] as string).trim();
    if (val.length >= 2 && ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    if (env[key] === undefined) {
      env[key] = val;
      applied++;
    }
  }
  return applied;
}
