import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { type CliContext, print, UsageError } from "../shared/cli/cli-context.ts";
import { git } from "../shared/git/git.ts";
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
import { loadPlaywright, record, runWithInput, type Speech } from "./demo-recorder.ts";
import { type DemoScript, narration, parseScript } from "./demo-script.ts";

const exec = promisify(execFile);

/** Whether a command runs at all: the tools a render needs are checked before anything starts. */
const runs = (command: string, args: string[]): Promise<boolean> =>
  exec(command, args).then(
    () => true,
    () => false,
  );

/**
 * What is missing to render, as the commands that install it; empty when everything is there.
 * A demo with nothing to say needs no voice.
 */
async function missingTools(
  root: string,
  context: CliContext,
  voice: Voice,
  speaks: boolean,
): Promise<string[]> {
  const { demo } = context.config;
  const missing: string[] = [];
  if (!loadPlaywright(root))
    missing.push("npm install -D playwright && npx playwright install chromium");
  if (!(await runs("ffmpeg", ["-version"])))
    missing.push("install ffmpeg (https://ffmpeg.org/download.html)");
  const model = join(voicesDir(demo), `${voice.model}.onnx`);
  if (speaks && (!(await runs(demo.piper, ["--help"])) || !existsSync(model)))
    missing.push(...setupCommands(demo, voice));
  return missing;
}

/** Turns every line into speech before recording, so the video never waits on the voice. */
async function speak(
  context: CliContext,
  voice: Voice,
  lines: string[],
  workDir: string,
): Promise<Speech[]> {
  const { demo } = context.config;
  const model = join(voicesDir(demo), `${voice.model}.onnx`);
  const speeches: Speech[] = [];
  for (const [i, text] of lines.entries()) {
    const audio = join(workDir, `line-${i}.wav`);
    const speaker = voice.speaker === undefined ? [] : ["-s", String(voice.speaker)];
    await runWithInput(demo.piper, ["-m", model, ...speaker, "-f", audio], text);
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      audio,
    ]);
    speeches.push({ text, audio, durationMs: Math.round(Number.parseFloat(stdout) * 1000) });
  }
  return speeches;
}

/** Starts the product as the script says and waits until its address answers (60 s at most). */
async function startApp(root: string, script: DemoScript): Promise<ChildProcess | undefined> {
  const up = () =>
    fetch(script.app.url).then(
      () => true,
      () => false,
    );
  if (!script.app.start || (await up())) return undefined;
  const child = spawn(script.app.start, {
    cwd: root,
    shell: true,
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  for (let waited = 0; waited < 60_000; waited += 500) {
    if (await up()) return child;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  stopApp(child);
  throw new UsageError(
    `${script.app.url} did not answer within 60 s after \`${script.app.start}\`.`,
  );
}

function stopApp(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill();
    else process.kill(-child.pid);
  } catch {
    // Already gone.
  }
}

async function readScript(root: string, path: string): Promise<DemoScript> {
  const raw = await readFile(join(root, path), "utf8").catch(() => {
    throw new UsageError(`No demo script at ${path}.`);
  });
  const parsed = parseScript(JSON.parse(raw));
  if (!parsed.ok)
    throw new UsageError(`${path} is not a valid demo script:\n  ${parsed.error.join("\n  ")}`);
  return parsed.value;
}

/** `aidt demo render <script> [--sample]`: the script as a narrated video, with no model. */
async function render(context: CliContext, scriptPath: string | undefined): Promise<number> {
  const { root, config, flags } = context;
  if (!scriptPath)
    throw new UsageError("Name the script: aidt demo render .aidt/tasks/<task>/demo/<name>.json");
  const began = Date.now();
  const full = await readScript(root, scriptPath);
  const script = flags.sample ? { ...full, scenes: full.scenes.slice(0, 1) } : full;
  const voice = chooseVoice(config.demo);
  if (typeof voice === "string") throw new UsageError(voice);
  const missing = await missingTools(root, context, voice, narration(script).length > 0);
  if (missing.length > 0) {
    print(["Missing to render a demo. Run:", ...missing.map((m) => `  ${m}`)].join("\n"));
    return 2;
  }
  const playwright = loadPlaywright(root);
  if (!playwright) return 2;
  const workDir = await mkdtemp(join(tmpdir(), "aidt-demo-"));
  try {
    const speeches = await speak(context, voice, narration(script), workDir);
    const app = await startApp(root, script);
    const recorded = await record(playwright, script, speeches, workDir).finally(() =>
      stopApp(app),
    );
    if (!recorded.ok) {
      print(`Stopped at ${recorded.error}\nFix that step in ${scriptPath} and render again.`);
      return 1;
    }
    const slug = slugOf(scriptPath) + (flags.sample ? "-sample" : "");
    const out = outputPaths(root, config.demo, slug);
    await mkdir(join(root, config.demo.output), { recursive: true });
    const vtt = config.demo.subtitles === "file" ? out.vtt : join(workDir, "subtitles.vtt");
    await writeFile(vtt, toVtt(recorded.value.cues));
    const burn = config.demo.subtitles === "burned";
    await exec(
      "ffmpeg",
      mixArgs(recorded.value.cues, { video: recorded.value.video, vtt, mp4: out.mp4 }, burn),
    );
    const facts: RenderFacts = {
      title: script.title,
      commit: (await git(root, ["rev-parse", "--short", "HEAD"])).trim(),
      lengthMs: recorded.value.lengthMs,
      bytes: (await stat(out.mp4)).size,
      renderMs: Date.now() - began,
      scenes: script.scenes.map((s) => ({
        title: s.title,
        lines: s.steps.flatMap((st) => ("say" in st ? [st.say] : [])),
      })),
    };
    await writeFile(out.md, prText(facts));
    await writeFile(
      out.json,
      `${JSON.stringify({ ...facts, pageErrors: recorded.value.pageErrors }, null, 2)}\n`,
    );
    return print(formatRender(facts, out, recorded.value.pageErrors, config.demo.subtitles));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function formatRender(
  facts: RenderFacts,
  out: ReturnType<typeof outputPaths>,
  pageErrors: readonly string[],
  subtitles: string,
): string {
  const seconds = (ms: number) => `${Math.round(ms / 1000)} s`;
  return [
    `Demo: ${out.mp4}`,
    `    ${seconds(facts.lengthMs)} long · ${(facts.bytes / 1_048_576).toFixed(1)} MB · rendered in ${seconds(facts.renderMs)} · no tokens`,
    ...(subtitles === "file" ? [`    subtitles: ${out.vtt}`] : []),
    `    PR text: ${out.md} (paste it, then drag the video into the description)`,
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
