import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateTokens, readingList } from "../../src/context/context-budget.ts";
import { DEFAULT_CONFIG } from "../../src/shared/config/config.ts";

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8");

/** `##` and `###` headings of a template, outside its comments. */
const headings = (markdown: string): string[] =>
  [...markdown.replace(/<!--[\s\S]*?-->/g, "").matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1] ?? "");

describe("context product", () => {
  it("ships the practice and the three templates the design describes", () => {
    expect(readdirSync(join(import.meta.dirname, "practices"))).toEqual(["session-context.md"]);
    expect(readdirSync(join(import.meta.dirname, "templates")).sort()).toEqual([
      "status.md",
      "summary.md",
      "tasks-index.md",
    ]);
  });

  it("every template starts with instructions for the agent", () => {
    for (const name of ["status.md", "summary.md", "tasks-index.md"]) {
      expect(read(`templates/${name}`).startsWith("<!--\n  Template:")).toBe(true);
    }
  });

  it("the status is a snapshot whose reading list the check can find", () => {
    const status = read("templates/status.md");
    expect(headings(status)).toEqual([
      "Now",
      "Next",
      "Read first",
      "Not needed",
      "Open decisions",
      "Recent",
    ]);
    const filled = status.replaceAll("{{path}}", "docs/flows/export.md");
    expect(readingList(filled)).toEqual(["docs/flows/export.md"]);
  });

  it("the empty status leaves most of the start budget for the work itself", () => {
    const tokens = estimateTokens(read("templates/status.md"));
    expect(tokens).toBeLessThan(DEFAULT_CONFIG.context.budget.start / 4);
  });

  it("the summary keeps what a status used to pile up", () => {
    expect(headings(read("templates/summary.md"))).toEqual([
      "Done",
      "Decisions",
      "Deviations from the plan",
      "Left for later",
      "Verdicts",
    ]);
  });

  it("the practice tells how to close a block and runs the check", () => {
    const practice = read("practices/session-context.md");
    expect(headings(practice)).toContain("Closing a block");
    expect(practice).toContain("aidt context check");
  });
});
