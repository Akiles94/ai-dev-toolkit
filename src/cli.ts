#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { cleanTargets, findGuides, formatClean, removeGuides } from "./commands/clean.ts";
import { formatDiff } from "./commands/diff.ts";
import { formatStale, formatSync, planSync, staleFiles, writeSync } from "./commands/sync.ts";
import { type AidtConfig, loadConfig } from "./core/config.ts";
import { collectDiff, type DiffSource } from "./core/diff.ts";
import { defaultBranch, GitError, repoRoot } from "./core/git.ts";

const HELP = `aidt: AI Dev Toolkit

Usage
  aidt diff  [source] [--files] [--json]   Diff stats with noise filtered
  aidt sync  [--from <dir>] [--check]      Render the canonical agents for each AI tool
                                           (--check: exit 1 if generated files are out of date)
  aidt clean [paths…] [source] [--check]   Remove guide comments (--check: report, exit 1 if any)

Source (default: <default branch>...HEAD)
  --base <ref>    Compare against <ref> (merge-base, like a PR)
  --head <ref>    Head of the range (default: HEAD)
  --staged        Staged changes only
  --worktree      Uncommitted changes, including untracked files

Other
  -h, --help      Show this help
  -v, --version   Show the version

Exit codes: 0 ok · 1 findings (--check, invalid agents) · 2 usage or git error`;

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

function parseCli(argv: string[]) {
  return parseArgs({
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
      from: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

type Flags = ReturnType<typeof parseCli>["values"];

interface Context {
  root: string;
  config: AidtConfig;
  flags: Flags;
}

async function runDiff({ root, config, flags }: Context): Promise<number> {
  const summary = await collectDiff(root, await resolveSource(root, flags), config);
  if (flags.json) return print(JSON.stringify(summary, null, 2));
  return print(
    formatDiff(summary, {
      sectionLines: config.limits.sectionLines,
      listCodeFiles: flags.files ?? false,
    }),
  );
}

/**
 * Paths to clean when none are given: the changed files of the chosen source. Without an explicit
 * source, the branch diff plus the uncommitted changes, where guide comments usually live.
 */
async function changedPaths({ root, config, flags }: Context): Promise<string[]> {
  const explicit = flags.base || flags.staged || flags.worktree;
  const sources: DiffSource[] = [await resolveSource(root, flags)];
  if (!explicit) sources.push({ kind: "worktree" });
  const summaries = await Promise.all(sources.map((s) => collectDiff(root, s, config)));
  return [...new Set(summaries.flatMap(cleanTargets))];
}

async function runClean(context: Context, givenPaths: string[]): Promise<number> {
  const paths = givenPaths.length > 0 ? givenPaths : await changedPaths(context);
  const { root, config, flags } = context;
  if (!flags.check) {
    return print(formatClean(await removeGuides(root, paths, config.guide.marker), "Removed"));
  }
  const found = await findGuides(root, paths, config.guide.marker);
  print(formatClean(found, "Found"));
  return found.total > 0 ? 1 : 0;
}

async function runSync({ root, config, flags }: Context): Promise<number> {
  const plan = await planSync(root, flags.from ?? config.sync.agents, config.sync.harnesses);
  if (plan.problems.length > 0) {
    print(formatSync(plan));
    return 1;
  }
  if (flags.check) {
    const stale = await staleFiles(root, plan.files);
    print(formatStale(stale));
    return stale.length > 0 ? 1 : 0;
  }
  await writeSync(root, plan.files);
  return print(formatSync(plan));
}

async function main(argv: string[]): Promise<number> {
  const { values: flags, positionals } = parseCli(argv);
  const [command, ...rest] = positionals;
  if (flags.version) return print(version());
  if (flags.help || !command) return print(HELP);

  const root = await repoRoot(process.cwd());
  const context = { root, config: await loadConfig(root), flags };
  if (command === "diff") return runDiff(context);
  if (command === "clean") return runClean(context, rest);
  if (command === "sync") return runSync(context);
  throw new UsageError(`Unknown command "${command}". Run aidt --help.`);
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
