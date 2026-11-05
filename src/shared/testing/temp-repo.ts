import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Runs git in `cwd`, failing the test on error. */
export function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Writes files relative to `root`, as `{ path: content }`. */
export function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) writeFileSync(join(root, path), content);
}

/**
 * A temporary repo with `app.ts` committed on `main`, checked out on a `feature` branch.
 * Mirrors the usual situation: a task branch to compare against the default branch.
 */
export function featureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "aidt-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  write(repo, { "app.ts": "export const a = 1;\n" });
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "checkout", "-q", "-b", "feature");
  return repo;
}

/** Commits every pending change in `repo`. */
export function commitAll(repo: string, message: string): void {
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", message);
}
