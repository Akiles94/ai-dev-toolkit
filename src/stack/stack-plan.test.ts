import { describe, expect, it } from "vitest";
import type { TaskState } from "../shared/task-state.ts";
import { buildStackPlan, type SectionMaterial, sectionSlug } from "./stack-plan.ts";

const state = (sections: TaskState["sections"]): TaskState => ({
  version: 1,
  branch: "feat/toasts",
  phase: "review",
  sections,
});

const material = (subject: string): SectionMaterial => ({ subject, guide: `# ${subject}` });

describe("sectionSlug", () => {
  it("pads the number and keeps a short, ref-safe name", () => {
    expect(sectionSlug({ id: "S1", name: "Toast store & API!" })).toBe("s01-toast-store-api");
    expect(sectionSlug({ id: "S12", name: "A very long section name that goes on" })).toBe(
      "s12-a-very-long-section-name",
    );
  });
});

describe("buildStackPlan", () => {
  it("chains one branch per section on the trunk", () => {
    const plan = buildStackPlan(
      state([
        { id: "S1", name: "Store", status: "reviewed", commit: "aaaaaaa", verdict: "PASS" },
        { id: "S2", name: "UI", status: "reviewed", commit: "bbbbbbb", verdict: "PASS" },
      ]),
      "main",
      new Map([
        ["S1", material("feat: toast store")],
        ["S2", material("feat: toast UI")],
      ]),
    );
    expect(plan).toEqual({
      ok: true,
      value: [
        {
          id: "S1",
          branch: "feat/toasts-s01-store",
          base: "main",
          commit: "aaaaaaa",
          title: "feat: toast store",
          body: "# feat: toast store",
        },
        {
          id: "S2",
          branch: "feat/toasts-s02-ui",
          base: "feat/toasts-s01-store",
          commit: "bbbbbbb",
          title: "feat: toast UI",
          body: "# feat: toast UI",
        },
      ],
    });
  });

  it("refuses unreviewed, failed or uncommitted sections, listing every problem", () => {
    const plan = buildStackPlan(
      state([
        { id: "S1", name: "Store", status: "reviewed", commit: "aaaaaaa", verdict: "FAIL" },
        { id: "S2", name: "UI", status: "in-progress" },
      ]),
      "main",
      new Map([["S1", material("feat: toast store")]]),
    );
    expect(plan).toEqual({
      ok: false,
      error: [
        "S1 is not PASS (FAIL): fix it first",
        "S2 has no commit: the builder has not committed it",
        "S2 is not PASS (not reviewed): fix it first",
        "S2 has no review guide",
      ],
    });
  });

  it("refuses a task without sections", () => {
    expect(buildStackPlan(state([]), "main", new Map())).toEqual({
      ok: false,
      error: ["the task has no sections"],
    });
  });
});
