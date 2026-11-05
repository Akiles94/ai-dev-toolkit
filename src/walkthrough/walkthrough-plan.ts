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
  /(^|\/)(types?|contracts?|schemas?|models?|domain|entities|dtos?|migrations)(\/|$)/i;
const CONTRACT_FILES =
  /(\.d\.ts|\.proto|\.graphql|\.gql|\.prisma)$|(^|[.-])(types?|schema|model)\./i;
const INTEGRATION_DIRS =
  /(^|\/)(api|interfaces|routes?|controllers?|handlers?|adapters?|infra|infrastructure|db|database|repositor(y|ies)|clients?|server|middlewares?|cli)(\/|$)/i;
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

/** Splits files into runs of the same folder, keeping their order. */
function byFolder(files: FileChange[]): FileChange[][] {
  const runs: FileChange[][] = [];
  for (const file of files) {
    const last = runs.at(-1);
    if (last && dirname(last[0]?.path ?? "") === dirname(file.path)) last.push(file);
    else runs.push([file]);
  }
  return runs;
}

/**
 * Packs files, in order, into chunks of at most `limit` lines. Layers are a reading order, not a
 * boundary: small parts of neighbouring layers share a chunk. A folder that fits in a chunk is
 * never split; a bigger one is packed file by file; a file over the limit gets a chunk of its own.
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
  const add = (group: FileChange[]) => {
    const groupLines = group.reduce((sum, f) => sum + size(f), 0);
    if (lines + groupLines > limit) close();
    current.push(...group);
    lines += groupLines;
  };
  for (const folder of byFolder(files)) {
    const folderLines = folder.reduce((sum, f) => sum + size(f), 0);
    if (folderLines <= limit) add(folder);
    else for (const file of folder) add([file]);
  }
  close();
  return chunks;
}

const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs"]);

/** `tests/application/x.test.ts` → `application`: the source folder a test folder mirrors. */
function mirroredFolder(testPath: string): string {
  return dirname(testPath)
    .split("/")
    .filter((part) => part !== "." && !TEST_DIRS.has(part))
    .join("/");
}

const inFolder = (path: string, folder: string) =>
  folder !== "" && `/${dirname(path)}/`.includes(`/${folder}/`);

function titleOf(files: FileChange[], layer: Layer): string {
  const read = files.filter((f) => f.category !== "test" || layer === "tests");
  const layerOfFile = (f: FileChange): Layer =>
    f.category === "code" ? layerOf(f.path) : f.category === "config" ? "config" : "tests";
  const layers = [...new Set(read.map(layerOfFile))];
  const folders = [
    ...new Set(read.map((f) => (dirname(f.path) === "." ? "(root)" : dirname(f.path)))),
  ];
  const shown = folders.slice(0, 2).join(", ") + (folders.length > 2 ? ", …" : "");
  return `${layers.map((l) => LAYER_LABELS[l]).join(" + ")} · ${shown}`;
}

const sum = (files: FileChange[], keep: (f: FileChange) => boolean) =>
  files.filter(keep).reduce((total, f) => total + size(f), 0);

/**
 * Splits a change into sections a person can review in one sitting, in reading order.
 * Each test joins the section of the file it tests (same name, or the folder its test folder
 * mirrors) while the tests there stay under the limit; the rest go together after the code.
 * Config joins the last section when it fits; noise and formatting are skipped.
 */
export function planWalkthrough(files: readonly FileChange[], limit: number): WalkthroughPlan {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const rank = (f: FileChange) => CODE_LAYERS.indexOf(layerOf(f.path));
  const code = sorted.filter((f) => f.category === "code").sort((a, b) => rank(a) - rank(b));
  const chunks = pack(code, limit).map((chunk) => ({
    layer: layerOf(chunk[0]?.path ?? ""),
    files: chunk,
  }));

  const looseTests: FileChange[] = [];
  for (const test of sorted.filter((f) => f.category === "test")) {
    const fits = (c: { files: FileChange[] }) =>
      sum(c.files, (f) => f.category === "test") + size(test) <= limit;
    const byName = chunks.find((c) => c.files.some((f) => stem(f.path) === subjectOf(test.path)));
    const mirror = mirroredFolder(test.path);
    const byFolderMirror = chunks.findLast(
      (c) => fits(c) && c.files.some((f) => f.category === "code" && inFolder(f.path, mirror)),
    );
    const home = byName ?? byFolderMirror;
    if (home) home.files.push(test);
    else looseTests.push(test);
  }
  for (const chunk of pack(looseTests, limit)) chunks.push({ layer: "tests", files: chunk });

  const config = sorted.filter((f) => f.category === "config");
  const last = chunks.at(-1);
  const counted = (c: { layer: Layer; files: FileChange[] }) =>
    sum(c.files, (f) => f.category !== "test" || c.layer === "tests");
  if (last && config.length > 0 && counted(last) + sum(config, () => true) <= limit) {
    last.files.push(...config);
  } else if (config.length > 0) chunks.push({ layer: "config", files: config });

  const sections = chunks.map((chunk, i): WalkthroughSection => {
    const lines = counted(chunk);
    const read = chunk.files.filter((f) => f.category !== "test" || chunk.layer === "tests");
    return {
      id: `S${i + 1}`,
      layer: chunk.layer,
      title: titleOf(chunk.files, chunk.layer),
      lines,
      testLines: chunk.layer === "tests" ? 0 : sum(chunk.files, (f) => f.category === "test"),
      oversized: read.length === 1 && lines > limit,
      files: chunk.files,
    };
  });
  const skipped = sorted.filter((f) => f.category === "noise" || f.category === "formatting");
  return { limit, sections, skipped };
}
