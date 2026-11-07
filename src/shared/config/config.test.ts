import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureRepo } from "../testing/temp-repo.ts";
import { loadConfig } from "./config.ts";

describe("loadConfig models", () => {
  it("merges each tool's tiers over the defaults, so one change keeps the rest", async () => {
    const repo = featureRepo();
    mkdirSync(join(repo, ".aidt"), { recursive: true });
    writeFileSync(
      join(repo, ".aidt", "config.json"),
      JSON.stringify({ models: { agents: { reviewer: "max" }, "claude-code": { max: "opus-x" } } }),
    );
    const { models } = await loadConfig(repo);
    expect(models).toEqual({
      agents: { reviewer: "max" },
      "claude-code": { efficient: "haiku", balanced: "sonnet", max: "opus-x" },
      copilot: {},
    });
  });
});
