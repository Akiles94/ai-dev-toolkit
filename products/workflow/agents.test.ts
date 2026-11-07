import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Agent, parseAgent } from "../../src/sync/agent.ts";

const DIR = join(import.meta.dirname, "agents");
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
  it("has the four workflow agents and the walkthrough, all valid", () => {
    expect(agents.map((a) => a.agent.name).sort()).toEqual([...WORKFLOW, "walkthrough"].sort());
  });

  it("chains them in order: refiner → planner → builder → reviewer", () => {
    expect(agent("refiner").handoff).toBe("planner");
    expect(agent("planner").handoff).toBe("builder");
    expect(agent("builder").handoff).toBe("reviewer");
    expect(agent("reviewer").handoff).toBe(undefined);
  });

  it("every agent knows the control levels, and the refiner records them", () => {
    for (const name of WORKFLOW) expect(agent(name).instructions).toContain("control");
    expect(agent("refiner").instructions).toContain("`strict`");
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

describe("reviewer defect search", () => {
  const instructions = agent("reviewer").instructions;

  it("looks for defects beyond the spec and verifies each one before reporting", () => {
    expect(instructions.includes("## 2. Look for defects")).toBe(true);
    expect(instructions.includes("**Verify before reporting.**")).toBe(true);
    expect(instructions.includes("A confirmed 🔴 finding from section 2.")).toBe(true);
  });

  it("runs on a balanced model, not the cheapest one", () => {
    expect(agent("reviewer").tier).toBe("balanced");
  });
});

describe("code quality review", () => {
  it("the reviewer and the walkthrough rate the same dimensions from one shared file", () => {
    for (const name of ["reviewer", "walkthrough"]) {
      expect(agent(name).instructions).toContain(".aidt/practices/code-quality.md");
      expect(agent(name).instructions).toContain("at most 5");
    }
  });

  it("only a broken rule fails a section, never a suggestion", () => {
    expect(agent("reviewer").instructions).toContain("## 3. Rate the quality");
    expect(agent("reviewer").instructions).toContain(
      "🟡 ratings and suggestions never fail a\n  section.",
    );
  });
});

describe("quality commands", () => {
  it("the builder and the reviewer may run the project's tests and check scripts", () => {
    for (const name of ["builder", "reviewer"]) {
      for (const command of ["npm test", "npm run", "pnpm run", "yarn run"]) {
        expect(agent(name).commands).toContain(command);
      }
    }
  });
});

describe("refiner alone", () => {
  it("names the task folder after the branch, not the ticket", () => {
    expect(agent("refiner").instructions).toContain("never `.aidt/tasks/SHOP-24/`");
  });

  it("delivers the approved spec when there is no planner", () => {
    expect(agent("refiner").instructions.includes("Without the planner")).toBe(true);
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

  it("reviews in a fresh context, without the conversation that built the code", () => {
    expect(reviewer.context).toBe("fresh");
  });

  it("binds each verdict to a commit", () => {
    expect(reviewer.instructions.includes("A verdict is only valid for that commit")).toBe(true);
  });

  it("reviews without a spec, asking for the ticket even when nothing references it", () => {
    expect(reviewer.instructions.includes("## 7. Without a spec")).toBe(true);
    expect(
      reviewer.instructions.includes("A ticket often exists even when nothing references it"),
    ).toBe(true);
    expect(reviewer.capabilities.includes("ask")).toBe(true);
    expect(reviewer.commands.includes("gh pr view")).toBe(true);
  });

  it("names the task folder after the branch and hands a FAIL to the author, not a builder", () => {
    expect(reviewer.instructions.includes("with the task id from the branch name")).toBe(true);
    expect(reviewer.instructions.includes("There is no builder in this mode")).toBe(true);
  });
});

describe("walkthrough", () => {
  const walkthrough = agent("walkthrough");

  it("writes only inside its ignored worktree folder, never the real code", () => {
    expect(walkthrough.capabilities.includes("edit")).toBe(false);
    expect(walkthrough.writes).toEqual([".aidt/walkthrough/**"]);
    expect(walkthrough.commands.includes("aidt walkthrough")).toBe(true);
    expect(walkthrough.commands.some((c) => /push|commit|merge/.test(c))).toBe(false);
  });

  it("stops after every section and is not part of the workflow chain", () => {
    expect(walkthrough.instructions).toContain("Never present two sections in a row");
    expect(walkthrough.handoff).toBe(undefined);
  });

  it("keeps each finding's line in the PR, not in the commented copy", () => {
    expect(walkthrough.instructions).toContain("**in the PR**, not in the commented copy");
  });
});
