/**
 * Guide comments are the verbose, tutorial-style comments the builder writes so the developer
 * can follow each section. They are always marked so removing them is a text operation, never
 * a judgement call. With MARKER standing for the configured marker (default "@" + "guide"):
 *
 *   // MARKER: we check the limit before the password, so blocked IPs never hit the DB.
 *   # MARKER: same idea in Python, shell or YAML
 *   <!-- MARKER: and in HTML or Markdown -->
 *   * MARKER: or inside an existing block comment
 *   doSomething(); // MARKER: trailing form, only the comment is removed
 *
 * The literal marker is not written here on purpose: this file would clean itself.
 */

export interface StripResult {
  content: string;
  removed: number;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function patterns(marker: string) {
  const m = escapeRegExp(marker);
  return {
    /** The whole line is a guide comment. */
    fullLine: new RegExp(String.raw`^\s*(?://|#|--|;|/\*+|\*|<!--)\s*${m}\b`),
    /** A guide comment after code on the same line. */
    trailing: new RegExp(String.raw`\s+(?://|#)\s*${m}\b.*$`),
  };
}

export interface StripOptions {
  /** Leave fenced code blocks (```) untouched: in Markdown they are examples, not guides. */
  skipFences?: boolean;
}

const FENCE = /^\s*(```|~~~)/;

/** Files whose fenced code blocks are documentation examples. */
export const isMarkdown = (path: string): boolean => /\.(md|mdx|markdown)$/i.test(path);

/** Removes guide comments, keeping the file's line endings and every other comment intact. */
export function stripGuides(
  content: string,
  marker: string,
  options: StripOptions = {},
): StripResult {
  const { fullLine, trailing } = patterns(marker);
  const parts = content.split(/(\r?\n)/);
  const kept: string[] = [];
  let removed = 0;
  let inFence = false;

  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i] ?? "";
    const eol = parts[i + 1] ?? "";
    const isFence = options.skipFences === true && FENCE.test(line);
    if (isFence) inFence = !inFence;
    if (isFence || inFence) {
      kept.push(line, eol);
      continue;
    }
    if (fullLine.test(line)) {
      removed++;
      continue;
    }
    if (trailing.test(line)) {
      removed++;
      kept.push(line.replace(trailing, ""), eol);
      continue;
    }
    kept.push(line, eol);
  }
  return { content: kept.join(""), removed };
}

/** Counts guide comments without changing anything. */
export function countGuides(content: string, marker: string, options: StripOptions = {}): number {
  return stripGuides(content, marker, options).removed;
}
