import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/**/src/**/*.ts"],
      exclude: [
        "packages/**/src/**/*.d.ts",
        "packages/**/src/index.ts", // barrel re-exports, no logic
        "packages/core/src/types.ts", // type-only
        "packages/mcp/src/cli.ts", // stdio bootstrap (smoke, not unit-tested)
        "packages/daemon/src/cli.ts", // daemon entrypoint (bootstrap, not unit-tested)
        "packages/mcp/src/tools.ts", // static tool catalog (data)
        "packages/providers/src/index.ts", // barrel re-exports
      ],
      // The gate: prevent regression on the real logic. Live provider paths (excluded) will bring
      // their own tests when wired.
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 88,
        lines: 90,
      },
    },
  },
});
