import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Agent, parseAgent } from "../src/core/agent.ts";

const DIR = join(import.meta.dirname, "..", "products", "workflow", "agents");
const WORKFLOW = ["refiner", "planner", "builder", "reviewer"];

function load(file: string) {
  const result = parseAgent(file, readFileSync(join(DIR, file), "utf8"));
  if (!result.ok) throw new Error(`${file}: ${result.error.join("; ")}`);
  return { file, agent: result.value };
}

const agents = readdirSync(DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .map(load);

function agent(name: string): Agent {
  const found = agents.find((a) => a.agent.name === name);
  if (!found) throw new Error(`agent ${name} not found`);
  return found.agent;
}

describe("canonical agents", () => {
  it("has the four workflow agents, all valid", () => {
    expect(agents.map((a) => a.agent.name).sort()).toEqual([...WORKFLOW].sort());
  });

  it("chains them in order: refiner → planner → builder → reviewer", () => {
    expect(agent("refiner").handoff).toBe("planner");
    expect(agent("planner").handoff).toBe("builder");
    expect(agent("builder").handoff).toBe("reviewer");
    expect(agent("reviewer").handoff).toBe(undefined);
  });

  for (const { file, agent: a } of agents) {
    it(`${file} never moves on without the user's approval`, () => {
      expect(/## \d+\. Approval/.test(a.instructions)).toBe(true);
    });
  }
});

describe("refiner", () => {
  const refiner = agent("refiner");

  it("cannot edit source code", () => {
    expect(refiner.capabilities.includes("edit")).toBe(false);
    expect(refiner.writes).toEqual([".aidt/tasks/*/spec.md", ".aidt/tasks/*/state.json"]);
  });

  it("settles the branch before anything else", () => {
    expect(refiner.instructions.includes("## 1. Branch first")).toBe(true);
  });
});

describe("planner", () => {
  it("cannot edit source code or run commands", () => {
    expect(agent("planner").capabilities).toEqual(["read", "ask", "write"]);
  });
});

describe("builder", () => {
  const { instructions } = agent("builder");

  it("removes guide comments before committing", () => {
    const clean = instructions.indexOf("aidt clean --worktree");
    expect(clean > 0 && clean < instructions.indexOf("Commit only")).toBe(true);
  });

  it("never starts the next section on its own", () => {
    expect(instructions.includes("Never start it on your own")).toBe(true);
  });
});

describe("reviewer", () => {
  const reviewer = agent("reviewer");

  it("cannot edit code and only writes review files and state", () => {
    expect(reviewer.capabilities.includes("edit")).toBe(false);
    expect(reviewer.writes).toEqual([".aidt/tasks/*/review/*.md", ".aidt/tasks/*/state.json"]);
  });

  it("checks that no guide comments remain", () => {
    expect(reviewer.commands.includes("aidt clean --check")).toBe(true);
  });

  it("binds each verdict to a commit", () => {
    expect(reviewer.instructions.includes("A verdict is only valid for that commit")).toBe(true);
  });
});
