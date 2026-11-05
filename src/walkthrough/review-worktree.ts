import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { UsageError } from "../shared/cli/cli-context.ts";
import { git } from "../shared/git/git.ts";

/**
 * Where a change under review is checked out, inside the repository so every AI tool can read
 * and annotate it, and ignored by git (through `.git/info/exclude`, never `.gitignore`) so it
 * shows nowhere and is never committed.
 */
const WORKTREES_DIR = ".aidt/walkthrough";

/** `feat/Cart Total` → `feat-cart-total`: safe as a folder name on every system. */
function worktreeName(ref: string): string {
  const name = ref
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  if (!name) throw new UsageError(`Cannot name a walkthrough after "${ref}". Pass a name.`);
  return name;
}

async function ignoreWorktrees(root: string): Promise<void> {
  const relative = (await git(root, ["rev-parse", "--git-path", "info/exclude"])).trim();
  const path = isAbsolute(relative) ? relative : join(root, relative);
  const current = await readFile(path, "utf8").catch(() => "");
  if (current.split(/\r?\n/).includes(`${WORKTREES_DIR}/`)) return;
  await mkdir(dirname(path), { recursive: true });
  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  await writeFile(path, `${current}${separator}${WORKTREES_DIR}/\n`);
}

/** Checks out `ref` (detached) in its own worktree and returns its path relative to `root`. */
export async function openWorktree(root: string, ref: string, name: string): Promise<string> {
  const path = `${WORKTREES_DIR}/${worktreeName(name)}`;
  await ignoreWorktrees(root);
  await git(root, ["worktree", "add", "--detach", path, ref]);
  return path;
}

/** Removes the worktree and everything written in it (the guide comments). */
export async function closeWorktree(root: string, name: string): Promise<string> {
  const path = `${WORKTREES_DIR}/${worktreeName(name)}`;
  await git(root, ["worktree", "remove", "--force", path]);
  return path;
}
