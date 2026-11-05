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
  sync: {
    /** Folder with the canonical agents, relative to the repository root. */
    agents: string;
    /** AI tools to render the agents for. */
    harnesses: string[];
  };
  structure: {
    /** The project's structure decision; its "Exceptions" section lists globs the audit skips. */
    decision: string;
    /** Source file extensions the audit looks at; everything else is ignored. */
    extensions: string[];
    maxFileLines: number;
    maxFolderFiles: number;
    /** Names that hold whatever had no home (`utils`): always reported. */
    junkNames: string[];
    /** Umbrella folders (`shared`): fine only when every file in them sits in a subject subfolder. */
    umbrellaNames: string[];
    /** One-file-for-everything names (`api`, `types`): reported at a source root or umbrella. */
    globalNames: string[];
    /** File names that may sit among folders as entry points (`index`, `main`). */
    entryNames: string[];
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
      ".aidt/tasks/**",
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
      "**/knip.json",
      "**/knip.jsonc",
      "**/.jscpd.json",
      "**/.dependency-cruiser.*",
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
  sync: { agents: ".aidt/agents", harnesses: ["copilot", "claude-code"] },
  structure: {
    decision: ".aidt/structure.md",
    extensions: [
      ...["ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte"],
      ...["go", "cs", "java", "kt", "kts", "swift", "py", "rb", "php", "rs", "dart"],
    ],
    maxFileLines: 300,
    maxFolderFiles: 15,
    junkNames: ["utils", "util", "helpers", "helper", "misc", "general", "stuff", "functions"],
    umbrellaNames: ["shared", "common", "lib", "core"],
    globalNames: ["api", "types", "constants", "store", "services", "endpoints", "interfaces"],
    entryNames: ["index", "main", "app", "server", "program", "cli", "mod", "lib", "startup"],
  },
};

const CONFIG_PATH = join(".aidt", "config.json");

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
    sync: { ...DEFAULT_CONFIG.sync, ...parsed.sync },
    structure: { ...DEFAULT_CONFIG.structure, ...parsed.structure },
  };
}
