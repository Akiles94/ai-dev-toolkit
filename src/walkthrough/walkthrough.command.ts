import { collectDiff, type FileChange } from "../shared/changes/changes.ts";
import { type CliContext, print, resolveSource, UsageError } from "../shared/cli/cli-context.ts";
import {
  planWalkthrough,
  type WalkthroughPlan,
  type WalkthroughSection,
} from "./walkthrough-plan.ts";

function fileLine(file: FileChange): string {
  const size = file.binary ? "binary" : `+${file.added} −${file.deleted}`;
  const tag = file.category === "code" ? "" : `  (${file.category})`;
  return `    ${file.path}  ${size}${tag}`;
}

function sectionBlock(section: WalkthroughSection): string[] {
  const tests = section.testLines > 0 ? ` + ${section.testLines} test` : "";
  const warning = section.oversized ? " · one file over the limit: split it by hunks" : "";
  return [
    `${section.id}  ${section.title}  (${section.lines} lines${tests}${warning})`,
    ...section.files.map(fileLine),
    "",
  ];
}

function formatPlan(source: string, plan: WalkthroughPlan): string {
  const lines = plan.sections.reduce((sum, s) => sum + s.lines, 0);
  const count = plan.sections.length;
  const skipped =
    plan.skipped.length === 0
      ? []
      : [`Skipped (noise, formatting): ${plan.skipped.length}`, ...plan.skipped.map(fileLine)];
  return [
    `Source: ${source}`,
    `Walkthrough: ${count} section${count === 1 ? "" : "s"} · ${lines} lines · limit ${plan.limit} per section`,
    "",
    ...plan.sections.flatMap(sectionBlock),
    ...skipped,
  ]
    .join("\n")
    .trimEnd();
}

/** `aidt walkthrough plan`: splits a large change into sections to review in order. */
export async function walkthroughCommand(
  { root, config, flags }: CliContext,
  subcommand: string | undefined,
): Promise<number> {
  if (subcommand !== "plan") {
    throw new UsageError(
      `Unknown walkthrough command "${subcommand ?? ""}". Use: aidt walkthrough plan.`,
    );
  }
  const summary = await collectDiff(root, await resolveSource(root, flags), config);
  const plan = planWalkthrough(summary.files, config.limits.sectionLines);
  if (flags.json) return print(JSON.stringify({ source: summary.source, ...plan }, null, 2));
  return print(formatPlan(summary.source, plan));
}
