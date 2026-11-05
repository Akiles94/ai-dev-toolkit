import { describe, expect, it } from "vitest";
import { collectDiff } from "../changes/changes.ts";
import { DEFAULT_CONFIG } from "../config/config.ts";
import { commitAll, featureRepo, git, write } from "../testing/temp-repo.ts";
import { defaultBranch, GitError, repoRoot } from "./git.ts";

describe("collectDiff", () => {
  it("compares a branch with its base like a PR, ignoring later changes on the base", async () => {
    const repo = featureRepo();
    write(repo, { "app.ts": "export const a = 2;\n", "notes.md": "x\n" });
    commitAll(repo, "feature");
    git(repo, "checkout", "-q", "main");
    write(repo, { "other.ts": "export const c = 1;\n" });
    commitAll(repo, "main moves on");
    git(repo, "checkout", "-q", "feature");

    const summary = await collectDiff(
      repo,
      { kind: "range", base: "main", head: "HEAD" },
      DEFAULT_CONFIG,
    );
    expect(summary.files.map((f) => f.path).sort()).toEqual(["app.ts", "notes.md"]);
    expect(summary.totals.code).toEqual({ files: 2, added: 2, deleted: 1 });
  });

  it("counts staged changes only", async () => {
    const repo = featureRepo();
    write(repo, { "app.ts": "export const a = 2;\n", "unstaged.ts": "x\n" });
    git(repo, "add", "app.ts");

    const summary = await collectDiff(repo, { kind: "staged" }, DEFAULT_CONFIG);
    expect(summary.source).toBe("staged changes");
    expect(summary.files.map((f) => f.path)).toEqual(["app.ts"]);
  });

  it("treats untracked files as fully added and detects binary ones", async () => {
    const repo = featureRepo();
    write(repo, { "new.ts": "a\nb\n", "logo.bin": "\0\0" });

    const summary = await collectDiff(repo, { kind: "worktree" }, DEFAULT_CONFIG);
    const byPath = Object.fromEntries(summary.files.map((f) => [f.path, f]));
    expect(byPath["new.ts"]).toEqual({
      path: "new.ts",
      added: 2,
      deleted: 0,
      binary: false,
      category: "code",
    });
    expect(byPath["logo.bin"]?.binary).toBe(true);
  });
});

describe("git helpers", () => {
  it("finds the repository root and the default branch", async () => {
    const repo = featureRepo();
    expect(await defaultBranch(repo)).toBe("main");
    expect((await repoRoot(repo)).endsWith(repo.split("/").pop() ?? "")).toBe(true);
  });

  it("explains which git command failed", async () => {
    const repo = featureRepo();
    git(repo, "branch", "-q", "-m", "main", "trunk");
    await expect(defaultBranch(repo)).rejects.toBeInstanceOf(GitError);
  });
});
