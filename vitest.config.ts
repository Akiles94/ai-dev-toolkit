import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      // Minimum only where the logic lives; coverage is a safety net, not a target.
      include: ["src/core/**/*.ts"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "reports/coverage",
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
