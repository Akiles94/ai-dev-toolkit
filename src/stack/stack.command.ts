import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type CliContext, print, UsageError } from "../shared/cli-context.ts";
import { git } from "../shared/git.ts";
import { writeTaskState } from "../shared/task-state.ts";
import type { CommandRunner } from "./command-runner.port.ts";
import { createBranches, loadLocalStack } from "./local-stack.ts";
import type { StackEntry } from "./stack-plan.ts";
import { hostOf, type Published, publishStack } from "./stack-publisher.ts";

const exec = promisify(execFile);

/** Runs the real programs in the repository, without a shell. */
const processRunner =
  (root: string): CommandRunner =>
  async (command, args) =>
    (await exec(command, [...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 })).stdout;

/** Prints each command instead of running it; every lookup comes back empty. */
const dryRunner =
  (log: string[]): CommandRunner =>
  async (command, args) => {
    log.push(
      `  ${command} ${args.map((a) => (/^[\w./:=@-]+$/.test(a) ? a : JSON.stringify(a))).join(" ")}`,
    );
    return "";
  };

function refuse(action: string, problems: string[]): number {
  const list = problems.map((p) => `  - ${p}`).join("\n");
  process.stderr.write(`Cannot ${action} the stack:\n${list}\n`);
  return 1;
}

function formatPrepare(entries: StackEntry[], trunk: string): string {
  const lines = entries.map(
    (e, i) => `  ${i + 1}. ${e.branch}  →  ${e.base}\n     ${e.commit.slice(0, 7)} ${e.title}`,
  );
  return [
    `Stack ready (${entries.length} PR${entries.length === 1 ? "" : "s"} on ${trunk}). Nothing was pushed.`,
    ...lines,
    "",
    "Next: aidt stack submit",
  ].join("\n");
}

function formatSubmit(entries: StackEntry[], published: Published): string {
  const lines = entries.map((e) => `  ${e.id} ${e.branch}  ${published.prs.get(e.id) ?? ""}`);
  const notes = published.notes.map((n) => `  ! ${n}`);
  return [`Stack submitted with ${published.tool}: draft PRs, nothing merged.`, ...lines, ...notes]
    .join("\n")
    .trimEnd();
}

/**
 * `aidt stack prepare`: one local branch per reviewed section, chained, and recorded in
 * `state.json`. Publishes nothing; `aidt stack submit` does that after an explicit yes.
 */
async function prepare({ root, flags }: CliContext): Promise<number> {
  const stack = await loadLocalStack(root, flags.base);
  if (!stack.ok) return refuse("prepare", stack.error);
  const { state, trunk, entries, missing } = stack.value;
  await createBranches(root, missing);

  const branches = new Map(entries.map((e) => [e.id, e.branch]));
  state.sections = state.sections.map((s) => ({ ...s, branch: branches.get(s.id) as string }));
  state.delivery = { ...state.delivery, mode: "stack" };
  state.phase = "deliver";
  await writeTaskState(root, state);
  return print(formatPrepare(entries, trunk));
}

/**
 * `aidt stack submit [--dry-run]`: pushes the prepared branches and opens one draft PR per
 * section with the host's CLI (`gh`, `glab`), recording each PR in `state.json`.
 */
async function submit({ root, flags }: CliContext, runner?: CommandRunner): Promise<number> {
  const stack = await loadLocalStack(root, flags.base);
  if (!stack.ok) return refuse("submit", stack.error);
  const { state, entries, missing } = stack.value;
  if (missing.length > 0) return refuse("submit", ["run aidt stack prepare first"]);

  const remote = "origin";
  const host = hostOf((await git(root, ["remote", "get-url", remote])).trim());
  const log: string[] = [];
  const run = flags["dry-run"] ? dryRunner(log) : (runner ?? processRunner(root));
  const published = await publishStack(run, host, remote, entries);
  if (flags["dry-run"])
    return print(["Dry run, nothing was pushed. Would run:", ...log].join("\n"));

  state.sections = state.sections.map((s) => {
    const pr = published.prs.get(s.id);
    return pr ? { ...s, pr, status: "delivered" } : s;
  });
  state.delivery = { ...state.delivery, mode: "stack", tool: published.tool };
  state.phase = "done";
  await writeTaskState(root, state);
  return print(formatSubmit(entries, published));
}

/** `aidt stack <prepare|submit>`. `runner` replaces the real programs in tests. */
export async function stackCommand(
  context: CliContext,
  action: string | undefined,
  runner?: CommandRunner,
): Promise<number> {
  if (action === "prepare") return prepare(context);
  if (action === "submit") return submit(context, runner);
  throw new UsageError(`Unknown stack action "${action ?? ""}". Use: aidt stack prepare|submit`);
}
