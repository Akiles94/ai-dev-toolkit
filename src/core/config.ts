import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Toolkit settings that the mechanical commands need. Loaded from `.aidt/config.json`. */
export interface AidtConfig {
  limits: {
    /** Target maximum of production lines per section (tests and noise excluded). */
    sectionLines: number;
    /** Globs for files that never count as reviewable code (lockfiles, generated, snapshots…). */
    exclude: string[];
  };
  tests: {
    /** Globs that identify test files. Counted apart from production code. */
    patterns: string[];
  };
  configFiles: {
    /** Globs for tooling configuration (package.json, tsconfig, CI…). Counted apart. */
    patterns: string[];
  };
  guide: {
    /** Marker that identifies removable guide comments, e.g. `// @guide: …`. */
    marker: string;
  };
}

export const DEFAULT_CONFIG: AidtConfig = {
  limits: {
    sectionLines: 300,
    exclude: [
      "**/package-lock.json",
      "**/npm-shrinkwrap.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
      "**/bun.lock",
      "**/bun.lockb",
      "**/Cargo.lock",
      "**/poetry.lock",
      "**/composer.lock",
      "**/Gemfile.lock",
      "**/go.sum",
      "**/*.snap",
      "**/__snapshots__/**",
      "**/*.generated.*",
      "**/generated/**",
      "**/dist/**",
      "**/build/**",
      "**/*.min.*",
      "**/*.map",
    ],
  },
  tests: {
    patterns: [
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "test/**",
      "tests/**",
      "**/*_test.go",
      "**/test_*.py",
    ],
  },
  configFiles: {
    patterns: [
      "**/package.json",
      "**/tsconfig*.json",
      "**/jsconfig*.json",
      "**/*.config.{js,cjs,mjs,ts,cts,mts,json}",
      "**/biome.json",
      "**/biome.jsonc",
      "**/.eslintrc*",
      "**/.prettierrc*",
      "**/.editorconfig",
      "**/.gitignore",
      "**/.gitattributes",
      "**/.nvmrc",
      "**/.node-version",
      "**/.npmrc",
      ".github/**",
      ".vscode/**",
      ".aidt/config.json",
    ],
  },
  guide: { marker: "@guide" },
};

export const CONFIG_PATH = join(".aidt", "config.json");

/**
 * Reads `.aidt/config.json` and merges it over the defaults, one group at a time.
 * A missing file means "use the defaults"; an invalid one is an error the user must fix.
 */
export async function loadConfig(repoRoot: string): Promise<AidtConfig> {
  let raw: string;
  try {
    raw = await readFile(join(repoRoot, CONFIG_PATH), "utf8");
  } catch {
    return DEFAULT_CONFIG;
  }
  const parsed = JSON.parse(raw) as Partial<{ [K in keyof AidtConfig]: Partial<AidtConfig[K]> }>;
  return {
    limits: { ...DEFAULT_CONFIG.limits, ...parsed.limits },
    tests: { ...DEFAULT_CONFIG.tests, ...parsed.tests },
    configFiles: { ...DEFAULT_CONFIG.configFiles, ...parsed.configFiles },
    guide: { ...DEFAULT_CONFIG.guide, ...parsed.guide },
  };
}
