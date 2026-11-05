import { fail, ok, type Result } from "../shared/result/result.ts";
import type { SectionState, TaskState } from "../shared/task/task-state.ts";

/** One pull request of the stack: a branch at the section's commit, based on the one below it. */
export interface StackEntry {
  readonly id: string;
  readonly branch: string;
  /** The branch this one is reviewed against: the previous section, or the trunk for the first. */
  readonly base: string;
  readonly commit: string;
  readonly title: string;
  /** The section's review guide, used as the PR description. */
  readonly body: string;
}

/** What the reviewer left for each section: its commit subject and its review guide. */
export interface SectionMaterial {
  readonly subject: string;
  readonly guide: string | undefined;
}

const MAX_SLUG = 30;

/** `S1` + "Type filter in the domain" → `s01-type-filter-in-the-domain`, kept short. */
export function sectionSlug(section: Pick<SectionState, "id" | "name">): string {
  const number = section.id.replace(/^S/, "").padStart(2, "0");
  const words = section.name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let slug = `s${number}`;
  for (const word of words) {
    if (slug.length + 1 + word.length > MAX_SLUG) break;
    slug = `${slug}-${word}`;
  }
  return slug;
}

/** Everything that keeps a section out of the stack, all at once. */
function problemsOf(section: SectionState, material: SectionMaterial | undefined): string[] {
  const problems: string[] = [];
  if (!section.commit) {
    problems.push(`${section.id} has no commit: the builder has not committed it`);
  }
  if (section.verdict !== "PASS") {
    problems.push(`${section.id} is not PASS (${section.verdict ?? "not reviewed"}): fix it first`);
  }
  if (material?.guide === undefined) problems.push(`${section.id} has no review guide`);
  return problems;
}

/**
 * Turns a reviewed task into a stack: one branch per section at its commit, each based on the
 * previous one. Refuses unless every section passed review, so nothing unreviewed is ever shipped.
 */
export function buildStackPlan(
  state: TaskState,
  trunk: string,
  materials: ReadonlyMap<string, SectionMaterial>,
): Result<StackEntry[], string[]> {
  if (state.sections.length === 0) return fail(["the task has no sections"]);
  const problems = state.sections.flatMap((s) => problemsOf(s, materials.get(s.id)));
  if (problems.length > 0) return fail(problems);

  let base = trunk;
  const entries = state.sections.map((section) => {
    const material = materials.get(section.id) as SectionMaterial;
    const branch = `${state.branch}-${sectionSlug(section)}`;
    const entry = {
      id: section.id,
      branch,
      base,
      commit: section.commit as string,
      title: material.subject,
      body: material.guide as string,
    };
    base = branch;
    return entry;
  });
  return ok(entries);
}
