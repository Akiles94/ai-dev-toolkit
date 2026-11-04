import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { UsageError } from "../shared/cli-context.ts";
import { defaultBranch, git } from "../shared/git.ts";
import { fail, ok, type Result } from "../shared/result.ts";
import { readTaskState, type TaskState, taskDir } from "../shared/task-state.ts";
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

/** Section branches not created yet, and those that exist at another commit (never moved). */
async function branchProblems(root: string, entries: StackEntry[]) {
  const missing: StackEntry[] = [];
  const problems: string[] = [];
  for (const entry of entries) {
    const existing = await branchCommit(root, entry.branch);
    if (existing === undefined) missing.push(entry);
    else if (existing !== entry.commit) {
      problems.push(`${entry.branch} already exists at another commit: delete or rename it`);
    }
  }
  return { missing, problems };
}

/** A reviewed task turned into a stack, checked against the repository. */
interface LocalStack {
  readonly state: TaskState;
  readonly trunk: string;
  readonly entries: StackEntry[];
  /** Section branches that `aidt stack prepare` still has to create. */
  readonly missing: StackEntry[];
}

/** Full commit ids, so branches are compared and created exactly. */
async function resolveCommits(root: string, entries: StackEntry[]): Promise<StackEntry[]> {
  const resolved: StackEntry[] = [];
  for (const e of entries) {
    resolved.push({
      ...e,
      commit: (await git(root, ["rev-parse", `${e.commit}^{commit}`])).trim(),
    });
  }
  return resolved;
}

/**
 * The stack of the task on the current branch, refused unless every section passed review, the
 * commits sit in order and no section branch points elsewhere. Shared by `prepare` and `submit`.
 */
export async function loadLocalStack(
  root: string,
  base: string | undefined,
): Promise<Result<LocalStack, string[]>> {
  const head = (await git(root, ["branch", "--show-current"])).trim();
  const state = await readTaskState(root, head);
  if (!state) throw new UsageError(`No task for branch "${head}" (.aidt/tasks/…/state.json).`);

  const trunk = (base ?? (await defaultBranch(root))).replace(/^origin\//, "");
  const plan = buildStackPlan(state, trunk, await loadMaterials(root, state));
  if (!plan.ok) return plan;
  const entries = await resolveCommits(root, plan.value);
  const order = await orderProblems(root, entries, head);
  if (order.length > 0) return fail(order);
  const { missing, problems } = await branchProblems(root, entries);
  return problems.length > 0 ? fail(problems) : ok({ state, trunk, entries, missing });
}

/** Creates the missing section branches at their commits. */
export async function createBranches(root: string, missing: StackEntry[]): Promise<void> {
  for (const entry of missing) await git(root, ["branch", entry.branch, entry.commit]);
}
