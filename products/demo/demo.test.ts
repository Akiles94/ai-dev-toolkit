import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScript } from "../../src/demo/demo-script.ts";
import { parseAgent } from "../../src/sync/agent.ts";

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

describe("demo agent", () => {
  const parsed = parseAgent("demo.md", read("agents/demo.md"));
  const agent = parsed.ok ? parsed.value : undefined;

  it("is valid, runs fresh and writes only its scripts and the app notes", () => {
    expect(agent?.context).toBe("fresh");
    expect(agent?.writes).toEqual([".aidt/tasks/*/demo/*.json", ".aidt/app.md"]);
    expect(agent?.capabilities.includes("edit")).toBe(false);
  });

  it("proposes scope and cost, and waits for a yes before writing anything", () => {
    expect(agent?.instructions).toMatch(/## 1\. Scope and cost[\s\S]*## 2\. Approval/);
    expect(agent?.instructions).toContain("«scope approved»");
  });

  it("renders with the CLI, never installs, and hands over the PR text", () => {
    expect(agent?.commands).toContain("aidt demo render");
    expect(agent?.commands.some((c) => /install|push|commit/.test(c))).toBe(false);
    expect(agent?.instructions).toContain(".aidt/demo/<slug>.md");
  });
});

describe("demo templates", () => {
  it("the example script is valid and shows every kind of step", () => {
    const script = JSON.parse(read("templates/demo-script.json"));
    expect(parseScript(script).ok).toBe(true);
    const kinds = script.scenes.flatMap((s: { steps: object[] }) =>
      s.steps.map((st) => Object.keys(st)[0]),
    );
    expect(new Set(kinds)).toEqual(
      new Set(["go", "say", "fill", "select", "click", "scroll", "press", "wait"]),
    );
  });

  it("the app notes serve both the demo and the qa", () => {
    const app = read("templates/app.md");
    expect(app.startsWith("<!--\n  Template:")).toBe(true);
    for (const part of ["## Run", "## Data and people", "## Demo", "## QA"])
      expect(app).toContain(part);
  });
});
