import { type ChildProcess, execFile } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { INSTALL_PLAYWRIGHT, loadPlaywright } from "../shared/browser/playwright.ts";
import { type CliContext, print, UsageError } from "../shared/cli/cli-context.ts";
import { git } from "../shared/git/git.ts";
import { startApp, stopApp } from "./demo-app.ts";
import {
  chooseVoice,
  mixArgs,
  outputPaths,
  prText,
  type RenderFacts,
  setupCommands,
  slugOf,
  toVtt,
  type Voice,
  voicesDir,
} from "./demo-media.ts";
import { record, runWithInput, type Speech } from "./demo-recorder.ts";
import { type DemoScript, narration, parseScript } from "./demo-script.ts";

const exec = promisify(execFile);

/** A recorded video shorter than the recording by more than this lost its start: record again. */
const DRIFT_MS = 1000;

const SUBTITLES = ["file", "burned", "none"];

/** Whether a command runs at all: the tools a render needs are checked before anything starts. */
const runs = (command: string, args: string[]): Promise<boolean> =>
  exec(command, args).then(
    () => true,
    () => false,
  );

/** The length of a media file in milliseconds, as ffprobe reads it. */
async function lengthOf(file: string): Promise<number> {
  const probe = ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file];
  const { stdout } = await exec("ffprobe", probe);
  return Math.round(Number.parseFloat(stdout) * 1000);
}

/**
 * What is missing to render, as the commands that install it; empty when everything is there.
 * A demo with nothing to say needs no voice.
 */
async function missingTools(context: CliContext, voice: Voice, speaks: boolean): Promise<string[]> {
  const { demo } = context.config;
  const missing: string[] = [];
  if (!loadPlaywright(context.root)) missing.push(INSTALL_PLAYWRIGHT);
  if (!(await runs("ffmpeg", ["-version"])))
    missing.push("install ffmpeg (https://ffmpeg.org/download.html)");
  const model = join(voicesDir(demo), `${voice.model}.onnx`);
  if (speaks && (!(await runs(demo.piper, ["--help"])) || !existsSync(model)))
    missing.push(...setupCommands(demo, voice));
  return missing;
}

/** Turns every line into speech before recording, so the video never waits on the voice. */
async function speak(context: CliContext, voice: Voice, lines: string[], workDir: string) {
  const { demo } = context.config;
  const model = join(voicesDir(demo), `${voice.model}.onnx`);
  const speaker = voice.speaker === undefined ? [] : ["-s", String(voice.speaker)];
  const speeches: Speech[] = [];
  for (const [i, text] of lines.entries()) {
    const audio = join(workDir, `line-${i}.wav`);
    await runWithInput(demo.piper, ["-m", model, ...speaker, "-f", audio], text);
    speeches.push({ text, audio, durationMs: await lengthOf(audio) });
  }
  return speeches;
}

async function readScript(root: string, path: string): Promise<DemoScript> {
  const raw = await readFile(resolve(root, path), "utf8").catch(() => {
    throw new UsageError(`No demo script at ${path}.`);
  });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = parseScript(json);
  if (!parsed.ok)
    throw new UsageError(`${path} is not a valid demo script:\n  ${parsed.error.join("\n  ")}`);
  return parsed.value;
}

/**
 * Records the script, and records it once more when the video lost its start (it came out shorter
 * than the time recorded, so the voice would drift from the picture).
 */
async function recordInSync(
  context: CliContext,
  script: DemoScript,
  speeches: Speech[],
  workDir: string,
) {
  const playwright = loadPlaywright(context.root);
  if (!playwright) throw new UsageError("Playwright is not installed.");
  for (let attempt = 1; ; attempt++) {
    const recorded = await record(playwright, script, speeches, workDir);
    if (!recorded.ok) return { ...recorded, atStep: true };
    const short = recorded.value.lengthMs - (await lengthOf(recorded.value.video));
    if (short <= DRIFT_MS) return { ...recorded, atStep: false };
    if (attempt === 2) {
      const error = `the recording lost ${short} ms at its start twice. Render again; if it keeps happening, the machine is too busy to record smoothly.`;
      return { ok: false as const, error, atStep: false };
    }
    print(`The video lost its first ${short} ms; recording again.`);
  }
}

/** While a render runs, Ctrl+C or a kill still stops the product and removes the work folder. */
function onInterrupt(cleanUp: () => void): () => void {
  const handler = () => {
    cleanUp();
    process.exit(130);
  };
  process.once("SIGINT", handler);
  process.once("SIGTERM", handler);
  return () => {
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}

/**
 * The output folder. When the render creates it, it gets a `.gitignore` so the videos stay out of
 * git; a folder that already existed is left as it is (it may hold files that are committed).
 */
async function prepareOutput(root: string, folder: string): Promise<void> {
  const full = join(root, folder);
  const created = await mkdir(full, { recursive: true });
  if (created !== undefined)
    await writeFile(
      join(full, ".gitignore"),
      "# Demo videos: rendered from their scripts, not committed.\n*\n",
    );
}

/** Mixes the recording with its voice into the final files, and returns what the render left. */
async function finish(
  context: CliContext,
  script: DemoScript,
  scriptPath: string,
  began: number,
  recorded: { video: string; cues: Parameters<typeof toVtt>[0]; pageErrors: readonly string[] },
  workDir: string,
) {
  const { root, config, flags } = context;
  const slug = slugOf(scriptPath) + (flags.sample ? "-sample" : "");
  const out = outputPaths(root, config.demo, slug);
  await prepareOutput(root, config.demo.output);
  const vtt = config.demo.subtitles === "file" ? out.vtt : join(workDir, "subtitles.vtt");
  await writeFile(vtt, toVtt(recorded.cues));
  const burn = config.demo.subtitles === "burned";
  await exec("ffmpeg", mixArgs(recorded.cues, { video: recorded.video, vtt, mp4: out.mp4 }, burn));
  const facts: RenderFacts = {
    title: script.title,
    commit: (await git(root, ["rev-parse", "--short", "HEAD"])).trim(),
    lengthMs: await lengthOf(out.mp4),
    bytes: (await stat(out.mp4)).size,
    renderMs: Date.now() - began,
    scenes: script.scenes.map((s) => ({
      title: s.title,
      lines: s.steps.flatMap((st) => ("say" in st ? [st.say] : [])),
    })),
  };
  await writeFile(out.md, prText(facts));
  const json = { ...facts, pageErrors: recorded.pageErrors };
  await writeFile(out.json, `${JSON.stringify(json, null, 2)}\n`);
  return print(formatRender(root, facts, out, recorded.pageErrors, config.demo.subtitles));
}

/** `aidt demo render <script> [--sample]`: the script as a narrated video, with no model. */
async function render(context: CliContext, scriptPath: string | undefined): Promise<number> {
  const { root, config, flags } = context;
  if (!scriptPath)
    throw new UsageError("Name the script: aidt demo render .aidt/tasks/<task>/demo/<name>.json");
  if (!SUBTITLES.includes(config.demo.subtitles))
    throw new UsageError(`demo.subtitles is "${config.demo.subtitles}": use file, burned or none.`);
  const began = Date.now();
  const full = await readScript(root, scriptPath);
  const script = flags.sample ? { ...full, scenes: full.scenes.slice(0, 1) } : full;
  const voice = chooseVoice(config.demo);
  if (typeof voice === "string") throw new UsageError(voice);
  const missing = await missingTools(context, voice, narration(script).length > 0);
  if (missing.length > 0) {
    print(["Missing to render a demo. Run:", ...missing.map((m) => `  ${m}`)].join("\n"));
    return 2;
  }
  const workDir = await mkdtemp(join(tmpdir(), "aidt-demo-"));
  let app: ChildProcess | undefined;
  const release = onInterrupt(() => {
    stopApp(app);
    rmSync(workDir, { recursive: true, force: true });
  });
  try {
    const speeches = await speak(context, voice, narration(script), workDir);
    const started = await startApp(root, config.demo.start, script.app.url, (child) => {
      app = child;
    });
    if (!started.ok) throw new UsageError(started.error);
    const recorded = await recordInSync(context, script, speeches, workDir).finally(() =>
      stopApp(app),
    );
    if (!recorded.ok) {
      print(
        recorded.atStep
          ? `Stopped at ${recorded.error}\nFix that step in ${scriptPath} and render again.`
          : `Stopped: ${recorded.error}`,
      );
      return 1;
    }
    return await finish(context, script, scriptPath, began, recorded.value, workDir);
  } finally {
    release();
    await rm(workDir, { recursive: true, force: true });
  }
}

function formatRender(
  root: string,
  facts: RenderFacts,
  out: ReturnType<typeof outputPaths>,
  pageErrors: readonly string[],
  subtitles: string,
): string {
  const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
  const shown = (path: string) => relative(root, path);
  return [
    `Demo: ${shown(out.mp4)}`,
    `    ${seconds(facts.lengthMs)} long · ${(facts.bytes / 1_048_576).toFixed(1)} MB · rendered in ${seconds(facts.renderMs)} · no tokens`,
    ...(subtitles === "file" ? [`    subtitles: ${shown(out.vtt)}`] : []),
    `    PR text: ${shown(out.md)} (paste it, then drag the video into the description)`,
    ...(pageErrors.length > 0
      ? [`    page errors while recording: ${pageErrors.join(" | ")}`]
      : []),
  ].join("\n");
}

/** `aidt demo <action>`. */
export async function demoCommand(context: CliContext, rest: string[]): Promise<number> {
  const [action, script] = rest;
  if (action === "render") return render(context, script);
  throw new UsageError(
    `Unknown demo action "${action ?? ""}". Use: aidt demo render <script> [--sample]`,
  );
}
