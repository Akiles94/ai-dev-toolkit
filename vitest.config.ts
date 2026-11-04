import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests sit next to the code they test; product content is tested next to the product.
    include: ["src/**/*.test.ts", "products/**/*.test.ts"],
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      // Minimum only where the logic lives; coverage is a safety net, not a target.
      include: ["src/**/*.ts"],
      // Commands and the CLI are tested end to end in a subprocess, which coverage cannot see.
      exclude: ["src/cli.ts", "src/**/*.command.ts", "src/**/*.test.ts", "src/**/testing/**"],
      reporter: ["text", "json-summary"],
      reportsDirectory: "reports/coverage",
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
