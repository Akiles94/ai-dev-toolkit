import { join } from "node:path";
import { collectDiff, type DiffSource, type FileChange } from "../shared/changes/changes.ts";
import { type CliContext, print, resolveSource, UsageError } from "../shared/cli/cli-context.ts";
import { defaultBranch } from "../shared/git/git.ts";
import { closeWorktree, openWorktree } from "./review-worktree.ts";
import {
  planWalkthrough,
  type WalkthroughPlan,
  type WalkthroughSection,
} from "./walkthrough-plan.ts";

function fileLine(file: FileChange): string {
  const size = file.binary ? "binary" : `+${file.added} −${file.deleted}`;
  const tag = file.category === "code" ? "" : `  (${file.category})`;
  return `    ${file.path}  ${size}${tag}`;
}

function sectionBlock(section: WalkthroughSection): string[] {
  const tests = section.testLines > 0 ? ` + ${section.testLines} test` : "";
  const warning = section.oversized ? " · one file over the limit: split it by hunks" : "";
  return [
    `${section.id}  ${section.title}  (${section.lines} lines${tests}${warning})`,
    ...section.files.map(fileLine),
    "",
  ];
}

function formatPlan(source: string, plan: WalkthroughPlan): string {
  const lines = plan.sections.reduce((sum, s) => sum + s.lines, 0);
  const count = plan.sections.length;
  const skipped =
    plan.skipped.length === 0
      ? []
      : [`Skipped (noise, formatting): ${plan.skipped.length}`, ...plan.skipped.map(fileLine)];
  return [
    `Source: ${source}`,
    `Walkthrough: ${count} section${count === 1 ? "" : "s"} · ${lines} lines · limit ${plan.limit} per section`,
    "",
    ...plan.sections.flatMap(sectionBlock),
    ...skipped,
  ]
    .join("\n")
    .trimEnd();
}

async function printPlan(
  { config, flags }: CliContext,
  cwd: string,
  source: DiffSource,
  worktree?: string,
): Promise<number> {
  const summary = await collectDiff(cwd, source, config);
  const plan = planWalkthrough(summary.files, config.limits.sectionLines);
  const where = worktree ? { worktree } : {};
  if (flags.json) {
    return print(JSON.stringify({ ...where, source: summary.source, ...plan }, null, 2));
  }
  const header = worktree ? [`Worktree: ${worktree} (ignored by git, removed by finish)`] : [];
  return print([...header, formatPlan(summary.source, plan)].join("\n"));
}

const USAGE = "Use: aidt walkthrough plan | start <ref> [name] | finish <name>.";

/**
 * `aidt walkthrough`: `plan` splits a change into sections to review in order; `start` checks a
 * change out in its own ignored worktree (where the agent writes guide comments) and plans it;
 * `finish` removes that worktree with everything written in it.
 */
export async function walkthroughCommand(
  context: CliContext,
  [subcommand, ref, name]: string[],
): Promise<number> {
  const { root, flags } = context;
  if (subcommand === "plan") return printPlan(context, root, await resolveSource(root, flags));
  if (subcommand === "start" && ref) {
    const base = flags.base ?? (await defaultBranch(root));
    const worktree = await openWorktree(root, ref, name ?? ref);
    const source: DiffSource = { kind: "range", base, head: "HEAD" };
    return printPlan(context, join(root, worktree), source, worktree);
  }
  if (subcommand === "finish" && ref) {
    return print(`Removed ${await closeWorktree(root, ref)}`);
  }
  throw new UsageError(`Unknown walkthrough command "${subcommand ?? ""}". ${USAGE}`);
}
