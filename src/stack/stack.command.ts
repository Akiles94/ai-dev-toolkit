import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type CliContext, print, UsageError } from "../shared/cli-context.ts";
import { defaultBranch, git } from "../shared/git.ts";
import { readTaskState, type TaskState, taskDir, writeTaskState } from "../shared/task-state.ts";
import { buildStackPlan, type SectionMaterial, type StackEntry } from "./stack-plan.ts";

const isAncestor = (root: string, older: string, newer: string): Promise<boolean> =>
  git(root, ["merge-base", "--is-ancestor", older, newer]).then(
    () => true,
    () => false,
  );

const branchCommit = (root: string, branch: string): Promise<string | undefined> =>
  git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]).then(
    (sha) => sha.trim(),
    () => undefined,
  );

/** Each section's commit subject and review guide (`review/s01-*.md`). */
async function loadMaterials(
  root: string,
  state: TaskState,
): Promise<Map<string, SectionMaterial>> {
  const reviewDir = join(root, taskDir(state.branch), "review");
  const guides = await readdir(reviewDir).catch(() => [] as string[]);
  const materials = new Map<string, SectionMaterial>();
  for (const section of state.sections) {
    const prefix = `s${section.id.slice(1).padStart(2, "0")}-`;
    const file = guides.find((name) => name.startsWith(prefix) && name.endsWith(".md"));
    const guide = file ? await readFile(join(reviewDir, file), "utf8") : undefined;
    const subject = section.commit
      ? (await git(root, ["log", "-1", "--format=%s", section.commit])).trim()
      : section.name;
    materials.set(section.id, { subject, guide });
  }
  return materials;
}

/** Sections must sit one on top of the other, in order, ending on the task branch. */
async function orderProblems(root: string, entries: StackEntry[], head: string): Promise<string[]> {
  const problems: string[] = [];
  const commits = [...entries.map((e) => e.commit), head];
  for (let i = 0; i + 1 < commits.length; i++) {
    if (!(await isAncestor(root, commits[i] as string, commits[i + 1] as string))) {
      const next = entries[i + 1]?.id ?? "the task branch";
      problems.push(`${entries[i]?.id} (${commits[i]}) is not below ${next}: rebase in order`);
    }
  }
  return problems;
}

/** A branch that already exists elsewhere is never moved: that could drop someone's work. */
async function createBranches(root: string, entries: StackEntry[]): Promise<string[]> {
  const missing: StackEntry[] = [];
  const problems: string[] = [];
  for (const entry of entries) {
    const existing = await branchCommit(root, entry.branch);
    const wanted = (await git(root, ["rev-parse", `${entry.commit}^{commit}`])).trim();
    if (existing === undefined) missing.push({ ...entry, commit: wanted });
    else if (existing !== wanted) {
      problems.push(`${entry.branch} already exists at another commit: delete or rename it`);
    }
  }
  if (problems.length > 0) return problems;
  for (const entry of missing) await git(root, ["branch", entry.branch, entry.commit]);
  return [];
}

function formatPrepare(entries: StackEntry[], trunk: string): string {
  const lines = entries.map(
    (e, i) => `  ${i + 1}. ${e.branch}  →  ${e.base}\n     ${e.commit.slice(0, 7)} ${e.title}`,
  );
  return [
    `Stack ready (${entries.length} PRs on ${trunk}). Nothing was pushed.`,
    ...lines,
    "",
    "Next: aidt stack submit",
  ].join("\n");
}

const fail = (problems: string[]): number => {
  process.stderr.write(
    `Cannot prepare the stack:\n${problems.map((p) => `  - ${p}`).join("\n")}\n`,
  );
  return 1;
};

/**
 * `aidt stack prepare`: one local branch per reviewed section, chained, and recorded in
 * `state.json`. Publishes nothing; `aidt stack submit` does that after an explicit yes.
 */
async function prepare(context: CliContext): Promise<number> {
  const { root, flags } = context;
  const head = (await git(root, ["branch", "--show-current"])).trim();
  const state = await readTaskState(root, head);
  if (!state) throw new UsageError(`No task for branch "${head}" (.aidt/tasks/…/state.json).`);

  const trunk = (flags.base ?? (await defaultBranch(root))).replace(/^origin\//, "");
  const plan = buildStackPlan(state, trunk, await loadMaterials(root, state));
  if (!plan.ok) return fail(plan.error);

  const problems = await orderProblems(root, plan.value, head);
  if (problems.length > 0) return fail(problems);
  const conflicts = await createBranches(root, plan.value);
  if (conflicts.length > 0) return fail(conflicts);

  const branches = new Map(plan.value.map((e) => [e.id, e.branch]));
  state.sections = state.sections.map((s) => ({ ...s, branch: branches.get(s.id) as string }));
  state.delivery = { ...state.delivery, mode: "stack" };
  state.phase = "deliver";
  await writeTaskState(root, state);
  return print(formatPrepare(plan.value, trunk));
}

/** `aidt stack <prepare|submit>`. */
export async function stackCommand(
  context: CliContext,
  action: string | undefined,
): Promise<number> {
  if (action === "prepare") return prepare(context);
  throw new UsageError(`Unknown stack action "${action ?? ""}". Use: aidt stack prepare`);
}
