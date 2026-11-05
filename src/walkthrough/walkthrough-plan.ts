import { basename, dirname, extname } from "node:path";
import type { FileChange } from "../shared/changes/changes.ts";

/**
 * Reading order for a large change: what the rest depends on first, what the user sees last.
 * The order is a heuristic on paths; the walkthrough agent may reorder sections when the code
 * tells a different story.
 */
export type Layer = "contracts" | "core" | "integration" | "ui" | "docs" | "tests" | "config";

const LAYER_ORDER: Layer[] = ["contracts", "core", "integration", "ui", "docs", "tests", "config"];
const CODE_LAYERS = LAYER_ORDER.slice(0, 5);

const LAYER_LABELS: Record<Layer, string> = {
  contracts: "Contracts and types",
  core: "Core logic",
  integration: "Integration",
  ui: "UI",
  docs: "Docs",
  tests: "Tests",
  config: "Config",
};

const CONTRACT_DIRS =
  /(^|\/)(types?|interfaces?|contracts?|schemas?|models?|domain|entities|dtos?|migrations)(\/|$)/i;
const CONTRACT_FILES =
  /(\.d\.ts|\.proto|\.graphql|\.gql|\.prisma)$|(^|[.-])(types?|schema|model)\./i;
const INTEGRATION_DIRS =
  /(^|\/)(api|routes?|controllers?|handlers?|adapters?|infra|infrastructure|db|database|repositor(y|ies)|clients?|server|middlewares?|cli)(\/|$)/i;
const UI_DIRS = /(^|\/)(components?|pages|views?|screens?|ui|styles|layouts?|widgets?)(\/|$)/i;
const DOC_EXTENSIONS = new Set([".md", ".mdx", ".rst", ".txt", ".adoc"]);
const UI_EXTENSIONS = new Set([".tsx", ".jsx", ".vue", ".svelte", ".css", ".scss", ".html"]);

/** The layer of a production file, from its folders, name and extension. */
export function layerOf(path: string): Layer {
  if (DOC_EXTENSIONS.has(extname(path).toLowerCase())) return "docs";
  if (CONTRACT_DIRS.test(dirname(path)) || CONTRACT_FILES.test(basename(path))) return "contracts";
  if (UI_EXTENSIONS.has(extname(path)) || UI_DIRS.test(dirname(path))) return "ui";
  if (INTEGRATION_DIRS.test(dirname(path))) return "integration";
  return "core";
}

/** `src/cart.test.ts`, `cart_test.go`, `test_cart.py`, `CartTests.swift` → `cart`. */
export function subjectOf(path: string): string {
  const name = basename(path)
    .replace(/\.[^.]+$/, "")
    .replace(/[._-](test|spec)$/i, "")
    .replace(/^test_/i, "")
    .replace(/Tests?$/, "");
  return name.toLowerCase();
}

const stem = (path: string) =>
  basename(path)
    .replace(/\.[^.]+$/, "")
    .toLowerCase();

export interface WalkthroughSection {
  id: string;
  layer: Layer;
  title: string;
  /** Reviewable lines (added + deleted) of the production files; the section limit applies here. */
  lines: number;
  /** Lines of the tests read next to the code they test; they do not count toward the limit. */
  testLines: number;
  /** A single file bigger than the limit: the agent splits it by hunks. */
  oversized: boolean;
  files: FileChange[];
}

export interface WalkthroughPlan {
  limit: number;
  sections: WalkthroughSection[];
  /** Noise and formatting-only files: listed so nothing is hidden, never read. */
  skipped: FileChange[];
}

const size = (file: FileChange) => file.added + file.deleted;

/** Groups files by folder, keeping the given order of folders and files. */
function byFolder(files: FileChange[]): FileChange[][] {
  const groups = new Map<string, FileChange[]>();
  for (const file of files) {
    const folder = dirname(file.path);
    groups.set(folder, [...(groups.get(folder) ?? []), file]);
  }
  return [...groups.values()];
}

/**
 * Packs files into chunks of at most `limit` lines. A folder that fits in a chunk is never split;
 * a bigger one is packed file by file; a file bigger than the limit gets a chunk of its own.
 */
function pack(files: FileChange[], limit: number): FileChange[][] {
  const chunks: FileChange[][] = [];
  let current: FileChange[] = [];
  let lines = 0;
  const close = () => {
    if (current.length > 0) chunks.push(current);
    current = [];
    lines = 0;
  };
  const add = (file: FileChange) => {
    if (lines + size(file) > limit) close();
    current.push(file);
    lines += size(file);
  };
  for (const folder of byFolder(files)) {
    const folderLines = folder.reduce((sum, f) => sum + size(f), 0);
    if (folderLines <= limit) {
      if (lines + folderLines > limit) close();
      current.push(...folder);
      lines += folderLines;
    } else {
      close();
      folder.forEach(add);
      close();
    }
  }
  close();
  return chunks;
}

function titleOf(layer: Layer, files: FileChange[]): string {
  const folders = [
    ...new Set(files.map((f) => (dirname(f.path) === "." ? "(root)" : dirname(f.path)))),
  ];
  const shown = folders.slice(0, 2).join(", ") + (folders.length > 2 ? ", …" : "");
  return `${LAYER_LABELS[layer]} · ${shown}`;
}

/**
 * Splits a change into sections a person can review in one sitting, in reading order.
 * Each test joins the section of the file it tests (matched by name); the rest go together
 * after the code. Config comes last; noise and formatting are skipped.
 */
export function planWalkthrough(files: readonly FileChange[], limit: number): WalkthroughPlan {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const code = sorted.filter((f) => f.category === "code");
  const chunks: { layer: Layer; files: FileChange[] }[] = [];
  for (const layer of CODE_LAYERS) {
    const inLayer = code.filter((f) => layerOf(f.path) === layer);
    for (const chunk of pack(inLayer, limit)) chunks.push({ layer, files: chunk });
  }

  const tests = sorted.filter((f) => f.category === "test");
  const looseTests: FileChange[] = [];
  for (const test of tests) {
    const home = chunks.find((c) => c.files.some((f) => stem(f.path) === subjectOf(test.path)));
    if (home) home.files.push(test);
    else looseTests.push(test);
  }
  for (const chunk of pack(looseTests, limit)) chunks.push({ layer: "tests", files: chunk });
  const config = sorted.filter((f) => f.category === "config");
  if (config.length > 0) chunks.push({ layer: "config", files: config });

  const sections = chunks.map(({ layer, files: chunkFiles }, i): WalkthroughSection => {
    const counted = chunkFiles.filter((f) => f.category !== "test" || layer === "tests");
    const lines = counted.reduce((sum, f) => sum + size(f), 0);
    const testLines =
      layer === "tests"
        ? 0
        : chunkFiles.reduce((sum, f) => sum + (f.category === "test" ? size(f) : 0), 0);
    return {
      id: `S${i + 1}`,
      layer,
      title: titleOf(layer, chunkFiles),
      lines,
      testLines,
      oversized: counted.length === 1 && lines > limit,
      files: chunkFiles,
    };
  });
  const skipped = sorted.filter((f) => f.category === "noise" || f.category === "formatting");
  return { limit, sections, skipped };
}
