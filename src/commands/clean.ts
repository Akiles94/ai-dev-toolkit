import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiffSummary } from "../core/diff.ts";
import { isMarkdown, stripGuides } from "../core/guide.ts";

interface CleanResult {
  files: { path: string; removed: number }[];
  total: number;
}

/** Files worth scanning: changed code, tests and config that are text. */
export function cleanTargets(summary: DiffSummary): string[] {
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
export function findGuides(root: string, paths: readonly string[], marker: string) {
  return scan(root, paths, marker, async () => {});
}

/** Removes guide comments from `paths`, leaving every other comment intact. */
export function removeGuides(root: string, paths: readonly string[], marker: string) {
  return scan(root, paths, marker, (absolute, content) => writeFile(absolute, content));
}

export function formatClean(result: CleanResult, action: "Found" | "Removed"): string {
  if (result.total === 0) return "No guide comments found.";
  const lines = result.files.map((f) => `    ${f.path}  ${f.removed}`);
  const header = `${action} ${result.total} guide comment line(s) in ${result.files.length} file(s):`;
  return [header, ...lines].join("\n");
}
