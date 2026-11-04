import { readFile } from "node:fs/promises";
import { join, matchesGlob } from "node:path";
import { type CliContext, print, UsageError } from "../shared/cli/cli-context.ts";
import type { AidtConfig } from "../shared/config/config.ts";
import { git } from "../shared/git/git.ts";
import {
  auditStructure,
  exceptionGlobs,
  type Finding,
  type SourceFile,
} from "./structure-rules.ts";

const matchesAny = (path: string, globs: readonly string[]): boolean =>
  globs.some((glob) => matchesGlob(path, glob));

/** Tracked and new files, never ignored ones. */
async function projectFiles(root: string): Promise<string[]> {
  const out = await git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  return [...new Set(out.split("\0").filter(Boolean))];
}

/** The source files to audit: by extension, without noise, config, tests or recorded exceptions. */
async function sourceFiles(root: string, config: AidtConfig): Promise<SourceFile[]> {
  const decision = await readFile(join(root, config.structure.decision), "utf8").catch(() => "");
  const skip = [
    ...config.limits.exclude,
    ...config.configFiles.patterns,
    ...config.tests.patterns,
    ...exceptionGlobs(decision),
  ];
  const extensions = new Set(config.structure.extensions);
  const paths = (await projectFiles(root))
    .filter((path) => extensions.has(path.split(".").at(-1) ?? ""))
    .filter((path) => !matchesAny(path, skip));
  const files: SourceFile[] = [];
  for (const path of paths) {
    const content = await readFile(join(root, path), "utf8").catch(() => undefined);
    if (content !== undefined) files.push({ path, lines: content.split("\n").length - 1 });
  }
  return files;
}

const RULE_NAMES: Record<Finding["rule"], string> = {
  S1: "No junk drawers",
  S2: "One module per resource",
  S3: "Small files and folders",
  S4: "No loose files",
  S5: "One naming convention",
};

function formatAudit(findings: Finding[], audited: number): string {
  if (findings.length === 0) return `Structure: ${audited} source files, no findings.`;
  const blocks = (Object.keys(RULE_NAMES) as Finding["rule"][]).flatMap((rule) => {
    const own = findings.filter((f) => f.rule === rule);
    if (own.length === 0) return [];
    return [
      `${rule} · ${RULE_NAMES[rule]} (${own.length})`,
      ...own.map((f) => `    ${f.path}  ${f.message}`),
    ];
  });
  return [
    `Structure: ${findings.length} finding(s) in ${audited} source files`,
    ...blocks,
    "",
    'Rules: .aidt/structure/rules.md · deliberate exceptions go under "## Exceptions" in .aidt/structure.md',
  ].join("\n");
}

/** `aidt structure audit [--json]`: exit 1 when a common structure rule is broken. */
async function audit({ root, config, flags }: CliContext): Promise<number> {
  const files = await sourceFiles(root, config);
  const findings = auditStructure(files, config.structure);
  print(
    flags.json
      ? JSON.stringify({ audited: files.length, findings }, null, 2)
      : formatAudit(findings, files.length),
  );
  return findings.length > 0 ? 1 : 0;
}

/** `aidt structure <action>`. */
export async function structureCommand(
  context: CliContext,
  action: string | undefined,
): Promise<number> {
  if (action === "audit") return audit(context);
  throw new UsageError(`Unknown structure action "${action ?? ""}". Use: aidt structure audit`);
}
