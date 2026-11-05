import { type CliContext, print, UsageError } from "../shared/cli-context.ts";
import { writeTaskState } from "../shared/task-state.ts";
import { createBranches, loadLocalStack } from "./local-stack.ts";
import type { StackEntry } from "./stack-plan.ts";

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
    `Stack ready (${entries.length} PRs on ${trunk}). Nothing was pushed.`,
    ...lines,
    "",
    "Next: aidt stack submit",
  ].join("\n");
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

/** `aidt stack <action>`. */
export async function stackCommand(
  context: CliContext,
  action: string | undefined,
): Promise<number> {
  if (action === "prepare") return prepare(context);
  throw new UsageError(`Unknown stack action "${action ?? ""}". Use: aidt stack prepare`);
}
