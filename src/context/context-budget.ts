/** A file a session reads, as the check sees it: where it is and what it says. */
export interface ContextFile {
  readonly path: string;
  readonly text: string;
  /** The file whose `@` import brought it in, when it was not configured directly. */
  readonly importedBy?: string;
}

/** A part of a file under one heading, with its size: what to move when a layer is too big. */
export interface Section {
  readonly heading: string;
  readonly tokens: number;
}

/** One layer measured against its budget (`always`: loaded by the tool; `start`: read first). */
export interface LayerReport {
  readonly name: "always" | "start";
  readonly budget: number;
  readonly tokens: number;
  readonly over: boolean;
  readonly files: readonly {
    readonly path: string;
    readonly tokens: number;
    readonly importedBy?: string;
    /** Only for the files of a layer over budget: its three largest sections. */
    readonly largest: readonly Section[];
  }[];
}

/** One path of the status's «Read first» list, and what reading it costs the next session. */
export interface ReadingItem {
  readonly path: string;
  readonly exists: boolean;
  readonly tokens: number;
}

/**
 * Tokens estimated as characters / 4. Not any model's tokenizer: an approximation that is the
 * same on every machine and needs no dependency, enough to see a file grow and stop it.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/;

/** Fenced code blocks and inline code removed, so examples are never read as imports or lists. */
const withoutCode = (markdown: string): string =>
  markdown.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "");

/** The file cut at every heading from `##` down to `deepest`; what precedes the first is `(top)`. */
function splitAt(lines: readonly string[], deepest: number): Section[] {
  const sections: { heading: string; text: string }[] = [{ heading: "(top)", text: "" }];
  for (const line of lines) {
    const level = HEADING.exec(line)?.[1]?.length ?? 0;
    if (level > 1 && level <= deepest) sections.push({ heading: line.trim(), text: "" });
    const current = sections.at(-1) as { text: string };
    current.text += `${line}\n`;
  }
  return sections
    .map(({ heading, text }) => ({ heading, tokens: estimateTokens(text) }))
    .filter((section) => section.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * The largest parts of a Markdown file, heaviest first. It cuts at `##`, and one level deeper
 * while a single part still holds more than half the file, so a status whose history sits under
 * one heading points at the blocks inside it.
 */
export function largestSections(markdown: string, count = 3): Section[] {
  const lines = markdown.split("\n");
  const levels = [...new Set(lines.map((line) => HEADING.exec(line)?.[1]?.length ?? 0))]
    .filter((level) => level > 1)
    .sort();
  const half = estimateTokens(markdown) / 2;
  let sections = splitAt(lines, 1);
  for (const level of levels) {
    sections = splitAt(lines, level);
    if ((sections[0]?.tokens ?? 0) <= half) break;
  }
  return sections.slice(0, count);
}

/** Drops what usually follows a path in prose: a trailing period, comma, colon or bracket. */
const trimPunctuation = (path: string): string => path.replace(/[.,;:!?)\]]+$/, "");

/**
 * Claude Code's `@path` imports in a rules file, relative to that file, outside code. Absolute and
 * home paths are left out: they are outside the repository. Whether each one exists is up to the
 * caller, so a mention such as `@octocat` is simply not found.
 */
export function importsOf(markdown: string): string[] {
  const paths = [...withoutCode(markdown).matchAll(/(?:^|\s)@(\S+)/gm)].map((m) =>
    trimPunctuation(m[1] ?? ""),
  );
  return [...new Set(paths.filter((p) => p && !p.startsWith("/") && !p.startsWith("~")))];
}

/** `src/a.ts:12` or `docs/x.md#part` → the file alone. */
const fileOnly = (path: string): string => path.replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, "");

/** Paths named in one list item: in backticks or as the target of a relative link. */
function pathsInItem(item: string): string[] {
  const quoted = [...item.matchAll(/`([^`\s]+)`/g)].map((m) => m[1] ?? "");
  const linked = [...item.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1] ?? "")
    .filter((target) => !/^[a-z]+:/i.test(target));
  return [...quoted, ...linked].filter((p) => p.includes("/") || p.includes(".")).map(fileOnly);
}

/**
 * The paths of the «Read first» list in a status file: the list items under a heading named
 * «Read first», up to the next heading of the same or a higher level. HTML comments (a template's
 * instructions) are skipped.
 */
export function readingList(markdown: string): string[] {
  const paths: string[] = [];
  let level = 0;
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const heading = HEADING.exec(line);
    if (heading) {
      const depth = heading[1]?.length ?? 0;
      if (level > 0 && depth <= level) level = 0;
      if (/^read first\b/i.test(heading[2] ?? "")) level = depth;
      continue;
    }
    if (level > 0 && /^\s*([-*+]|\d+\.)\s/.test(line)) paths.push(...pathsInItem(line));
  }
  return [...new Set(paths)];
}

/** Measures one layer; when it is over budget, each file says which of its sections weigh most. */
export function measureLayer(
  name: LayerReport["name"],
  files: readonly ContextFile[],
  budget: number,
): LayerReport {
  const sized = files.map((file) => ({ file, tokens: estimateTokens(file.text) }));
  const tokens = sized.reduce((sum, { tokens }) => sum + tokens, 0);
  const over = tokens > budget;
  return {
    name,
    budget,
    tokens,
    over,
    files: sized.map(({ file, tokens }) => ({
      path: file.path,
      tokens,
      ...(file.importedBy ? { importedBy: file.importedBy } : {}),
      largest: over ? largestSections(file.text) : [],
    })),
  };
}
