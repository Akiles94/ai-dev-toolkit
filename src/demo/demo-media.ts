import { homedir } from "node:os";
import { join } from "node:path";
import type { AidtConfig } from "../shared/config/config.ts";

/** An offline Piper voice: its model name and, for voices with several people, which one. */
export interface Voice {
  readonly model: string;
  readonly speaker?: number;
}

/**
 * The voice for each language and gender, checked by pitch on a sample sentence (women above
 * 170 Hz, men below 150 Hz). Any other Piper voice: `demo.voice.model`.
 */
const VOICES: Record<string, Record<"female" | "male", Voice>> = {
  "en-US": { female: { model: "en_US-lessac-high" }, male: { model: "en_US-ryan-high" } },
  "en-GB": { female: { model: "en_GB-cori-high" }, male: { model: "en_GB-alan-medium" } },
  "es-ES": {
    female: { model: "es_ES-sharvard-medium", speaker: 1 },
    male: { model: "es_ES-davefx-medium" },
  },
  "es-419": { female: { model: "es_MX-claude-high" }, male: { model: "es_MX-ald-medium" } },
};

type DemoConfig = AidtConfig["demo"];

/** The configured voice, or why there is none. */
export function chooseVoice(demo: DemoConfig): Voice | string {
  const { model, speaker, language, gender } = demo.voice;
  if (model) return speaker === undefined ? { model } : { model, speaker };
  const voice = VOICES[language]?.[gender];
  if (voice) return voice;
  const known = Object.keys(VOICES).join(", ");
  return `no voice for ${language} ${gender}: use one of ${known}, or set demo.voice.model`;
}

/** Where voice models are kept; `~` is the user's home. */
export const voicesDir = (demo: DemoConfig): string => demo.voices.replace(/^~(?=$|\/)/, homedir());

/** The commands that install Piper and download a voice: the toolkit itself never downloads. */
export function setupCommands(demo: DemoConfig, voice: Voice): string[] {
  const [lang = "", name = "", quality = ""] = voice.model.split("-");
  const family = lang.split("_")[0];
  const url = `https://huggingface.co/rhasspy/piper-voices/resolve/main/${family}/${lang}/${name}/${quality}/${voice.model}`;
  const dir = demo.voices.replace(/^~(?=$|\/)/, "$HOME");
  return [
    "pipx install piper-tts                      # or pip; or set demo.piper to its path",
    `mkdir -p "${dir}"`,
    `curl -L -o "${dir}/${voice.model}.onnx" ${url}.onnx`,
    `curl -L -o "${dir}/${voice.model}.onnx.json" ${url}.onnx.json`,
  ];
}

/** A line the voice says, placed on the video's timeline, in milliseconds. */
export interface Cue {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly audio: string;
}

const clock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms));
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor(total / 60_000) % 60;
  const s = Math.floor(total / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(total % 1000, 3)}`;
};

/** WebVTT subtitles from the narration, one cue per line said. */
export const toVtt = (cues: readonly Cue[]): string =>
  `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${clock(c.start)} --> ${clock(c.end)}\n${c.text}\n`).join("\n")}`;

/** Paths of one render: the recorded browser video in, the final files out. */
export interface MixPaths {
  readonly video: string;
  readonly vtt: string;
  readonly mp4: string;
}

/**
 * ffmpeg arguments that lay each line on the timeline, mix them, optionally draw the subtitles
 * into the picture (`burned`), and compress to an H.264 MP4 that plays anywhere.
 */
export function mixArgs(cues: readonly Cue[], paths: MixPaths, burn: boolean): string[] {
  const args = ["-y", "-loglevel", "error", "-i", paths.video];
  for (const cue of cues) args.push("-i", cue.audio);
  const filters: string[] = [];
  if (cues.length > 0) {
    const delayed = cues.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.start)}:all=1[a${i}]`);
    const inputs = cues.map((_, i) => `[a${i}]`).join("");
    filters.push(...delayed, `${inputs}amix=inputs=${cues.length}:normalize=0[aout]`);
  }
  if (burn) {
    // Escaped once for the filter's option, then once for the filtergraph: a Windows `C:`
    // or a `'` in the path would otherwise end the file name.
    const option = paths.vtt.replace(/\\/g, "/").replace(/[\\':]/g, "\\$&");
    const file = option.replace(/[\\'[\],;]/g, "\\$&");
    filters.push(
      `[0:v]subtitles=${file}:force_style='FontSize=12,BorderStyle=3,Outline=6,Shadow=0,BackColour=&H40000000,OutlineColour=&H40000000,MarginV=18'[vout]`,
    );
  }
  if (filters.length > 0) args.push("-filter_complex", filters.join(";"));
  args.push("-map", burn ? "[vout]" : "0:v");
  if (cues.length > 0) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k");
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", "-preset", "slow");
  args.push("-movflags", "+faststart", paths.mp4);
  return args;
}

/** What a render left, for its report and the PR text. */
export interface RenderFacts {
  readonly title: string;
  readonly commit: string;
  readonly lengthMs: number;
  readonly bytes: number;
  readonly renderMs: number;
  readonly scenes: readonly { readonly title: string; readonly lines: readonly string[] }[];
}

const minutes = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The block to paste in the PR description, above the video dragged into it. */
export function prText(facts: RenderFacts): string {
  const size = (facts.bytes / 1_048_576).toFixed(1);
  return [
    `### Demo · ${facts.title}`,
    "",
    `<!-- Drag the video here: GitHub uploads it and plays it in the description. -->`,
    "",
    `${minutes(facts.lengthMs)} · rendered at \`${facts.commit}\` · ${size} MB · recorded by \`aidt demo render\` in ${Math.round(facts.renderMs / 1000)} s, no tokens`,
    "",
    "<details><summary>What the voice says</summary>",
    "",
    ...facts.scenes.flatMap((scene) => [
      `**${scene.title}**`,
      "",
      ...scene.lines.map((l) => `- ${l}`),
      "",
    ]),
    "</details>",
    "",
  ].join("\n");
}

/** `.aidt/tasks/feat-x/demo/low-stock.json` → `low-stock`: the name of every file it renders. */
export const slugOf = (scriptPath: string): string =>
  (scriptPath.split(/[\\/]/).at(-1) ?? "demo").replace(/\.json$/, "");

/** Where a render's files go, inside the configured output folder. */
export const outputPaths = (root: string, demo: DemoConfig, slug: string) => {
  const base = join(root, demo.output, slug);
  return { mp4: `${base}.mp4`, vtt: `${base}.vtt`, md: `${base}.md`, json: `${base}.json` };
};
