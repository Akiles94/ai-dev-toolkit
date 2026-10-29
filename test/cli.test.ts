import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const M = "@guide";

function run(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function sh(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "aidt-"));
  sh(repo, "init", "-q", "-b", "main");
  sh(repo, "config", "user.email", "test@example.com");
  sh(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "app.ts"), "export const a = 1;\n");
  sh(repo, "add", ".");
  sh(repo, "commit", "-q", "-m", "init");
  sh(repo, "checkout", "-q", "-b", "feature");
  writeFileSync(join(repo, "app.ts"), `export const a = 2; // ${M}: bumped\nexport const b = 3;\n`);
  writeFileSync(join(repo, "app.test.ts"), "test();\n");
  writeFileSync(join(repo, "package-lock.json"), `${"{}\n".repeat(50)}`);
  sh(repo, "add", ".");
  sh(repo, "commit", "-q", "-m", "feature");
});

describe("aidt diff", () => {
  it("compares the branch with the default branch and filters noise", () => {
    const { code, out } = run(repo, "diff", "--json");
    expect(code).toBe(0);
    const summary = JSON.parse(out);
    expect(summary.source).toBe("main...HEAD");
    expect(summary.totals.code).toEqual({ files: 1, added: 2, deleted: 1 });
    expect(summary.totals.test.files).toBe(1);
    expect(summary.totals.noise).toEqual({ files: 1, added: 50, deleted: 0 });
  });

  it("includes untracked files in worktree mode", () => {
    writeFileSync(join(repo, "new.ts"), "a\nb\nc\n");
    const summary = JSON.parse(run(repo, "diff", "--worktree", "--json").out);
    expect(summary.totals.code).toEqual({ files: 1, added: 3, deleted: 0 });
  });
});

describe("aidt clean", () => {
  it("reports guide comments with --check and fails", () => {
    const { code, out } = run(repo, "clean", "--check");
    expect(code).toBe(1);
    expect(out).toContain("app.ts  1");
    expect(readFileSync(join(repo, "app.ts"), "utf8")).toContain(M);
  });

  it("removes guide comments from changed files", () => {
    expect(run(repo, "clean").code).toBe(0);
    const cleaned = readFileSync(join(repo, "app.ts"), "utf8");
    expect(cleaned).toBe("export const a = 2;\nexport const b = 3;\n");
    expect(run(repo, "clean", "--check").code).toBe(0);
  });
});

describe("errors", () => {
  it("exits with 2 on an unknown command", () => {
    const { code, err } = run(repo, "nope");
    expect(code).toBe(2);
    expect(err).toContain("Unknown command");
  });
});
