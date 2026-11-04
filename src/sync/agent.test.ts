import { describe, expect, it } from "vitest";
import { parseAgent } from "./agent.ts";
import { parsed, REFINER } from "./testing/sample-agent.ts";

describe("parseAgent", () => {
  it("reads a valid agent", () => {
    const agent = parsed("refiner.md", REFINER);
    expect(agent.capabilities).toEqual(["read", "ask", "write", "shell"]);
    expect(agent.writes).toEqual([".aidt/tasks/*/spec.md"]);
    expect(agent.handoff).toBe("planner");
    expect(agent.instructions).toBe("Ask business questions only.");
  });

  it("reports every problem at once", () => {
    const broken = "---\nname: other\ntier: huge\ncapabilities: [read, fly, write]\n---\nBody\n";
    const result = parseAgent("refiner.md", broken);
    expect(result.ok ? [] : result.error).toEqual([
      'name "other" must match the file name',
      "description is missing or too short",
      "tier must be one of efficient, balanced, max",
      'unknown capability "fly"',
      "the write capability needs a writes list",
    ]);
  });

  it("accepts Windows line endings", () => {
    expect(parseAgent("refiner.md", REFINER.replace(/\n/g, "\r\n")).ok).toBe(true);
  });

  it("rejects a file without frontmatter", () => {
    expect(parseAgent("refiner.md", "Just text").ok).toBe(false);
  });
});
