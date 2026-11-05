import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "..", "products", "workflow", "templates");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");

/** `## Heading` lines of a Markdown template, ignoring those inside comments. */
function headings(markdown: string): string[] {
  const withoutComments = markdown.replace(/<!--[\s\S]*?-->/g, "");
  return [...withoutComments.matchAll(/^## (.+)$/gm)].map((m) => m[1] ?? "");
}

describe("workflow templates", () => {
  it("ships every template the design describes", () => {
    expect(readdirSync(DIR).sort()).toEqual([
      "plan.md",
      "review-index.md",
      "review-section.md",
      "spec.md",
      "state.schema.json",
    ]);
  });

  it("spec covers the what, never the how", () => {
    expect(headings(read("spec.md"))).toEqual([
      "Goal",
      "Context",
      "Requirements",
      "Acceptance criteria",
      "Edge cases",
      "Out of scope",
      "Decisions",
      "Open questions",
    ]);
  });

  it("plan includes sections, tests and visible assumptions", () => {
    const sections = headings(read("plan.md"));
    for (const required of ["Approach", "Sections", "Tests", "Assumptions", "Risks"]) {
      expect(sections.includes(required)).toBe(true);
    }
  });

  it("section review guide has the blocks the reviewer fills", () => {
    expect(headings(read("review-section.md"))).toEqual([
      "At a glance",
      "Predict first",
      "What it does",
      "Walkthrough",
      "Reading order",
      "Affected flows",
      "Requirement coverage",
      "Warnings",
      "Questions for the author",
    ]);
  });

  it("every template starts with instructions for the agent", () => {
    for (const name of ["spec.md", "plan.md", "review-section.md", "review-index.md"]) {
      expect(read(name).startsWith("<!--\n  Template:")).toBe(true);
    }
  });
});

describe("state schema", () => {
  const schema = JSON.parse(read("state.schema.json"));

  it("lists the modes and phases of the workflow", () => {
    expect(schema.properties.mode.enum).toEqual(["full", "light", "rework"]);
    expect(schema.properties.phase.enum).toEqual([
      "refine",
      "plan",
      "build",
      "review",
      "deliver",
      "done",
    ]);
  });

  it("binds a verdict to a commit", () => {
    const section = schema.$defs.section.properties;
    expect(section.verdict.enum).toEqual(["PASS", "FAIL"]);
    expect(section.commit.pattern).toBe("^[0-9a-f]{7,40}$");
  });
});
