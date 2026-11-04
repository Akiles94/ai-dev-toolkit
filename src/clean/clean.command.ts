import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectDiff, type DiffSource, type DiffSummary } from "../shared/changes/changes.ts";
import { type CliContext, print, resolveSource } from "../shared/cli/cli-context.ts";
import { isMarkdown, stripGuides } from "./guide-comments.ts";

interface CleanResult {
  files: { path: string; removed: number }[];
  total: number;
}

/** Files worth scanning: changed code, tests and config that are text. */
function cleanTargets(summary: DiffSummary): string[] {
  const scanned = new Set(["code", "test", "config"]);
  return summary.files.filter((f) => !f.binary && scanned.has(f.category)).map((f) => f.path);
}

type OnGuidesFound = (absolutePath: string, cleanContent: string) => Promise<void>;

async function scan(
  root: string,
  paths: readonly string[],
  marker: string,
  onGuidesFound: OnGuidesFound,
): Promise<CleanResult> {
  const files: CleanResult["files"] = [];
  for (const path of paths) {
    const absolute = join(root, path);
    const content = await readFile(absolute, "utf8").catch(() => undefined);
    if (content === undefined) continue; // Deleted in this diff: nothing to clean.
    const result = stripGuides(content, marker, { skipFences: isMarkdown(path) });
    if (result.removed === 0) continue;
    await onGuidesFound(absolute, result.content);
    files.push({ path, removed: result.removed });
  }
  return { files, total: files.reduce((sum, f) => sum + f.removed, 0) };
}

/** Reports guide comments in `paths` without changing any file: the `clean --check` gate. */
function findGuides(root: string, paths: readonly string[], marker: string) {
  return scan(root, paths, marker, async () => {});
}

/** Removes guide comments from `paths`, leaving every other comment intact. */
function removeGuides(root: string, paths: readonly string[], marker: string) {
  return scan(root, paths, marker, (absolute, content) => writeFile(absolute, content));
}

function formatClean(result: CleanResult, action: "Found" | "Removed"): string {
  if (result.total === 0) return "No guide comments found.";
  const lines = result.files.map((f) => `    ${f.path}  ${f.removed}`);
  const header = `${action} ${result.total} guide comment line(s) in ${result.files.length} file(s):`;
  return [header, ...lines].join("\n");
}

/**
 * Paths to clean when none are given: the changed files of the chosen source. Without an explicit
 * source, the branch diff plus the uncommitted changes, where guide comments usually live.
 */
async function changedPaths({ root, config, flags }: CliContext): Promise<string[]> {
  const explicit = flags.base || flags.staged || flags.worktree;
  const sources: DiffSource[] = [await resolveSource(root, flags)];
  if (!explicit) sources.push({ kind: "worktree" });
  const summaries = await Promise.all(sources.map((s) => collectDiff(root, s, config)));
  return [...new Set(summaries.flatMap(cleanTargets))];
}

/** `aidt clean`: removes guide comments, or with `--check` reports them and exits 1. */
export async function cleanCommand(context: CliContext, givenPaths: string[]): Promise<number> {
  const paths = givenPaths.length > 0 ? givenPaths : await changedPaths(context);
  const { root, config, flags } = context;
  if (!flags.check) {
    return print(formatClean(await removeGuides(root, paths, config.guide.marker), "Removed"));
  }
  const found = await findGuides(root, paths, config.guide.marker);
  print(formatClean(found, "Found"));
  return found.total > 0 ? 1 : 0;
}
