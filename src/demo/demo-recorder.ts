import { spawn } from "node:child_process";
import { type Locator, type Page, type Playwright, SCREENS } from "../shared/browser/playwright.ts";
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

/** A circle where the demo taps, so whoever watches sees what was pressed. */
const TAP_STYLE = `addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');
s.textContent='.aidt-tap{position:fixed;z-index:2147483647;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;background:rgba(220,38,38,.3);border:3px solid #dc2626;pointer-events:none;animation:aidt-tap .8s ease-out forwards}@keyframes aidt-tap{from{transform:scale(.4);opacity:1}to{transform:scale(1.5);opacity:0}}';
document.head.appendChild(s);});`;

/** The screens of `SCREENS`, each recorded at its full size in pixels. */
const DEVICES = {
  desktop: { ...SCREENS.desktop, recordVideo: { size: { width: 1280, height: 720 } } },
  phone: { ...SCREENS.phone, recordVideo: { size: { width: 780, height: 1688 } } },
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

/** Plays every step on the page, timing each line from `startedAt`; says where it stopped, if it did. */
async function perform(
  page: Page,
  script: DemoScript,
  speeches: readonly Speech[],
  startedAt: number,
) {
  const cues: Cue[] = [];
  for (const [s, scene] of script.scenes.entries()) {
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
        const failure = `scene ${s + 1} «${scene.title}», step ${i + 1} (${describeStep(step)}): ${reason}`;
        return { cues, failure };
      }
    }
  }
  return { cues, failure: undefined };
}

/**
 * Records the script in a real browser: every step on screen, every line at its moment. Stops at
 * the first step that fails, saying which, so only that part of the script needs fixing. The
 * browser is closed whatever happens.
 */
export async function record(
  playwright: Playwright,
  script: DemoScript,
  speeches: readonly Speech[],
  workDir: string,
): Promise<Result<Recording, string>> {
  const browser = await playwright.chromium.launch();
  try {
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
    const { cues, failure } = await perform(page, script, speeches, startedAt);
    await page.waitForTimeout(600);
    const lengthMs = Date.now() - startedAt;
    const video = page.video();
    await context.close();
    if (failure) return fail(failure);
    return ok({ video: video ? await video.path() : "", cues, lengthMs, pageErrors });
  } finally {
    await browser.close();
  }
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
