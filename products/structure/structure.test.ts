import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "structure");
const read = (path: string) => readFileSync(join(DIR, path), "utf8");

describe("structure product", () => {
  it("ships the common rules and the three levels", () => {
    expect(readdirSync(join(DIR, "levels")).sort()).toEqual([
      "architecture.md",
      "conventional.md",
      "modular.md",
    ]);
    const rules = [...read("rules.md").matchAll(/^## (S\d) ·/gm)].map((m) => m[1]);
    expect(rules).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
  });

  it("gives every level and the rules a review checklist", () => {
    for (const file of [
      "rules.md",
      ...readdirSync(join(DIR, "levels")).map((f) => `levels/${f}`),
    ]) {
      expect(read(file)).toContain("## Review checklist");
    }
  });
});
