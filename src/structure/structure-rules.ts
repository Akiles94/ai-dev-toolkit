import type { AidtConfig } from "../shared/config/config.ts";

/** A source file the audit looks at: its repository path (`/`-separated) and line count. */
export interface SourceFile {
  readonly path: string;
  readonly lines: number;
}

/** One broken rule of `structure/rules.md`, on a file or a folder. */
export interface Finding {
  readonly rule: "S1" | "S2" | "S3" | "S4" | "S5";
  readonly path: string;
  readonly message: string;
}

type Rules = AidtConfig["structure"];

const dirOf = (path: string): string => path.split("/").slice(0, -1).join("/");
const baseOf = (path: string): string => path.split("/").at(-1) ?? path;
/** `orders.api.ts` → `orders`: the name before any role suffix or extension. */
const stemOf = (path: string): string => baseOf(path).split(".")[0] ?? "";
const extOf = (path: string): string => baseOf(path).split(".").at(-1) ?? "";
/** `formatUtils`, `format-utils`, `format_utils` → `["format", "utils"]`. */
const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** Files grouped by the folder that holds them directly. */
function byFolder(files: readonly SourceFile[]): Map<string, SourceFile[]> {
  const folders = new Map<string, SourceFile[]>();
  for (const file of files) {
    const dir = dirOf(file.path);
    folders.set(dir, [...(folders.get(dir) ?? []), file]);
  }
  return folders;
}

/** The subfolders of each folder, derived from the file paths. */
function subfolders(files: readonly SourceFile[]): Map<string, Set<string>> {
  const children = new Map<string, Set<string>>();
  for (const file of files) {
    const parts = dirOf(file.path).split("/").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(0, i).join("/");
      children.set(parent, (children.get(parent) ?? new Set()).add(parts[i] as string));
    }
  }
  return children;
}

const isUmbrella = (dir: string, rules: Rules): boolean =>
  rules.umbrellaNames.includes(baseOf(dir).toLowerCase());

/** S1: junk-drawer folders and files, and umbrella folders with loose files. */
function junkDrawers(files: readonly SourceFile[], rules: Rules): Finding[] {
  const findings = new Map<string, Finding>();
  for (const { path } of files) {
    const parts = path.split("/");
    parts.slice(0, -1).forEach((part, i) => {
      if (!rules.junkNames.includes(part.toLowerCase())) return;
      const dir = parts.slice(0, i + 1).join("/");
      findings.set(dir, { rule: "S1", path: `${dir}/`, message: "junk-drawer folder" });
    });
    if (words(stemOf(path)).some((w) => rules.junkNames.includes(w))) {
      findings.set(path, { rule: "S1", path, message: "junk-drawer file" });
    }
  }
  for (const [dir, inside] of byFolder(files)) {
    if (!dir || !isUmbrella(dir, rules)) continue;
    const loose = inside.map((f) => baseOf(f.path)).join(", ");
    findings.set(dir, { rule: "S1", path: `${dir}/`, message: `loose files in ${dir}: ${loose}` });
  }
  return [...findings.values()];
}

/** S2: one file for everything of a kind, at a source root or in an umbrella folder. */
function globalFiles(files: readonly SourceFile[], rules: Rules): Finding[] {
  return files
    .filter(({ path }) => rules.globalNames.includes(stemOf(path).toLowerCase()))
    .filter(({ path }) => dirOf(path).split("/").length <= 1 || isUmbrella(dirOf(path), rules))
    .map(({ path }) => ({
      rule: "S2",
      path,
      message: "one file for the whole app: split it by feature",
    }));
}

/** S3: files over the line limit and folders over the file limit. */
function oversized(files: readonly SourceFile[], rules: Rules): Finding[] {
  const big: Finding[] = files
    .filter((f) => f.lines > rules.maxFileLines)
    .map((f) => ({
      rule: "S3",
      path: f.path,
      message: `${f.lines} lines (max ${rules.maxFileLines})`,
    }));
  const crowded: Finding[] = [...byFolder(files)]
    .filter(([, inside]) => inside.length > rules.maxFolderFiles)
    .map(([dir, inside]) => ({
      rule: "S3",
      path: `${dir}/`,
      message: `${inside.length} files directly inside (max ${rules.maxFolderFiles})`,
    }));
  return [...big, ...crowded];
}

/** S4: files that are not entry points, sitting among two or more folders. */
function looseFiles(files: readonly SourceFile[], rules: Rules): Finding[] {
  const children = subfolders(files);
  return files
    .filter(({ path }) => (children.get(dirOf(path))?.size ?? 0) >= 2)
    .filter(({ path }) => !isUmbrella(dirOf(path), rules))
    .filter(({ path }) => !rules.entryNames.includes(stemOf(path).toLowerCase()))
    .map(({ path }) => ({ rule: "S4", path, message: "loose file among folders" }));
}

type Casing = "kebab-case" | "snake_case" | "camelCase" | "PascalCase";

/** The casing of a name, or `undefined` when it fits several (`orders`). */
function casingOf(name: string): Casing | undefined {
  if (/^[A-Z][A-Za-z0-9]*$/.test(name)) return "PascalCase";
  if (/^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/.test(name)) return "camelCase";
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(name)) return "kebab-case";
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(name)) return "snake_case";
  return undefined;
}

/** S5: per extension, the files whose casing differs from the most common one. */
function mixedNaming(files: readonly SourceFile[]): Finding[] {
  const byExt = new Map<string, Map<Casing, string[]>>();
  for (const { path } of files) {
    const casing = casingOf(stemOf(path));
    if (!casing) continue;
    const casings = byExt.get(extOf(path)) ?? new Map<Casing, string[]>();
    byExt.set(extOf(path), casings.set(casing, [...(casings.get(casing) ?? []), path]));
  }
  return [...byExt].flatMap(([ext, casings]) => {
    const [main, ...others] = [...casings].sort((a, b) => b[1].length - a[1].length);
    return others.flatMap(([casing, paths]) =>
      paths.map((path) => ({
        rule: "S5" as const,
        path,
        message: `${casing} among .${ext} files that are mostly ${main?.[0]}`,
      })),
    );
  });
}

/** Checks the common structure rules S1–S5 over the project's source files (tests excluded). */
export function auditStructure(files: readonly SourceFile[], rules: Rules): Finding[] {
  return [
    ...junkDrawers(files, rules),
    ...globalFiles(files, rules),
    ...oversized(files, rules),
    ...looseFiles(files, rules),
    ...mixedNaming(files),
  ];
}

/** The globs in backticks under `## Exceptions` of the structure decision. */
export function exceptionGlobs(decision: string): string[] {
  const section = decision.replace(/<!--[\s\S]*?-->/g, "").split(/^## Exceptions\s*$/m)[1] ?? "";
  const body = section.split(/^## /m)[0] ?? "";
  return [...body.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
}
