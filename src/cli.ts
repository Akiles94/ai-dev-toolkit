#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { addCommand } from "./add/add.command.ts";
import { checkCommand } from "./check/check.command.ts";
import { cleanCommand } from "./clean/clean.command.ts";
import { diffCommand } from "./diff/diff.command.ts";
import { type CliContext, print, UsageError } from "./shared/cli/cli-context.ts";
import { loadConfig } from "./shared/config/config.ts";
import { GitError, repoRoot } from "./shared/git/git.ts";
import { stackCommand } from "./stack/stack.command.ts";
import { structureCommand } from "./structure/structure.command.ts";
import { syncCommand } from "./sync/sync.command.ts";
import { walkthroughCommand } from "./walkthrough/walkthrough.command.ts";

// Delivery: parses the command line, builds the context and runs one command. Flows never call
// each other; when a command needs another (add → sync), it is chained here.

const HELP = `aidt: AI Dev Toolkit

Usage
  aidt add   <product|agent>               Copy into .aidt/ and sync: a product (workflow, structure)
                                           or one agent alone (refiner, reviewer, walkthrough)
  aidt diff  [source] [--files] [--json]   Diff stats with noise filtered
  aidt sync  [--from <dir>] [--check]      Render the canonical agents for each AI tool
                                           (--check: exit 1 if generated files are out of date)
  aidt clean [paths…] [source] [--check]   Remove guide comments (--check: report, exit 1 if any)
  aidt check [--base <ref>] [--json]       Task gates: section sizes, every requirement has a test
  aidt stack prepare [--base <trunk>]      One local branch per reviewed section (pushes nothing)
  aidt stack submit  [--dry-run]           Push them and open one draft PR per section (gh, glab)
  aidt structure audit [--json]            Check the common structure rules (exit 1 if broken)
  aidt walkthrough plan [source] [--json]  Split a large change into sections to review in order
  aidt walkthrough start <ref> [name]      Check <ref> out in an ignored worktree and plan it
                       [--base <ref>]      (under .aidt/walkthrough/; nothing is committed)
  aidt walkthrough finish <name>           Remove that worktree and the comments written in it

Source (default: <default branch>...HEAD)
  --base <ref>    Compare against <ref> (merge-base, like a PR)
  --head <ref>    Head of the range (default: HEAD)
  --staged        Staged changes only
  --worktree      Uncommitted changes, including untracked files

Other
  -h, --help      Show this help
  -v, --version   Show the version

Exit codes: 0 ok · 1 findings (--check, invalid agents, stack not ready) · 2 usage or git error`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  return String(pkg.version);
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
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

/** `add` copies the product, then the agents are rendered with the config it may have created. */
async function addThenSync(context: CliContext, product: string | undefined): Promise<number> {
  const added = await addCommand(context, product);
  if (added !== 0) return added;
  return syncCommand({ ...context, config: await loadConfig(context.root) });
}

async function main(argv: string[]): Promise<number> {
  const { values: flags, positionals } = parseCli(argv);
  const [command, ...rest] = positionals;
  if (flags.version) return print(version());
  if (flags.help || !command) return print(HELP);

  const root = await repoRoot(process.cwd());
  const context: CliContext = { root, config: await loadConfig(root), flags };
  if (command === "diff") return diffCommand(context);
  if (command === "clean") return cleanCommand(context, rest);
  if (command === "check") return checkCommand(context);
  if (command === "sync") return syncCommand(context);
  if (command === "add") return addThenSync(context, rest[0]);
  if (command === "stack") return stackCommand(context, rest[0]);
  if (command === "structure") return structureCommand(context, rest[0]);
  if (command === "walkthrough") return walkthroughCommand(context, rest);
  throw new UsageError(`Unknown command "${command}". Run aidt --help.`);
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
