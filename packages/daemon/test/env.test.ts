import { describe, expect, it } from "vitest";
import { loadEnvFile } from "../src/env.js";

describe("loadEnvFile", () => {
  it("populates unset keys and returns the count applied", () => {
    const env: Record<string, string | undefined> = {};
    const n = loadEnvFile("FOO=bar\nBAZ=qux\n", env);
    expect(n).toBe(2);
    expect(env["FOO"]).toBe("bar");
    expect(env["BAZ"]).toBe("qux");
  });

  it("does NOT clobber an already-set key (a real env var always wins)", () => {
    const env: Record<string, string | undefined> = { FOO: "real" };
    const n = loadEnvFile("FOO=fromfile\nNEW=added\n", env);
    expect(n).toBe(1); // only NEW applied
    expect(env["FOO"]).toBe("real");
    expect(env["NEW"]).toBe("added");
  });

  it("tolerates blank lines and # comments", () => {
    const env: Record<string, string | undefined> = {};
    const text = "\n# a comment\n\nALPHA=1\n   # indented comment\nBETA=2\n";
    const n = loadEnvFile(text, env);
    expect(n).toBe(2);
    expect(env).toEqual({ ALPHA: "1", BETA: "2" });
  });

  it("returns 0 for empty/whitespace-only or non-matching content", () => {
    expect(loadEnvFile("", {})).toBe(0);
    expect(loadEnvFile("   \n\n", {})).toBe(0);
    expect(loadEnvFile("not a valid line\nlower_case=nope\n", {})).toBe(0);
  });

  it("handles whitespace around '=' and strips surrounding quotes", () => {
    const env: Record<string, string | undefined> = {};
    loadEnvFile(`A = plain\nB="quoted value"\nC='single'\n`, env);
    expect(env["A"]).toBe("plain");
    expect(env["B"]).toBe("quoted value");
    expect(env["C"]).toBe("single");
  });
});
