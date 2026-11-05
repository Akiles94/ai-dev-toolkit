#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { clean, cleanTargets, formatClean } from "./commands/clean.ts";
import { formatDiff } from "./commands/diff.ts";
import { loadConfig } from "./core/config.ts";
import { collectDiff, type DiffSource } from "./core/diff.ts";
import { defaultBranch, GitError, repoRoot } from "./core/git.ts";

const HELP = `aidt: AI Dev Toolkit

Usage
  aidt diff  [source] [--files] [--json]   Diff stats with noise filtered
  aidt clean [paths…] [source] [--check]   Remove guide comments (--check: report, exit 1 if any)

Source (default: <default branch>...HEAD)
  --base <ref>    Compare against <ref> (merge-base, like a PR)
  --head <ref>    Head of the range (default: HEAD)
  --staged        Staged changes only
  --worktree      Uncommitted changes, including untracked files

Other
  -h, --help      Show this help
  -v, --version   Show the version

Exit codes: 0 ok · 1 findings (clean --check) · 2 usage or git error`;

class UsageError extends Error {}

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return String(pkg.version);
}

async function resolveSource(
  cwd: string,
  flags: {
    base?: string | undefined;
    head?: string | undefined;
    staged?: boolean | undefined;
    worktree?: boolean | undefined;
  },
): Promise<DiffSource> {
  if (flags.staged && flags.worktree) throw new UsageError("Use either --staged or --worktree.");
  if (flags.staged) return { kind: "staged" };
  if (flags.worktree) return { kind: "worktree" };
  const base = flags.base ?? (await defaultBranch(cwd));
  return { kind: "range", base, head: flags.head ?? "HEAD" };
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      base: { type: "string" },
      head: { type: "string" },
      staged: { type: "boolean" },
      worktree: { type: "boolean" },
      files: { type: "boolean" },
      json: { type: "boolean" },
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const [command, ...rest] = positionals;

  if (values.version) return print(version());
  if (values.help || !command) return print(HELP);

  const root = await repoRoot(process.cwd());
  const config = await loadConfig(root);

  switch (command) {
    case "diff": {
      const summary = await collectDiff(root, await resolveSource(root, values), config);
      return print(
        values.json
          ? JSON.stringify(summary, null, 2)
          : formatDiff(summary, config.limits.sectionLines, values.files ?? false),
      );
    }
    case "clean": {
      let paths = rest;
      if (paths.length === 0) {
        const explicit = values.base || values.staged || values.worktree;
        const sources = explicit
          ? [await resolveSource(root, values)]
          : [await resolveSource(root, values), { kind: "worktree" } as const];
        const summaries = await Promise.all(sources.map((s) => collectDiff(root, s, config)));
        paths = [...new Set(summaries.flatMap(cleanTargets))];
      }
      const write = !values.check;
      const result = await clean(root, paths, config.guide.marker, write);
      print(formatClean(result, write));
      return values.check && result.total > 0 ? 1 : 0;
    }
    default:
      throw new UsageError(`Unknown command "${command}". Run aidt --help.`);
  }
}

function print(text: string): number {
  process.stdout.write(`${text}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const known =
      error instanceof GitError || error instanceof UsageError || error instanceof TypeError;
    process.stderr.write(`aidt: ${known ? (error as Error).message : String(error)}\n`);
    process.exitCode = 2;
  },
);
