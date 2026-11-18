import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../shared/config/config.ts";
import { commitAll, featureRepo, write } from "../shared/testing/temp-repo.ts";
import { demoCommand } from "./demo.command.ts";
import { loadPlaywright } from "./demo-recorder.ts";

// A real render needs a browser, ffmpeg and a voice. Where they are missing (CI) it is skipped;
// the rules it relies on are covered by demo-script.test.ts and demo-media.test.ts.
const PIPER = process.env.AIDT_PIPER ?? join(homedir(), ".cache/aidt/piper-venv/bin/piper");
const VOICE = join(homedir(), ".cache/aidt/voices/en_US-lessac-high.onnx");
const has = (command: string, args: string[]) => {
  try {
    execFileSync(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const canRecord = Boolean(loadPlaywright(process.cwd())) && has("ffmpeg", ["-version"]);
const canSpeak = canRecord && existsSync(PIPER) && existsSync(VOICE);

const PAGE = `<!doctype html><title>Stock</title><h1>Low stock</h1><p id="msg">Two products are low.</p>
<label>Category <select><option>All</option><option>Books</option></select></label>
<label>Quantity <input id="qty"></label><button onclick="msg.textContent='Restocked'">Restock</button>`;

let server: Server;
let url = "";

beforeAll(async () => {
  server = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end(PAGE));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => server.close());

function repoWith(steps: object[]): string {
  const repo = featureRepo();
  mkdirSync(join(repo, ".aidt"));
  write(repo, {
    ".aidt/config.json": JSON.stringify({ demo: { piper: PIPER, subtitles: "file" } }),
    "restock.json": JSON.stringify({
      title: "Restock",
      app: { url },
      scenes: [{ title: "The admin restocks", steps }],
    }),
  });
  commitAll(repo, "demo script");
  return repo;
}

async function render(repo: string) {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const config = await loadConfig(repo);
  const code = await demoCommand({ root: repo, config, flags: {} }, ["render", "restock.json"]);
  const printed = out.mock.calls.map((c) => String(c[0])).join("");
  out.mockRestore();
  return { code, out: printed };
}

describe("aidt demo render", () => {
  it.skipIf(!canSpeak)("records the script with its voice, subtitles and PR text", async () => {
    const repo = repoWith([
      { go: "/" },
      { say: "Two products are low." },
      { select: { label: "Category", option: "Books" } },
      { fill: { label: "Quantity", value: "12" } },
      { click: "Restock" },
    ]);
    const { code, out } = await render(repo);
    expect(code).toBe(0);
    expect(out).toContain("no tokens");
    const streams = execFileSync("ffprobe", [
      ...["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0"],
      join(repo, ".aidt/demo/restock.mp4"),
    ]).toString();
    expect(streams).toContain("audio");
    expect(readFileSync(join(repo, ".aidt/demo/restock.vtt"), "utf8")).toContain(
      "Two products are low.",
    );
    expect(readFileSync(join(repo, ".aidt/demo/restock.md"), "utf8")).toContain(
      "### Demo · Restock",
    );
  });

  it.skipIf(!canRecord)("stops at the step that breaks and says which", async () => {
    const { code, out } = await render(repoWith([{ go: "/" }, { click: "Delete everything" }]));
    expect(code).toBe(1);
    expect(out).toContain(
      'Stopped at scene 1 «The admin restocks», step 2 (click "Delete everything")',
    );
  });

  it("explains a script it cannot read, before starting anything", async () => {
    const repo = featureRepo();
    write(repo, { "bad.json": JSON.stringify({ title: "x", app: { url: "nope" }, scenes: [] }) });
    const config = await loadConfig(repo);
    await expect(
      demoCommand({ root: repo, config, flags: {} }, ["render", "bad.json"]),
    ).rejects.toThrow("`app.url` must be an http(s) address");
  });
});
