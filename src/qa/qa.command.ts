import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";
import { prepareIgnoredFolder, readJsonFile } from "../shared/browser/files.ts";
import { INSTALL_PLAYWRIGHT, loadPlaywright } from "../shared/browser/playwright.ts";
import { type CliContext, print, UsageError } from "../shared/cli/cli-context.ts";
import { git } from "../shared/git/git.ts";
import { type Call, parseWalk, type StepLog, type WalkLog } from "./qa-walk.ts";
import { playWalk } from "./qa-walker.ts";

const ANSWER_TIMEOUT_MS = 3000;
const TEXT_LINES = 30;
const LINE_CHARS = 120;

/** Whether anything answers at `url`, whatever its status: the walk needs the app running. */
const answers = (url: string): Promise<boolean> =>
  fetch(url, { signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS) }).then(
    () => true,
    () => false,
  );

/** The commit the walk ran on, marked when the code has changes not committed yet. */
async function walkedAt(root: string): Promise<string> {
  const head = await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => "");
  if (!head.trim()) return "no commit";
  const changes = await git(root, ["status", "--porcelain", "--", ".", ":!.aidt"]).catch(() => "");
  return changes.trim() ? `${head.trim()} with uncommitted changes` : head.trim();
}

const failed = (call: Call) => typeof call.status === "string" || call.status >= 400;

function stepLines(root: string, step: StepLog): string[] {
  const shown = (path: string) => relative(root, path);
  const indent = (line: string) => `      ${line}`;
  const lines = [`${String(step.n).padStart(2)} ${step.person.padEnd(10)} ${step.step}`];
  if (step.calls.length > 0)
    lines.push(indent(step.calls.map((c) => `${c.method} ${c.path} ${c.status}`).join(" · ")));
  if (step.answer) lines.push(indent(step.answer));
  for (const error of step.consoleErrors) lines.push(indent(`console error: ${error}`));
  for (const error of step.pageErrors) lines.push(indent(`page error: ${error}`));
  if (step.failure) lines.push(indent(`✗ ${step.failure}`));
  if (step.screenshot) lines.push(indent(`screenshot: ${shown(step.screenshot)}`));
  if (step.text !== undefined) {
    const text = step.text.split("\n").filter((line) => line.trim() !== "");
    const cut = (line: string) =>
      line.length > LINE_CHARS ? `${line.slice(0, LINE_CHARS)}…` : line;
    lines.push(...text.slice(0, TEXT_LINES).map((line) => indent(`│ ${cut(line)}`)));
    if (text.length > TEXT_LINES)
      lines.push(
        indent(
          `│ … ${text.length - TEXT_LINES} more line(s) in ${shown(step.screenshot ?? "").replace(/\.png$/, ".txt")}`,
        ),
      );
  }
  return lines;
}

/** The walk as the QA reads it: each step with what the app answered, then what went wrong. */
export function formatWalk(root: string, log: WalkLog, commit: string, logPath: string): string {
  const stepsWith = (has: (s: StepLog) => boolean) =>
    log.steps
      .filter(has)
      .map((s) => s.n)
      .join(", ");
  const count = (pick: (s: StepLog) => number) => log.steps.reduce((sum, s) => sum + pick(s), 0);
  const failedCalls = count((s) => s.calls.filter(failed).length);
  const consoleErrors = count((s) => s.consoleErrors.length);
  const pageErrors = count((s) => s.pageErrors.length);
  const last = log.steps.at(-1);
  return [
    `Walk «${log.title}» · ${log.url} · at ${commit}`,
    ...log.steps.flatMap((step) => stepLines(root, step)),
    log.stopped && last
      ? `Stopped at step ${last.n} (${last.step}): what the screen showed instead is in its screenshot.`
      : `Walked all ${log.steps.length} step(s).`,
    [
      `Calls that failed or answered 4xx/5xx: ${failedCalls}${failedCalls ? ` (step ${stepsWith((s) => s.calls.some(failed))})` : ""}`,
      `console errors: ${consoleErrors}${consoleErrors ? ` (step ${stepsWith((s) => s.consoleErrors.length > 0)})` : ""}`,
      `page errors: ${pageErrors}${pageErrors ? ` (step ${stepsWith((s) => s.pageErrors.length > 0)})` : ""}`,
    ].join(" · "),
    `Log: ${relative(root, logPath)}`,
  ].join("\n");
}

/** `aidt qa walk <file> [--json]`: plays a walk in a real browser, with no model. */
async function walkCommand(context: CliContext, file: string | undefined): Promise<number> {
  const { root, config, flags } = context;
  if (!file)
    throw new UsageError("Name the walk: aidt qa walk .aidt/tasks/<task>/qa/walks/<name>.json");
  const walk = await readJsonFile(root, file, "QA walk", parseWalk);
  const playwright = loadPlaywright(root);
  if (!playwright) {
    print(`Missing to walk. Run:\n  ${INSTALL_PLAYWRIGHT}`);
    return 2;
  }
  if (!(await answers(walk.app.url))) {
    print(
      `Nothing answers at ${walk.app.url}. Start the app as .aidt/app.md says, then walk again.`,
    );
    return 2;
  }
  await prepareIgnoredFolder(
    root,
    config.qa.output,
    "QA walks: screenshots, page texts and logs, made again by running the walk files.",
  );
  const outDir = join(root, config.qa.output, basename(file, extname(file)));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const commit = await walkedAt(root);
  const log = await playWalk(playwright, walk, outDir);
  const logPath = join(outDir, "walk.json");
  await writeFile(logPath, `${JSON.stringify({ ...log, commit }, null, 2)}\n`);
  print(
    flags.json
      ? JSON.stringify({ ...log, commit }, null, 2)
      : formatWalk(root, log, commit, logPath),
  );
  return log.stopped ? 1 : 0;
}

/** `aidt qa <action>`. */
export async function qaCommand(context: CliContext, rest: string[]): Promise<number> {
  const [action, file] = rest;
  if (action === "walk") return walkCommand(context, file);
  throw new UsageError(`Unknown qa action "${action ?? ""}". Use: aidt qa walk <file> [--json]`);
}
