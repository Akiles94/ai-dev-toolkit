import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

describe("aidt add", () => {
  it("copies the workflow into .aidt/ and renders its agents for every AI tool", () => {
    const { code, out } = run(repo, "add", "workflow");
    expect(code).toBe(0);
    expect(out).toContain("Created .aidt/config.json");
    for (const path of [
      ".aidt/agents/refiner.md",
      ".aidt/templates/spec.md",
      ".aidt/practices/sustainable-code.md",
      ".github/agents/reviewer.agent.md",
      ".claude/skills/reviewer/SKILL.md",
    ]) {
      expect(existsSync(join(repo, path))).toBe(true);
    }
    expect(run(repo, "sync", "--check").code).toBe(0);
  });

  it("never overwrites files the project already customized", () => {
    run(repo, "add", "workflow");
    const practices = join(repo, ".aidt", "practices", "sustainable-code.md");
    writeFileSync(practices, "# Our own rules\n");

    const { code, out } = run(repo, "add", "workflow");
    expect(code).toBe(0);
    expect(out).toContain("Added 0 file(s)");
    expect(out).toContain(".aidt/practices/sustainable-code.md");
    expect(readFileSync(practices, "utf8")).toBe("# Our own rules\n");
  });

  it("explains which products exist when the name is wrong", () => {
    const { code, err } = run(repo, "add", "nope");
    expect(code).toBe(2);
    expect(err).toContain('Unknown product "nope". Available: workflow.');
  });
});
