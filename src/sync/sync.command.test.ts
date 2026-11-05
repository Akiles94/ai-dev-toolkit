import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureRepo } from "../shared/testing/temp-repo.ts";
import { planSync, staleFiles, writeSync } from "./sync.command.ts";
import { REFINER } from "./testing/sample-agent.ts";

describe("sync", () => {
  function repoWithAgents(files: Record<string, string>): string {
    const repo = featureRepo();
    mkdirSync(join(repo, ".aidt", "agents"), { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(repo, ".aidt", "agents", name), content);
    }
    return repo;
  }

  it("renders every agent for every harness and writes the files", async () => {
    const repo = repoWithAgents({ "refiner.md": REFINER, "README.md": "# not an agent" });
    const plan = await planSync(repo, ".aidt/agents", ["copilot"]);
    expect(plan.problems).toEqual([]);
    expect(plan.files.map((f) => f.path)).toEqual([".github/agents/refiner.agent.md"]);

    await writeSync(repo, plan.files);
    const written = readFileSync(join(repo, ".github", "agents", "refiner.agent.md"), "utf8");
    expect(written).toBe(plan.files[0]?.content);
  });

  it("reports invalid agents and unknown harnesses", async () => {
    const repo = repoWithAgents({ "refiner.md": REFINER, "broken.md": "no frontmatter" });
    const plan = await planSync(repo, ".aidt/agents", ["copilot", "notepad"]);
    expect(plan.problems.map((p) => p.file)).toEqual(["sync.harnesses", ".aidt/agents/broken.md"]);
  });
});

describe("sync --check", () => {
  it("lists generated files that are missing or edited by hand", async () => {
    const repo = featureRepo();
    mkdirSync(join(repo, ".aidt", "agents"), { recursive: true });
    writeFileSync(join(repo, ".aidt", "agents", "refiner.md"), REFINER);
    const plan = await planSync(repo, ".aidt/agents", ["copilot", "claude-code"]);
    expect(await staleFiles(repo, plan.files)).toEqual([
      ".github/agents/refiner.agent.md",
      ".claude/skills/refiner/SKILL.md",
    ]);

    await writeSync(repo, plan.files);
    expect(await staleFiles(repo, plan.files)).toEqual([]);

    writeFileSync(join(repo, ".claude", "skills", "refiner", "SKILL.md"), "edited by hand");
    expect(await staleFiles(repo, plan.files)).toEqual([".claude/skills/refiner/SKILL.md"]);
  });
});
