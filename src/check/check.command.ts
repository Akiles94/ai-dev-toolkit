import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { collectDiff, type DiffSummary } from "../shared/changes/changes.ts";
import { type CliContext, print, UsageError } from "../shared/cli/cli-context.ts";
import { defaultBranch, git } from "../shared/git/git.ts";
import { readTaskState, type TaskState, taskDir } from "../shared/task/task-state.ts";
import { requirementIds, untestedRequirements } from "./requirement-tests.ts";

interface SectionSize {
  readonly id: string;
  readonly lines: number;
}

interface CheckReport {
  readonly limit: number;
  readonly sections: SectionSize[];
  readonly requirements: string[];
  readonly untested: string[];
}

const reviewable = (summary: DiffSummary): number =>
  summary.totals.code.added + summary.totals.code.deleted;

/** Reviewable lines of each committed section, plus the uncommitted work as the current one. */
async function sectionSizes(
  { root, config }: CliContext,
  state: TaskState,
): Promise<SectionSize[]> {
  const sizes: SectionSize[] = [];
  for (const section of state.sections) {
    if (!section.commit) continue;
    const range = { kind: "range", base: `${section.commit}^`, head: section.commit } as const;
    sizes.push({ id: section.id, lines: reviewable(await collectDiff(root, range, config)) });
  }
  const pending = reviewable(await collectDiff(root, { kind: "worktree" }, config));
  if (pending > 0) sizes.push({ id: "uncommitted", lines: pending });
  return sizes;
}

/** The content of every test file the task added or changed, committed or not. */
async function taskTests({ root, config, flags }: CliContext): Promise<string[]> {
  const base = flags.base ?? (await defaultBranch(root));
  const committed = await collectDiff(root, { kind: "range", base, head: "HEAD" }, config);
  const pending = await collectDiff(root, { kind: "worktree" }, config);
  const paths = new Set(
    [...committed.files, ...pending.files].filter((f) => f.category === "test").map((f) => f.path),
  );
  const texts = await Promise.all(
    [...paths].map((path) => readFile(join(root, path), "utf8").catch(() => "")),
  );
  return texts;
}

function formatCheck(report: CheckReport): string {
  const sizes = report.sections.map(
    (s) => `  ${s.lines > report.limit ? "✗" : "✓"} ${s.id}  ${s.lines} reviewable lines`,
  );
  const tested = report.requirements.length - report.untested.length;
  return [
    `Sections (limit ${report.limit} lines)`,
    ...(sizes.length > 0 ? sizes : ["  none committed yet"]),
    `Requirements with a test: ${tested}/${report.requirements.length}`,
    ...report.untested.map((id) => `  ✗ ${id} is not referenced by any test of this task`),
  ].join("\n");
}

/**
 * `aidt check [--json]`: the task's mechanical gates. Every section within the line limit and
 * every requirement of the spec referenced by a test. Exit 1 when either fails.
 */
export async function checkCommand(context: CliContext): Promise<number> {
  const { root, config, flags } = context;
  const head = (await git(root, ["branch", "--show-current"])).trim();
  const state = await readTaskState(root, head);
  if (!state) throw new UsageError(`No task for branch "${head}" (.aidt/tasks/…/state.json).`);

  const spec = await readFile(join(root, taskDir(head), "spec.md"), "utf8").catch(() => "");
  const requirements = requirementIds(spec);
  const report: CheckReport = {
    limit: config.limits.sectionLines,
    sections: await sectionSizes(context, state),
    requirements,
    untested: untestedRequirements(requirements, await taskTests(context)),
  };
  print(flags.json ? JSON.stringify(report, null, 2) : formatCheck(report));
  const oversized = report.sections.some((s) => s.lines > report.limit);
  return oversized || report.untested.length > 0 ? 1 : 0;
}
