import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { commitAll, featureRepo, write } from "./shared/testing/temp-repo.ts";

const CLI = join(import.meta.dirname, "cli.ts");
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

describe("aidt walkthrough plan", () => {
  it("splits the branch into sections, tests next to their code and noise skipped", () => {
    const { code, out } = run(repo, "walkthrough", "plan", "--json");
    expect(code).toBe(0);
    const plan = JSON.parse(out);
    expect(plan.source).toBe("main...HEAD");
    expect(
      plan.sections.map((s: { files: { path: string }[] }) => s.files.map((f) => f.path)),
    ).toEqual([["app.ts", "app.test.ts"]]);
    expect(plan.skipped.map((f: { path: string }) => f.path)).toEqual(["package-lock.json"]);
  });
});

describe("aidt walkthrough start and finish", () => {
  it("checks a change out in an ignored worktree, plans it, and removes it with its comments", () => {
    const started = run(repo, "walkthrough", "start", "feature", "PR 7", "--json");
    expect(started.code).toBe(0);
    const plan = JSON.parse(started.out);
    expect(plan.worktree).toBe(".aidt/walkthrough/pr-7");
    expect(plan.sections).toHaveLength(1);

    const worktree = join(repo, plan.worktree);
    writeFileSync(join(worktree, "app.ts"), `// ${M}: explains the change\n`);
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" });
    expect(status.stdout).toBe("");

    expect(run(repo, "walkthrough", "finish", "PR 7").code).toBe(0);
    expect(existsSync(worktree)).toBe(false);
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

describe("untracked symlinks", () => {
  // Creating symlinks on Windows needs extra privileges; the code path is the same everywhere.
  it.skipIf(process.platform === "win32")(
    "are skipped, like a package linked into node_modules",
    () => {
      mkdirSync(join(repo, "linked"));
      mkdirSync(join(repo, "node_modules"));
      symlinkSync(join(repo, "linked"), join(repo, "node_modules", "pkg"));
      expect(run(repo, "diff", "--worktree").code).toBe(0);
      expect(run(repo, "clean", "--check").code).toBe(1); // the committed @guide in app.ts
    },
  );
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

  it("copies a product's nested folders, alone or next to the workflow", () => {
    const { code, out } = run(repo, "add", "structure");
    expect(code).toBe(0);
    expect(out).toMatch(/Added \d+ file\(s\)/);
    expect(existsSync(join(repo, ".github/agents/architect.agent.md"))).toBe(true);
    expect(existsSync(join(repo, ".aidt/structure/levels/modular.md"))).toBe(true);
    expect(existsSync(join(repo, ".aidt/templates/structure.md"))).toBe(true);
  });

  it("installs one workflow agent alone, with only the files it reads", () => {
    const { code } = run(repo, "add", "reviewer");
    expect(code).toBe(0);
    for (const path of [
      ".aidt/agents/reviewer.md",
      ".aidt/templates/review-section.md",
      ".aidt/practices/static-analysis.md",
      ".github/agents/reviewer.agent.md",
    ]) {
      expect(existsSync(join(repo, path))).toBe(true);
    }
    expect(existsSync(join(repo, ".aidt/agents/planner.md"))).toBe(false);
    expect(existsSync(join(repo, ".aidt/templates/spec.md"))).toBe(false);
  });

  it("installs the walkthrough alone, for both AI tools", () => {
    expect(run(repo, "add", "walkthrough").code).toBe(0);
    expect(existsSync(join(repo, ".github/agents/walkthrough.agent.md"))).toBe(true);
    expect(existsSync(join(repo, ".claude/skills/walkthrough/SKILL.md"))).toBe(true);
    expect(existsSync(join(repo, ".aidt/agents/reviewer.md"))).toBe(false);
  });

  it("gives a lone refiner no handoff to a planner that is not installed", () => {
    expect(run(repo, "add", "refiner").code).toBe(0);
    const refiner = readFileSync(join(repo, ".github/agents/refiner.agent.md"), "utf8");
    expect(refiner).not.toContain("handoffs:");
    expect(existsSync(join(repo, ".aidt/templates/spec.md"))).toBe(true);
  });

  it("explains what exists when the name is wrong", () => {
    const { code, err } = run(repo, "add", "nope");
    expect(code).toBe(2);
    expect(err).toContain(
      'Unknown product or agent "nope". Available: workflow, structure, refiner, reviewer, walkthrough.',
    );
  });
});
