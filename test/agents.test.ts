import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "..", "products", "workflow", "agents");
const WORKFLOW = ["refiner", "planner", "builder", "reviewer"];
const CAPABILITIES = ["read", "ask", "write", "edit", "shell"];

type Frontmatter = Record<string, string | string[]>;

/** Minimal parser for the frontmatter subset agents use: scalars, [inline] and "- item" lists. */
function frontmatter(markdown: string): { data: Frontmatter; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
  if (!match) throw new Error("missing frontmatter");
  const data: Frontmatter = {};
  let listKey: string | undefined;
  for (const line of (match[1] ?? "").split("\n")) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && listKey) {
      (data[listKey] as string[]).push(item[1] ?? "");
      continue;
    }
    const [, key = "", value = ""] = /^(\w[\w-]*):\s*(.*)$/.exec(line) ?? [];
    if (!key) continue;
    if (value === "") {
      data[key] = [];
      listKey = key;
    } else if (value.startsWith("[")) {
      data[key] = value
        .slice(1, -1)
        .split(",")
        .map((v) => v.trim());
      listKey = undefined;
    } else {
      data[key] = value;
      listKey = undefined;
    }
  }
  return { data, body: match[2] ?? "" };
}

function agent(name: string) {
  const found = agents.find((a) => a.data.name === name);
  if (!found) throw new Error(`agent ${name} not found`);
  return found;
}

const agents = readdirSync(DIR)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .map((file) => ({ file, ...frontmatter(readFileSync(join(DIR, file), "utf8")) }));

describe("canonical agents", () => {
  it("has the four workflow agents", () => {
    expect(agents.map((a) => a.data.name).sort()).toEqual([...WORKFLOW].sort());
  });

  it("chains them in order: refiner → planner → builder → reviewer", () => {
    expect(agent("refiner").data.handoff).toBe("planner");
    expect(agent("planner").data.handoff).toBe("builder");
    expect(agent("builder").data.handoff).toBe("reviewer");
    expect(agent("reviewer").data.handoff).toBe(undefined);
  });

  for (const { file, data, body } of agents) {
    describe(file, () => {
      it("is named after its file", () => {
        expect(data.name).toBe(file.replace(/\.md$/, ""));
      });

      it("declares a description and a valid tier", () => {
        expect(typeof data.description === "string" && data.description.length > 20).toBe(true);
        expect(["efficient", "balanced", "max"].includes(data.tier as string)).toBe(true);
      });

      it("only uses known capabilities, with their scopes", () => {
        const caps = data.capabilities as string[];
        expect(caps.every((c) => CAPABILITIES.includes(c))).toBe(true);
        if (caps.includes("write")) expect((data.writes as string[]).length > 0).toBe(true);
        if (caps.includes("shell")) expect((data.commands as string[]).length > 0).toBe(true);
      });

      it("hands off to another workflow agent", () => {
        if (data.handoff) expect(WORKFLOW.includes(data.handoff as string)).toBe(true);
      });

      it("never moves on without the user's approval", () => {
        expect(/## \d+\. Approval/.test(body)).toBe(true);
      });
    });
  }
});

describe("refiner", () => {
  const refiner = agent("refiner");

  it("cannot edit source code", () => {
    expect((refiner.data.capabilities as string[]).includes("edit")).toBe(false);
    expect(refiner.data.writes).toEqual([".aidt/tasks/*/spec.md", ".aidt/tasks/*/state.json"]);
  });

  it("settles the branch before anything else", () => {
    expect(refiner.body.includes("## 1. Branch first")).toBe(true);
  });
});

describe("planner", () => {
  const planner = agent("planner");

  it("cannot edit source code or run commands", () => {
    expect(planner.data.capabilities).toEqual(["read", "ask", "write"]);
  });
});

describe("builder", () => {
  const builder = agent("builder");

  it("removes guide comments before committing", () => {
    expect(builder.body.includes("`aidt clean --worktree`")).toBe(true);
    expect(
      builder.body.indexOf("aidt clean --worktree") < builder.body.indexOf("Commit only"),
    ).toBe(true);
  });

  it("never starts the next section on its own", () => {
    expect(builder.body.includes("Never start it on your own")).toBe(true);
  });
});

describe("reviewer", () => {
  const reviewer = agent("reviewer");

  it("cannot edit code and only writes review files and state", () => {
    expect((reviewer.data.capabilities as string[]).includes("edit")).toBe(false);
    expect(reviewer.data.writes).toEqual([".aidt/tasks/*/review/*.md", ".aidt/tasks/*/state.json"]);
  });

  it("checks that no guide comments remain", () => {
    expect((reviewer.data.commands as string[]).includes("aidt clean --check")).toBe(true);
  });

  it("binds each verdict to a commit", () => {
    expect(reviewer.body.includes("A verdict is only valid for that commit")).toBe(true);
  });
});
