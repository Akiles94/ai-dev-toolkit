import { readFile } from "node:fs/promises";
import { join, matchesGlob } from "node:path";
import type { AidtConfig } from "./config.ts";
import { git } from "./git.ts";

/** What to compare. `range` uses merge-base semantics (`base...head`), like a PR. */
export type DiffSource =
  | { kind: "range"; base: string; head: string }
  | { kind: "staged" }
  | { kind: "worktree" };

/**
 * - `code`: production lines, the ones that count toward section limits.
 * - `test`: test files, reported apart.
 * - `config`: tooling configuration (package.json, tsconfig, CI…), reported apart.
 * - `noise`: lockfiles, generated, snapshots, build output (config `limits.exclude`).
 * - `formatting`: only whitespace changed.
 */
export type FileCategory = "code" | "test" | "config" | "noise" | "formatting";

export interface RawChange {
  path: string;
  oldPath?: string;
  added: number;
  deleted: number;
  binary: boolean;
}

export interface FileChange extends RawChange {
  category: FileCategory;
}

export interface CategoryTotals {
  files: number;
  added: number;
  deleted: number;
}

export interface DiffSummary {
  source: string;
  files: FileChange[];
  totals: Record<FileCategory, CategoryTotals>;
}

export function describeSource(source: DiffSource): string {
  if (source.kind === "range") return `${source.base}...${source.head}`;
  return source.kind === "staged" ? "staged changes" : "working tree (vs HEAD)";
}

function sourceArgs(source: DiffSource): string[] {
  if (source.kind === "range") return [`${source.base}...${source.head}`];
  return source.kind === "staged" ? ["--cached"] : ["HEAD"];
}

/**
 * Parses `git diff --numstat -z`. Each entry is `added\tdeleted\tpath\0`, or for a rename
 * `added\tdeleted\t\0old\0new\0`. Binary files report `-` for both counts.
 */
export function parseNumstat(output: string): RawChange[] {
  const tokens = output.split("\0");
  const changes: RawChange[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const [added = "", deleted = "", path = ""] = token.split("\t");
    const binary = added === "-" && deleted === "-";
    const counts = { added: binary ? 0 : Number(added), deleted: binary ? 0 : Number(deleted) };
    if (path) {
      changes.push({ path, ...counts, binary });
    } else {
      const oldPath = tokens[++i] ?? "";
      const newPath = tokens[++i] ?? "";
      changes.push({ path: newPath, oldPath, ...counts, binary });
    }
  }
  return changes;
}

function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

/**
 * Assigns a category to each change. `withoutWhitespace` is the same diff computed with
 * whitespace ignored: a file that changed but has no lines there only changed formatting.
 */
export function classify(
  changes: readonly RawChange[],
  withoutWhitespace: ReadonlyMap<string, number>,
  config: AidtConfig,
): FileChange[] {
  return changes.map((change) => {
    let category: FileCategory;
    if (matchesAny(change.path, config.limits.exclude)) category = "noise";
    else if (matchesAny(change.path, config.tests.patterns)) category = "test";
    else if (matchesAny(change.path, config.configFiles.patterns)) category = "config";
    else if (
      !change.binary &&
      change.added + change.deleted > 0 &&
      (withoutWhitespace.get(change.path) ?? 0) === 0
    ) {
      category = "formatting";
    } else category = "code";
    return { ...change, category };
  });
}

export function summarize(source: string, files: FileChange[]): DiffSummary {
  const empty = (): CategoryTotals => ({ files: 0, added: 0, deleted: 0 });
  const totals = {
    code: empty(),
    test: empty(),
    config: empty(),
    noise: empty(),
    formatting: empty(),
  };
  for (const file of files) {
    const bucket = totals[file.category];
    bucket.files += 1;
    bucket.added += file.added;
    bucket.deleted += file.deleted;
  }
  return { source, files, totals };
}

async function untrackedChanges(cwd: string): Promise<RawChange[]> {
  const listed = await git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = listed.split("\0").filter(Boolean);
  return Promise.all(
    paths.map(async (path) => {
      const content = await readFile(join(cwd, path));
      if (content.includes(0)) return { path, added: 0, deleted: 0, binary: true };
      const text = content.toString("utf8");
      const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
      return { path, added: lines, deleted: 0, binary: false };
    }),
  );
}

/** Collects and classifies every change in `source`. Untracked files count in worktree mode. */
export async function collectDiff(
  cwd: string,
  source: DiffSource,
  config: AidtConfig,
): Promise<DiffSummary> {
  const base = ["diff", "--numstat", "-z", "-M", ...sourceArgs(source)];
  const [all, ignoringWhitespace] = await Promise.all([
    git(cwd, base),
    git(cwd, [...base, "-w", "--ignore-blank-lines"]),
  ]);
  const changes = parseNumstat(all);
  const withoutWhitespace = new Map(
    parseNumstat(ignoringWhitespace).map((c) => [c.path, c.added + c.deleted]),
  );
  if (source.kind === "worktree") {
    // Untracked files are absent from both diffs: their whole content is the change.
    for (const change of await untrackedChanges(cwd)) {
      changes.push(change);
      withoutWhitespace.set(change.path, change.added);
    }
  }
  return summarize(describeSource(source), classify(changes, withoutWhitespace, config));
}
