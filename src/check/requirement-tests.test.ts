import { describe, expect, it } from "vitest";
import { requirementIds, untestedRequirements } from "./requirement-tests.ts";

describe("requirementIds", () => {
  it("reads the ids under Requirements only, once each, ignoring comments", () => {
    const spec = [
      "## Goal",
      "Mentions **R9** in passing.",
      "## Requirements",
      "<!-- e.g. **R7** -->",
      "- **R1** blocks the 6th attempt",
      "- **R2** unblocks after 15 minutes, unlike **R1**",
      "## Acceptance criteria",
      "| R1 | … |",
    ].join("\n");
    expect(requirementIds(spec)).toEqual(["R1", "R2"]);
  });
});

describe("untestedRequirements", () => {
  it("lists the ids no test mentions, without confusing R1 with R10", () => {
    const tests = ['it("R10: rejects an empty name")', 'it("R2: unblocks after 15 minutes")'];
    expect(untestedRequirements(["R1", "R2", "R10"], tests)).toEqual(["R1"]);
  });
});
