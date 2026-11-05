import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** A git failure with the command and git's own message, ready to show to the user. */
export class GitError extends Error {
  override readonly name = "GitError";
}

/** Runs git in `cwd` and returns stdout. Never goes through a shell. */
export async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await exec("git", args, { cwd, maxBuffer: 256 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new GitError(`git ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

export async function repoRoot(cwd: string): Promise<string> {
  return (await git(cwd, ["rev-parse", "--show-toplevel"])).trim();
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The branch work is compared against: the remote's default branch if known,
 * otherwise the first of `main` / `master` that exists.
 */
export async function defaultBranch(cwd: string): Promise<string> {
  try {
    const ref = (await git(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"])).trim();
    if (ref) return ref;
  } catch {
    // No remote HEAD configured: fall back to local names.
  }
  for (const candidate of ["main", "master", "origin/main", "origin/master"]) {
    if (await refExists(cwd, candidate)) return candidate;
  }
  throw new GitError("Could not find a default branch. Pass --base <ref>.");
}
