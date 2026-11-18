import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fail, ok, type Result } from "../shared/result/result.ts";
import type { Cue } from "./demo-media.ts";
import type { DemoScript, Step, Target } from "./demo-script.ts";

/** A line already turned into speech, waiting for its moment in the recording. */
export interface Speech {
  readonly text: string;
  readonly audio: string;
  readonly durationMs: number;
}

/** What the recording left: the silent browser video, and when each line is said. */
export interface Recording {
  readonly video: string;
  readonly cues: readonly Cue[];
  readonly lengthMs: number;
  /** Errors the page threw while it was recorded: worth a look before sharing the video. */
  readonly pageErrors: readonly string[];
}

// The few Playwright calls used here, so the toolkit needs no dependency on it.
interface Locator {
  nth(i: number): Locator;
  first(): Locator;
  count(): Promise<number>;
  filter(o: { hasText: string }): Locator;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  scrollIntoViewIfNeeded(): Promise<void>;
  click(): Promise<void>;
  pressSequentially(text: string, o: { delay: number }): Promise<void>;
  fill(text: string): Promise<void>;
  selectOption(option: { label: string }): Promise<unknown>;
}
interface Page {
  goto(url: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state: "load"): Promise<void>;
  locator(selector: string): Locator;
  getByText(text: string): Locator;
  getByLabel(text: string): Locator;
  keyboard: { press(key: string): Promise<void> };
  /** Runs `expression` inside the page: written as text, since the toolkit is not built for the DOM. */
  evaluate(expression: string): Promise<unknown>;
  on(event: "pageerror", fn: (e: Error) => void): void;
  video(): { path(): Promise<string> } | null;
  setDefaultTimeout(ms: number): void;
}
interface Browser {
  newContext(o: object): Promise<{
    newPage(): Promise<Page>;
    addInitScript(s: string): Promise<void>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
}
interface Playwright {
  chromium: { launch(o?: object): Promise<Browser> };
}

/** Playwright from the project, or installed globally; the toolkit does not ship it. */
export function loadPlaywright(root: string): Playwright | undefined {
  try {
    return createRequire(join(root, "package.json"))("playwright") as Playwright;
  } catch {
    return undefined;
  }
}

/** A circle where the demo taps, so whoever watches sees what was pressed. */
const TAP_STYLE = `addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');
s.textContent='.aidt-tap{position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(220,38,38,.3);border:3px solid #dc2626;pointer-events:none;animation:aidt-tap .8s ease-out forwards}@keyframes aidt-tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}';
document.head.appendChild(s);});`;

const DEVICES = {
  desktop: {
    viewport: { width: 1280, height: 720 },
    recordVideo: { size: { width: 1280, height: 720 } },
  },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    recordVideo: { size: { width: 780, height: 1688 } },
  },
};

function locate(page: Page, target: Target): Locator {
  if (typeof target === "string") {
    return page
      .locator("a, button, [role=button], label, summary, input[type=submit]")
      .filter({ hasText: target });
  }
  if (target.selector) return page.locator(target.selector).nth(target.nth ?? 0);
  return page.getByText(target.text ?? "").nth(target.nth ?? 0);
}

async function tap(page: Page, locator: Locator): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  const [x, y] = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
  await page.evaluate(`(() => { const dot = document.createElement("div"); dot.className = "aidt-tap";
    dot.style.left = "${x}px"; dot.style.top = "${y}px"; document.body.appendChild(dot);
    setTimeout(() => dot.remove(), 900); })()`);
  await page.waitForTimeout(350);
}

/** A form field by its label, or by a selector when no label tells it apart. */
const field = (page: Page, where: { label?: string; selector?: string }): Locator =>
  where.label ? page.getByLabel(where.label).first() : page.locator(where.selector ?? "").first();

/** The steps that change a page: tapping, typing and choosing, each shown with a circle. */
async function act(page: Page, step: Step): Promise<void> {
  if ("click" in step) {
    const target =
      typeof step.click === "string" ? locate(page, step.click).first() : locate(page, step.click);
    await tap(page, target);
    await target.click();
    await page.waitForLoadState("load");
    await page.waitForTimeout(400);
  } else if ("fill" in step) {
    const input = field(page, step.fill);
    await tap(page, input);
    await input.fill("");
    await input.pressSequentially(step.fill.value, { delay: 60 });
  } else if ("select" in step) {
    const dropdown = field(page, step.select);
    await tap(page, dropdown);
    await dropdown.selectOption({ label: step.select.option });
    await page.waitForTimeout(500);
  }
}

/** Runs one step on the page; a `say` waits while its line is spoken. */
async function run(
  page: Page,
  step: Step,
  base: string,
  speak: () => Promise<void>,
): Promise<void> {
  if ("go" in step) await page.goto(new URL(step.go, base).toString());
  else if ("say" in step) await speak();
  else if ("wait" in step) await page.waitForTimeout(step.wait);
  else if ("press" in step) await page.keyboard.press(step.press);
  else if ("scroll" in step) {
    const box = await page.getByText(step.scroll).first().boundingBox();
    if (!box) throw new Error(`no visible text «${step.scroll}»`);
    await page.evaluate(`window.scrollBy({ top: ${Math.round(box.y - 160)}, behavior: "smooth" })`);
    await page.waitForTimeout(1000);
  } else await act(page, step);
}

/** One step in words, for the message that says where a render stopped. */
const describeStep = (step: Step): string => {
  const [kind, value] = Object.entries(step)[0] ?? ["?", ""];
  return `${kind} ${JSON.stringify(value)}`;
};

/**
 * Records the script in a real browser: every step on screen, every line at its moment. Stops at
 * the first step that fails, saying which, so only that part of the script needs fixing.
 */
export async function record(
  playwright: Playwright,
  script: DemoScript,
  speeches: readonly Speech[],
  workDir: string,
): Promise<Result<Recording, string>> {
  const browser = await playwright.chromium.launch();
  const device = DEVICES[script.device];
  const context = await browser.newContext({
    ...device,
    recordVideo: { ...device.recordVideo, dir: workDir },
  });
  await context.addInitScript(TAP_STYLE);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const startedAt = Date.now();
  const cues: Cue[] = [];
  let failure: string | undefined;
  scenes: for (const [s, scene] of script.scenes.entries()) {
    for (const [i, step] of scene.steps.entries()) {
      const speak = async () => {
        const speech = speeches[cues.length] as Speech;
        const start = Date.now() - startedAt;
        cues.push({
          text: speech.text,
          audio: speech.audio,
          start,
          end: start + speech.durationMs,
        });
        await page.waitForTimeout(speech.durationMs + 200);
      };
      try {
        await run(page, step, script.app.url, speak);
      } catch (error) {
        const reason = (error as Error).message.split("\n")[0];
        failure = `scene ${s + 1} «${scene.title}», step ${i + 1} (${describeStep(step)}): ${reason}`;
        break scenes;
      }
    }
  }
  await page.waitForTimeout(600);
  const lengthMs = Date.now() - startedAt;
  const video = page.video();
  await context.close();
  await browser.close();
  if (failure) return fail(failure);
  return ok({ video: video ? await video.path() : "", cues, lengthMs, pageErrors });
}

/** Runs a command with `input` on its standard input; rejects with its error output. */
export function runWithInput(
  command: string,
  args: readonly string[],
  input: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited ${code}`)),
    );
    child.stdin.end(input);
  });
}
