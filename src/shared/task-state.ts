import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** One section of a task, as the agents record it in `state.json`. */
export interface SectionState {
  id: string;
  name: string;
  status: string;
  branch?: string;
  commit?: string;
  lines?: number;
  verdict?: "PASS" | "FAIL";
  pr?: string;
}

/** The progress of one task (`products/workflow/templates/state.schema.json`). */
export interface TaskState {
  version: 1;
  branch: string;
  phase: string;
  sections: SectionState[];
  delivery?: { mode?: "stack" | "single"; tool?: string };
  [other: string]: unknown;
}

/** The task folder name for a branch: `/` becomes `-` (`feat/x-y` → `feat-x-y`). */
export const taskId = (branch: string): string => branch.replaceAll("/", "-");

/** `.aidt/tasks/<task-id>/`, relative to the repository root. */
export const taskDir = (branch: string): string => `.aidt/tasks/${taskId(branch)}`;

/** Reads the task's `state.json`, or `undefined` when the branch has no task. */
export async function readTaskState(root: string, branch: string): Promise<TaskState | undefined> {
  const raw = await readFile(join(root, taskDir(branch), "state.json"), "utf8").catch(
    () => undefined,
  );
  return raw === undefined ? undefined : (JSON.parse(raw) as TaskState);
}

/** Writes the task's `state.json`, keeping every field the agents put there. */
export async function writeTaskState(root: string, state: TaskState): Promise<void> {
  const path = join(root, taskDir(state.branch), "state.json");
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}
