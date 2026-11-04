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

interface StripResult {
  content: string;
  removed: number;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Comment openers that may span several lines, with what closes them. */
const BLOCK_CLOSERS: Record<string, string> = { "{/*": "*/", "/*": "*/", "<!--": "-->" };

function patterns(marker: string) {
  const m = escapeRegExp(marker);
  return {
    /** The line starts a guide comment (`//`, `#`, `--`, `;`, `/*`, JSX `{/*`, `*`, `<!--`). */
    fullLine: new RegExp(String.raw`^\s*(\{/\*+|/\*+|<!--|//|#|--|;|\*)\s*${m}\b`),
    /** A guide comment after code on the same line. */
    trailing: new RegExp(String.raw`\s+(?://|#)\s*${m}\b.*$`),
  };
}

interface StripOptions {
  /** Leave fenced code blocks (```) untouched: in Markdown they are examples, not guides. */
  skipFences?: boolean;
}

const FENCE = /^\s*(```|~~~)/;

/** Files whose fenced code blocks are documentation examples. */
export const isMarkdown = (path: string): boolean => /\.(md|mdx|markdown)$/i.test(path);

type Patterns = ReturnType<typeof patterns>;

/** The closer still pending when a guide block comment opens on this line and does not end on it. */
function openBlock(line: string, opener: string): string | undefined {
  const normalized = opener.replace(/\*+$/, "*");
  const closer = BLOCK_CLOSERS[normalized];
  if (closer === undefined) return undefined;
  const rest = line.slice(line.indexOf(opener) + opener.length);
  return rest.includes(closer) ? undefined : closer;
}

interface LineState {
  inFence: boolean;
  /** Set while inside a multi-line guide block comment: the text that ends it. */
  closer: string | undefined;
}

/** What to keep of one line, or `null` to drop it; updates the fence and block state. */
function stripLine(
  line: string,
  state: LineState,
  p: Patterns,
  skipFences: boolean,
): string | null {
  const isFence = skipFences && FENCE.test(line);
  if (isFence) state.inFence = !state.inFence;
  if (isFence || state.inFence) return line;
  if (state.closer !== undefined) {
    if (line.includes(state.closer)) state.closer = undefined;
    return null;
  }
  const guide = p.fullLine.exec(line);
  if (guide) {
    state.closer = openBlock(line, guide[1] ?? "");
    return null;
  }
  return p.trailing.test(line) ? line.replace(p.trailing, "") : line;
}

/**
 * Removes guide comments, keeping the file's line endings and every other comment intact. A guide
 * block comment (`/* … *\/`, JSX `{/* … *\/}`, `<!-- … -->`) is removed whole, even when only its
 * first line carries the marker.
 */
export function stripGuides(
  content: string,
  marker: string,
  options: StripOptions = {},
): StripResult {
  const p = patterns(marker);
  const parts = content.split(/(\r?\n)/);
  const state: LineState = { inFence: false, closer: undefined };
  const kept: string[] = [];
  let removed = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i] ?? "";
    const result = stripLine(line, state, p, options.skipFences === true);
    if (result === null) removed++;
    else kept.push(result, parts[i + 1] ?? "");
    if (result !== null && result !== line) removed++;
  }
  return { content: kept.join(""), removed };
}
