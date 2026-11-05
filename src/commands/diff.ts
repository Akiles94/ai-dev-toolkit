import type { DiffSummary, FileCategory, FileChange } from "../core/diff.ts";

const LABELS: Record<FileCategory, string> = {
  code: "Code",
  test: "Tests",
  config: "Config",
  noise: "Noise",
  formatting: "Formatting",
};

const ORDER: FileCategory[] = ["code", "test", "config", "noise", "formatting"];

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function fileLine(file: FileChange): string {
  const size = file.binary ? "binary" : `+${file.added} −${file.deleted}`;
  const rename = file.oldPath ? ` (from ${file.oldPath})` : "";
  return `    ${file.path}${rename}  ${size}`;
}

function categoryBlock(summary: DiffSummary, category: FileCategory, listFiles: boolean): string[] {
  const t = summary.totals[category];
  if (t.files === 0) return [];
  const header = `${LABELS[category].padEnd(11)}${plural(t.files, "file").padEnd(10)} +${t.added} −${t.deleted}`;
  if (!listFiles) return [header];
  return [header, ...summary.files.filter((f) => f.category === category).map(fileLine)];
}

function sectionEstimate(summary: DiffSummary, sectionLines: number): string {
  const reviewable = summary.totals.code.added + summary.totals.code.deleted;
  const sections = Math.max(1, Math.ceil(reviewable / sectionLines));
  return `Reviewable lines: ${reviewable} · limit ${sectionLines} per section → at least ${plural(sections, "section")}`;
}

/** Human-readable report for `aidt diff`. Code files are listed only on request: they are many. */
export function formatDiff(
  summary: DiffSummary,
  { sectionLines, listCodeFiles }: { sectionLines: number; listCodeFiles: boolean },
): string {
  const blocks = ORDER.flatMap((category) =>
    categoryBlock(summary, category, listCodeFiles || category !== "code"),
  );
  return [
    `Source: ${summary.source}`,
    "",
    ...blocks,
    "",
    sectionEstimate(summary, sectionLines),
  ].join("\n");
}
