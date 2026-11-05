import { describe, expect, it } from "vitest";
import { parseAgent } from "./agent.ts";
import { allowedTools, claudeCodeAgentRenderer } from "./claude-code-agent-renderer.ts";
import { parsed, REFINER } from "./testing/sample-agent.ts";

describe("claudeCodeAgentRenderer", () => {
  const skill = (markdown: string, file = "refiner.md") =>
    claudeCodeAgentRenderer(parsed(file, markdown), `.aidt/agents/${file}`)[0];

  it("writes a skill the user invokes as a slash command", () => {
    const file = skill(REFINER);
    expect(file?.path).toBe(".claude/skills/refiner/SKILL.md");
    expect(file?.content).toContain("disable-model-invocation: true");
    expect(file?.content).toContain("model: sonnet");
  });

  it("pre-approves only the scoped writes and commands", () => {
    expect(allowedTools(parsed("refiner.md", REFINER))).toEqual([
      "Read",
      "Grep",
      "Glob",
      "AskUserQuestion",
      "Edit(.aidt/tasks/*/spec.md)",
      "Bash(git branch *)",
    ]);
  });

  it("suggests the next step instead of starting it", () => {
    expect(skill(REFINER)?.content.trimEnd().endsWith("Never start it yourself.")).toBe(true);
  });

  it("runs a fresh-context agent in a forked subagent that waits for the result", () => {
    const content = skill(
      REFINER.replace("tier: balanced", "tier: efficient\ncontext: fresh"),
    )?.content;
    expect(content).toContain("model: haiku");
    expect(content).toContain("context: fork\nagent: general-purpose\nbackground: false");
    expect(content).toContain("## Running in a fresh context");
  });

  it("rejects an unknown context", () => {
    const result = parseAgent("refiner.md", REFINER.replace("tier:", "context: shy\ntier:"));
    expect(result.ok ? [] : result.error).toEqual(["context must be one of shared, fresh"]);
  });
});
