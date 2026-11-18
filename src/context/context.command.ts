import { readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import { type CliContext, print, UsageError } from "../shared/cli/cli-context.ts";
import {
  type ContextFile,
  estimateTokens,
  importsOf,
  type LayerReport,
  measureLayer,
  type ReadingItem,
  readingList,
} from "./context-budget.ts";

/** Claude Code follows imports up to five hops from the file it loads. */
const MAX_IMPORT_DEPTH = 5;

const toRepoPath = (root: string, full: string): string =>
  relative(root, full).split(sep).join("/");

/** Whether a path exists in the repository, and its text when it is a file. */
async function readEntry(root: string, path: string) {
  const full = join(root, path);
  const info = await stat(full).catch(() => undefined);
  const text = info?.isFile() ? await readFile(full, "utf8") : undefined;
  return { exists: info !== undefined, text };
}

/** The text of a file in the repository, or `undefined` when it is missing or a folder. */
const readText = async (root: string, path: string): Promise<string | undefined> =>
  (await readEntry(root, path)).text;

/** Each configured file that exists, once. */
async function readConfigured(root: string, paths: readonly string[]): Promise<ContextFile[]> {
  const files: ContextFile[] = [];
  for (const path of new Set(paths)) {
    const text = await readText(root, path);
    if (text !== undefined) files.push({ path, text });
  }
  return files;
}

/** Which files are already in the layer, and which have had their own imports read. */
interface ImportWalk {
  readonly counted: Set<string>;
  readonly expanded: Set<string>;
}

/**
 * The files a `CLAUDE.md` brings in with `@` imports, and theirs, inside the repository. A file
 * already counted (configured, or imported twice) is not counted again, but its own imports are
 * still read: `CLAUDE.md` → `@AGENTS.md` → `@docs/rules.md` loads all three.
 */
async function followImports(root: string, from: ContextFile, walk: ImportWalk, depth = 1) {
  const found: ContextFile[] = [];
  if (depth > MAX_IMPORT_DEPTH || walk.expanded.has(from.path)) return found;
  walk.expanded.add(from.path);
  for (const target of importsOf(from.text)) {
    const path = toRepoPath(root, join(root, dirname(from.path), target));
    if (path.startsWith("..") || isAbsolute(path)) continue;
    const text = await readText(root, path);
    if (text === undefined) continue;
    const file = { path, text, importedBy: from.path };
    if (!walk.counted.has(path)) found.push(file);
    walk.counted.add(path);
    found.push(...(await followImports(root, file, walk, depth + 1)));
  }
  return found;
}

/** The always layer: the configured rules files, plus what each `CLAUDE.md` imports. */
async function readAlways(root: string, paths: readonly string[]): Promise<ContextFile[]> {
  const configured = await readConfigured(root, paths);
  const walk = {
    counted: new Set(configured.map((file) => file.path)),
    expanded: new Set<string>(),
  };
  const imported: ContextFile[] = [];
  for (const file of configured.filter((f) => basename(f.path) === "CLAUDE.md")) {
    imported.push(...(await followImports(root, file, walk)));
  }
  return [...configured, ...imported];
}

/** Every path in the «Read first» lists of the start files, with what reading it costs. */
async function readReadingList(root: string, start: readonly ContextFile[]) {
  const items: ReadingItem[] = [];
  const paths = start.flatMap((file) => readingList(file.text, posix.dirname(file.path)));
  for (const path of new Set(paths)) {
    const { exists, text } = await readEntry(root, path);
    items.push({ path, exists, tokens: text === undefined ? 0 : estimateTokens(text) });
  }
  return items;
}

const n = (value: number): string => value.toLocaleString("en-US");

/** A heading short enough to keep the report readable; the JSON keeps it whole. */
const short = (heading: string): string =>
  heading.length > 60 ? `${heading.slice(0, 59)}…` : heading;

function formatLayer(layer: LayerReport, title: string): string[] {
  const verdict = layer.over ? `over by ${n(layer.tokens - layer.budget)}` : "ok";
  const lines = [`${title}: ${n(layer.tokens)} / ${n(layer.budget)} tokens · ${verdict}`];
  if (layer.files.length === 0) lines.push("    (none of the configured files exists)");
  for (const file of layer.files) {
    const from = file.importedBy ? `  (imported by ${file.importedBy})` : "";
    lines.push(`    ${file.path}  ${n(file.tokens)}${from}`);
    if (file.largest.length > 0) {
      lines.push("        largest sections:");
      for (const s of file.largest)
        lines.push(`          ${n(s.tokens).padStart(7)}  ${short(s.heading)}`);
    }
  }
  return lines;
}

function formatReading(items: readonly ReadingItem[]): string[] {
  if (items.length === 0) return [];
  const total = items.reduce((sum, item) => sum + item.tokens, 0);
  const missing = items.filter((item) => !item.exists).map((item) => item.path);
  return [
    `Read first (next session): ${items.length} path(s), ${n(total)} tokens`,
    ...(missing.length > 0 ? [`    missing: ${missing.join(", ")}`] : []),
  ];
}

/** `aidt context check [--json]`: exit 1 when a layer is over budget or a path to read is missing. */
async function check({ root, config, flags }: CliContext): Promise<number> {
  const { always: alwaysPaths, start: startPaths, budget } = config.context;
  const startFiles = await readConfigured(root, startPaths);
  const layers = [
    measureLayer("always", await readAlways(root, alwaysPaths), budget.always),
    measureLayer("start", startFiles, budget.start),
  ];
  const reading = await readReadingList(root, startFiles);
  const failed = layers.some((layer) => layer.over) || reading.some((item) => !item.exists);
  const [always, start] = layers as [LayerReport, LayerReport];
  print(
    flags.json
      ? JSON.stringify({ layers, reading, failed }, null, 2)
      : [
          ...formatLayer(always, "Always (loaded by the tool)"),
          ...formatLayer(start, "Start (read first, every session)"),
          ...formatReading(reading),
          "",
          "Tokens ≈ characters / 4. Layers and how to trim them: .aidt/practices/session-context.md",
        ].join("\n"),
  );
  return failed ? 1 : 0;
}

/** `aidt context <action>`. */
export async function contextCommand(
  context: CliContext,
  action: string | undefined,
): Promise<number> {
  if (action === "check") return check(context);
  throw new UsageError(`Unknown context action "${action ?? ""}". Use: aidt context check`);
}
