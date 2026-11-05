import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DiffSummary } from "../core/diff.ts";
import { isMarkdown, stripGuides } from "../core/guide.ts";

export interface CleanResult {
  files: { path: string; removed: number }[];
  total: number;
}

/** Files worth scanning: changed code, tests and config that are text. */
export function cleanTargets(summary: DiffSummary): string[] {
  const scanned = new Set(["code", "test", "config"]);
  return summary.files.filter((f) => !f.binary && scanned.has(f.category)).map((f) => f.path);
}

/**
 * Removes guide comments from `paths` (relative to `root`). With `write: false` it only counts
 * them, which is how `aidt clean --check` works as a gate.
 */
export async function clean(
  root: string,
  paths: readonly string[],
  marker: string,
  write: boolean,
): Promise<CleanResult> {
  const files: CleanResult["files"] = [];
  for (const path of paths) {
    const absolute = join(root, path);
    let content: string;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      continue; // Deleted in this diff: nothing to clean.
    }
    const result = stripGuides(content, marker, { skipFences: isMarkdown(path) });
    if (result.removed === 0) continue;
    if (write) await writeFile(absolute, result.content);
    files.push({ path, removed: result.removed });
  }
  return { files, total: files.reduce((sum, f) => sum + f.removed, 0) };
}

export function formatClean(result: CleanResult, write: boolean): string {
  if (result.total === 0) return "No guide comments found.";
  const verb = write ? "Removed" : "Found";
  const lines = result.files.map((f) => `    ${f.path}  ${f.removed}`);
  const header = `${verb} ${result.total} guide comment line(s) in ${result.files.length} file(s):`;
  return [header, ...lines].join("\n");
}
