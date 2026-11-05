import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../shared/config.ts";
import { commitAll, featureRepo, git, write } from "../shared/testing/temp-repo.ts";
import type { CommandRunner } from "./command-runner.port.ts";
import { stackCommand } from "./stack.command.ts";

const TASK = ".aidt/tasks/feature";

function head(repo: string, ref = "HEAD"): string {
  return execFileSync("git", ["rev-parse", ref], { cwd: repo, encoding: "utf8" }).trim();
}

/** A `feature` branch with two committed sections, their review guides and a state.json. */
function reviewedTask(verdicts: [string, string] = ["PASS", "PASS"]): string {
  const repo = featureRepo();
  write(repo, { "store.ts": "export const s = 1;\n" });
  commitAll(repo, "feat: toast store");
  const s1 = head(repo);
  write(repo, { "ui.ts": "export const u = 1;\n" });
  commitAll(repo, "feat: toast UI");
  const s2 = head(repo);

  mkdirSync(join(repo, TASK, "review"), { recursive: true });
  writeFileSync(join(repo, TASK, "review", "s01-store.md"), "# Store guide\n");
  writeFileSync(join(repo, TASK, "review", "s02-ui.md"), "# UI guide\n");
  const sections = [
    { id: "S1", name: "Store", status: "reviewed", commit: s1, verdict: verdicts[0] },
    { id: "S2", name: "UI", status: "reviewed", commit: s2, verdict: verdicts[1] },
  ];
  const state = { version: 1, branch: "feature", phase: "review", sections };
  writeFileSync(join(repo, TASK, "state.json"), JSON.stringify(state));
  return repo;
}

async function prepare(repo: string): Promise<number> {
  return stackCommand({ root: repo, config: await loadConfig(repo), flags: {} }, "prepare");
}

describe("aidt stack prepare", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates one chained branch per section and records them in state.json", async () => {
    const repo = reviewedTask();
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    expect(await prepare(repo)).toBe(0);
    expect(head(repo, "feature-s01-store")).toBe(head(repo, "HEAD~1"));
    expect(head(repo, "feature-s02-ui")).toBe(head(repo));
    const state = JSON.parse(readFileSync(join(repo, TASK, "state.json"), "utf8"));
    expect(state.phase).toBe("deliver");
    expect(state.delivery).toEqual({ mode: "stack" });
    expect(state.sections.map((s: { branch: string }) => s.branch)).toEqual([
      "feature-s01-store",
      "feature-s02-ui",
    ]);
    expect(out.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "feature-s02-ui  →  feature-s01-store",
    );
  });

  it("is safe to run twice", async () => {
    const repo = reviewedTask();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    expect(await prepare(repo)).toBe(0);
    expect(await prepare(repo)).toBe(0);
  });

  it("refuses when a section did not pass review, and creates nothing", async () => {
    const repo = reviewedTask(["PASS", "FAIL"]);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    expect(await prepare(repo)).toBe(1);
    expect(err.mock.calls.map((c) => String(c[0])).join("")).toContain("S2 is not PASS (FAIL)");
    expect(() => head(repo, "refs/heads/feature-s01-store")).toThrow();
  });

  it("never moves a branch that already points elsewhere", async () => {
    const repo = reviewedTask();
    git(repo, "branch", "feature-s01-store", "main");
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    expect(await prepare(repo)).toBe(1);
    expect(err.mock.calls.map((c) => String(c[0])).join("")).toContain(
      "feature-s01-store already exists",
    );
    expect(head(repo, "feature-s01-store")).toBe(head(repo, "main"));
  });

  it("rejects an unknown action", async () => {
    const repo = reviewedTask();
    const context = { root: repo, config: await loadConfig(repo), flags: {} };
    await expect(stackCommand(context, "publish")).rejects.toThrow(
      'Unknown stack action "publish"',
    );
  });
});

describe("aidt stack submit", () => {
  afterEach(() => vi.restoreAllMocks());

  async function submit(repo: string, flags = {}, runner?: CommandRunner): Promise<number> {
    const context = { root: repo, config: await loadConfig(repo), flags };
    return stackCommand(context, "submit", runner);
  }

  function preparedTask(): string {
    const repo = reviewedTask();
    git(repo, "remote", "add", "origin", "git@github.com:o/r.git");
    return repo;
  }

  it("refuses until the stack is prepared", async () => {
    const repo = preparedTask();
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await submit(repo, {}, async () => "")).toBe(1);
    expect(err.mock.calls.map((c) => String(c[0])).join("")).toContain("run aidt stack prepare");
  });

  it("--dry-run lists the commands and changes nothing", async () => {
    const repo = preparedTask();
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await prepare(repo);
    const before = readFileSync(join(repo, TASK, "state.json"), "utf8");

    expect(await submit(repo, { "dry-run": true })).toBe(0);
    const printed = out.mock.calls.map((c) => String(c[0])).join("");
    expect(printed).toContain("git push --force-with-lease -u origin feature-s01-store");
    expect(printed).toContain('--title "feat: toast UI"');
    expect(readFileSync(join(repo, TASK, "state.json"), "utf8")).toBe(before);
  });

  it("records each PR and the tool in state.json", async () => {
    const repo = preparedTask();
    vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await prepare(repo);
    let pr = 0;
    const runner: CommandRunner = async (command, args) =>
      command === "gh" && args[1] === "create" ? `https://github.com/o/r/pull/${++pr}\n` : "";

    expect(await submit(repo, {}, runner)).toBe(0);
    const state = JSON.parse(readFileSync(join(repo, TASK, "state.json"), "utf8"));
    expect(state.phase).toBe("done");
    expect(state.delivery).toEqual({ mode: "stack", tool: "gh-stack" });
    expect(state.sections.map((s: { pr: string; status: string }) => [s.pr, s.status])).toEqual([
      ["https://github.com/o/r/pull/1", "delivered"],
      ["https://github.com/o/r/pull/2", "delivered"],
    ]);
  });
});
