import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWalk } from "../../src/qa/qa-walk.ts";
import { parseAgent } from "../../src/sync/agent.ts";

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

describe("qa agent", () => {
  const parsed = parseAgent("qa.md", read("agents/qa.md"));
  const agent = parsed.ok ? parsed.value : undefined;

  it("is valid, runs fresh and writes only its reports, its walks and the app notes", () => {
    expect(parsed.ok).toBe(true);
    expect(agent?.context).toBe("fresh");
    expect(agent?.writes).toEqual([
      ".aidt/tasks/*/qa/*.md",
      ".aidt/tasks/*/qa/walks/*.json",
      ".aidt/app.md",
    ]);
    expect(agent?.capabilities.includes("edit")).toBe(false);
  });

  it("proposes scope and cost, and waits for a yes before walking", () => {
    expect(agent?.instructions).toMatch(
      /## 1\. Scope and cost[\s\S]*## 2\. Approval[\s\S]*## 3\. Walk/,
    );
    expect(agent?.instructions).toContain("«scope approved»");
  });

  it("walks with the CLI and runs no code of its own: no node, curl or install", () => {
    expect(agent?.commands).toContain("aidt qa walk");
    expect(
      agent?.commands.some((c) =>
        /^(node|npm|npx|pnpm|yarn|curl|wget|psql)\b|install|push|commit/.test(c),
      ),
    ).toBe(false);
  });

  it("confirms every finding by running its walk again, and keeps what it could not", () => {
    expect(agent?.instructions).toMatch(/## 5\. Confirm[\s\S]*walk of each finding a second time/);
    expect(agent?.instructions).toContain("«Unconfirmed»");
  });
});

describe("only when asked", () => {
  it("no agent hands off to the qa", () => {
    const products = join(import.meta.dirname, "..");
    const handoffs = readdirSync(products)
      .map((product) => join(products, product, "agents"))
      .filter((dir) => existsSync(dir))
      .flatMap((dir) =>
        readdirSync(dir)
          .filter((f) => f.endsWith(".md") && f !== "README.md")
          .map((f) => parseAgent(f, readFileSync(join(dir, f), "utf8"))),
      )
      .map((a) => (a.ok ? a.value.handoff : undefined));
    expect(handoffs).not.toContain("qa");
  });
});

describe("qa templates", () => {
  it("the example walk is valid and shows every kind of step", () => {
    const walk = JSON.parse(read("templates/qa-walk.json"));
    expect(parseWalk(walk).ok).toBe(true);
    const kinds = walk.steps.flatMap((step: object) =>
      Object.keys(step).filter((key) => key !== "as" && key !== "times"),
    );
    expect(new Set(kinds)).toEqual(
      new Set([
        ...["go", "fill", "select", "click", "press", "wait", "look", "keep"],
        ...["back", "reload", "offline", "clear", "request"],
      ]),
    );
  });

  it("the report ties each finding to the walk that reproduces it", () => {
    const report = read("templates/qa-report.md");
    expect(report).toContain("- **Walk:** `walks/{{slug}}.json`, step {{n}}");
    for (const part of ["## Scope", "## Findings", "## Unconfirmed", "## Not covered", "## Cost"])
      expect(report).toContain(part);
  });

  it("the planner goes through the plan check only where the qa brought it", () => {
    const planner = read("../workflow/agents/planner.md");
    expect(planner).toContain("only in projects that have `.aidt/practices/plan-check.md`");
    expect(read("practices/plan-check.md")).toContain("Name them in the plan: the QA walks them.");
  });
});
