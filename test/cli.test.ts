import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { commitAll, featureRepo, write } from "./helpers/repo.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli.ts");
const M = "@guide";

function run(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

let repo: string;

beforeEach(() => {
  repo = featureRepo();
  write(repo, {
    "app.ts": `export const a = 2; // ${M}: bumped\nexport const b = 3;\n`,
    "app.test.ts": "test();\n",
    "package-lock.json": "{}\n".repeat(50),
  });
  commitAll(repo, "feature");
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
