import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../shared/config/config.ts";
import {
  chooseVoice,
  mixArgs,
  outputPaths,
  prText,
  setupCommands,
  slugOf,
  toVtt,
  voicesDir,
} from "./demo-media.ts";

const demo = DEFAULT_CONFIG.demo;
const withVoice = (voice: Partial<typeof demo.voice>) => ({
  ...demo,
  voice: { ...demo.voice, ...voice },
});

describe("chooseVoice", () => {
  it("picks a voice by language and gender, a woman in American English by default", () => {
    expect(chooseVoice(demo)).toEqual({ model: "en_US-lessac-high" });
    expect(chooseVoice(withVoice({ language: "es-419", gender: "male" }))).toEqual({
      model: "es_MX-ald-medium",
    });
    expect(chooseVoice(withVoice({ language: "es-ES" }))).toEqual({
      model: "es_ES-sharvard-medium",
      speaker: 1,
    });
  });

  it("uses the named model when there is one", () => {
    expect(chooseVoice(withVoice({ model: "en_GB-vctk-medium", speaker: 4 }))).toEqual({
      model: "en_GB-vctk-medium",
      speaker: 4,
    });
  });

  it("explains a language it has no voice for", () => {
    expect(chooseVoice(withVoice({ language: "fr-FR" }))).toContain(
      "no voice for fr-FR female: use one of en-US, en-GB, es-ES, es-419",
    );
  });
});

describe("setup", () => {
  it("prints the commands to install the voice, never downloads it", () => {
    const commands = setupCommands(demo, { model: "es_MX-claude-high" });
    expect(commands[0]).toContain("pipx install piper-tts");
    expect(commands[2]).toBe(
      'curl -L -o "$HOME/.cache/aidt/voices/es_MX-claude-high.onnx" https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx',
    );
  });

  it("expands ~ to the home folder", () => {
    expect(voicesDir(demo).startsWith("~")).toBe(false);
  });
});

const cues = [
  { text: "First line.", start: 40, end: 2954, audio: "/w/0.wav" },
  { text: "Second line.", start: 61_500, end: 63_000, audio: "/w/1.wav" },
];

describe("subtitles", () => {
  it("writes one WebVTT cue per line, on the video's clock", () => {
    expect(toVtt(cues)).toBe(
      "WEBVTT\n\n1\n00:00:00.040 --> 00:00:02.954\nFirst line.\n\n2\n00:01:01.500 --> 00:01:03.000\nSecond line.\n",
    );
  });
});

describe("mixArgs", () => {
  const paths = { video: "/w/v.webm", vtt: "/w/s.vtt", mp4: "/out/d.mp4" };

  it("lays each line at its moment and mixes them over the video", () => {
    const args = mixArgs(cues, paths, false).join(" ");
    expect(args).toContain("-i /w/v.webm -i /w/0.wav -i /w/1.wav");
    expect(args).toContain(
      "[1:a]adelay=40:all=1[a0];[2:a]adelay=61500:all=1[a1];[a0][a1]amix=inputs=2",
    );
    expect(args).toContain("-map 0:v -map [aout]");
    expect(args).not.toContain("subtitles=");
    expect(args.endsWith("/out/d.mp4")).toBe(true);
  });

  it("escapes a Windows path and a quote for the subtitles filter", () => {
    const vtt = "C:\\Users\\o'brien\\AppData\\Local\\Temp\\aidt-demo-x\\subtitles.vtt";
    const args = mixArgs(cues, { ...paths, vtt }, true).join(" ");
    expect(args).toContain(
      "subtitles=C\\\\:/Users/o\\\\\\'brien/AppData/Local/Temp/aidt-demo-x/subtitles.vtt:force_style",
    );
  });

  it("draws the subtitles into the picture when they are burned", () => {
    const args = mixArgs(cues, paths, true).join(" ");
    expect(args).toContain("[0:v]subtitles=/w/s.vtt:force_style");
    expect(args).toContain("-map [vout]");
  });

  it("makes a silent video when nothing is said", () => {
    const args = mixArgs([], paths, false);
    expect(args).not.toContain("-filter_complex");
    expect(args).not.toContain("[aout]");
  });
});

describe("what a render leaves", () => {
  const facts = {
    title: "Low-stock page",
    commit: "a1b2c3d",
    lengthMs: 125_400,
    bytes: 3_250_000,
    renderMs: 61_000,
    scenes: [{ title: "The admin opens the page", lines: ["First line."] }],
  };

  it("writes a PR text with the length, the commit, the size and what the voice says", () => {
    const text = prText(facts);
    expect(text).toContain("2:05 · rendered at `a1b2c3d` · 3.1 MB");
    expect(text).toContain("**The admin opens the page**\n\n- First line.");
  });

  it("names every file after the script, in the output folder", () => {
    expect(slugOf(".aidt/tasks/feat-x/demo/low-stock.json")).toBe("low-stock");
    expect(outputPaths("/repo", demo, "low-stock").mp4).toBe("/repo/.aidt/demo/low-stock.mp4");
  });
});
