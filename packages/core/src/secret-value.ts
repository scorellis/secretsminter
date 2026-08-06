/**
 * SecretValue — a self-redacting holder for live secret material (docs/adrs/0001).
 *
 * Value-blindness must not depend on every future maintainer *remembering* never to serialize a raw
 * string. This wrapper makes leaking structurally hard: the material is a private field, and every
 * implicit stringification path is overridden to redact:
 *
 *   - `JSON.stringify(secret)`            -> "[REDACTED]"   (via toJSON)
 *   - `console.log(secret)` / util.inspect -> SecretValue([REDACTED])
 *   - `` `${secret}` `` / String(secret)   -> "[REDACTED]"   (via toString)
 *
 * The ONLY way to read the raw material is `.expose()`. That name is deliberately conspicuous: an
 * auditor can `grep -rn "\.expose(" ` to enumerate every single site that touches a live value.
 */

const INSPECT = Symbol.for("nodejs.util.inspect.custom");

export class SecretValue {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The one and only reader of raw material. Grep `.expose(` to audit every read site. */
  expose(): string {
    return this.#value;
  }

  /** Length is safe to expose (needed by the scrubber's min-length check) and reveals nothing. */
  get length(): number {
    return this.#value.length;
  }

  toString(): string {
    return "[REDACTED]";
  }

  toJSON(): string {
    return "[REDACTED]";
  }

  [INSPECT](): string {
    return "SecretValue([REDACTED])";
  }
}

/** Narrow a `string | SecretValue` to its raw string, exposing only when necessary. */
export function exposeMaterial(m: string | SecretValue): string {
  return typeof m === "string" ? m : m.expose();
}
