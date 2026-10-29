import type { DiffSummary, FileCategory } from "../core/diff.ts";

const LABELS: Record<FileCategory, string> = {
  code: "Code",
  test: "Tests",
  config: "Config",
  noise: "Noise",
  formatting: "Formatting",
};

const ORDER: FileCategory[] = ["code", "test", "config", "noise", "formatting"];

/** Human-readable report for `aidt diff`. */
export function formatDiff(summary: DiffSummary, sectionLines: number, listFiles: boolean): string {
  const lines = [`Source: ${summary.source}`, ""];

  for (const category of ORDER) {
    const t = summary.totals[category];
    if (t.files === 0) continue;
    const files = `${t.files} file${t.files === 1 ? "" : "s"}`;
    lines.push(`${LABELS[category].padEnd(11)}${files.padEnd(10)} +${t.added} −${t.deleted}`);
    if (listFiles || category !== "code") {
      for (const file of summary.files.filter((f) => f.category === category)) {
        const size = file.binary ? "binary" : `+${file.added} −${file.deleted}`;
        const rename = file.oldPath ? ` (from ${file.oldPath})` : "";
        lines.push(`    ${file.path}${rename}  ${size}`);
      }
    }
  }

  const { code } = summary.totals;
  const reviewable = code.added + code.deleted;
  const sections = Math.max(1, Math.ceil(reviewable / sectionLines));
  const plural = sections === 1 ? "" : "s";
  lines.push(
    "",
    `Reviewable lines: ${reviewable} · limit ${sectionLines} per section → at least ${sections} section${plural}`,
  );
  return lines.join("\n");
}
