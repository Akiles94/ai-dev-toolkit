import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  type BrowserContext,
  type Page,
  type Playwright,
  type Request,
  SCREENS,
} from "../shared/browser/playwright.ts";
import { type Field, field, locate, type Target } from "../shared/browser/steps.ts";
import {
  type ApiCall,
  type Call,
  describeStep,
  fillIn,
  type StepLog,
  type Walk,
  type WalkLog,
  type WalkStep,
} from "./qa-walk.ts";

/** One person's browser: a context of their own (cookies, storage, device) and its page. */
interface Actor {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Calls the page started that have not finished or failed yet. */
  readonly inflight: { count: number };
}

interface Bucket {
  calls: Call[];
  consoleErrors: string[];
  pageErrors: string[];
}

/** What a step's action may add to its log. */
type Outcome = Partial<Pick<StepLog, "answer" | "screenshot" | "text">>;

interface Env {
  readonly actor: Actor;
  readonly base: string;
  readonly kept: Map<string, string>;
  /** Where this step's screenshot and page text go, without the extension. */
  readonly shot: string;
}

const ACTION_TIMEOUT_MS = 8000;
/** A step is over when its page made no call for `QUIET_MS`, or after `SETTLE_MS` at most. */
const SETTLE_MS = 3000;
const QUIET_MS = 300;
const BODY_CHARS = 300;

/** The text of `value` with its `{names}` filled in, or an error that stops the step. */
function filled(value: string, kept: ReadonlyMap<string, string>): string {
  const result = fillIn(value, kept);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

/** A call's address as the log shows it: the path for the app itself, the whole URL otherwise. */
const shown = (url: string, base: string): string => {
  const parsed = new URL(url);
  const app = new URL(base);
  return parsed.origin === app.origin ? parsed.pathname + parsed.search : url;
};

/** Pages, and the calls a script makes; images, styles and fonts only when they fail. */
const worthLogging = (request: Request, status: number) =>
  ["document", "xhr", "fetch"].includes(request.resourceType()) || status >= 400;

function listen(actor: Actor, base: string, bucket: () => Bucket): void {
  const { page, inflight } = actor;
  page.on("request", () => {
    inflight.count++;
  });
  page.on("requestfinished", () => {
    inflight.count--;
  });
  page.on("response", (response) => {
    const request = response.request();
    if (!worthLogging(request, response.status())) return;
    const path = shown(response.url(), base);
    bucket().calls.push({ method: request.method(), path, status: response.status() });
  });
  page.on("requestfailed", (request) => {
    inflight.count--;
    const status = request.failure()?.errorText ?? "failed";
    bucket().calls.push({ method: request.method(), path: shown(request.url(), base), status });
  });
  page.on("console", (message) => {
    if (message.type() === "error") bucket().consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => bucket().pageErrors.push(error.message));
}

/**
 * Waits for what a step set off: the page loaded, then no call in flight for a moment, so every
 * answer is logged with the step that caused it. Playwright's own «networkidle» is reached once per
 * page load and would not wait for the calls a tap makes later.
 */
async function settle(actor: Actor): Promise<void> {
  await actor.page.waitForLoadState("load", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
  const until = Date.now() + SETTLE_MS;
  let quietSince = Date.now();
  while (Date.now() < until) {
    await sleep(50);
    if (actor.inflight.count > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET_MS) return;
  }
}

/** A screenshot and the page's text, both kept next to the log so the QA can read them again. */
async function look(env: Env): Promise<Outcome> {
  const screenshot = `${env.shot}.png`;
  await env.actor.page.screenshot({ path: screenshot });
  // What a person sees: hidden elements are left out, which textContent would not do.
  // biome-ignore lint/performance/useDomNodeTextContent: a Playwright locator, not a DOM node
  const text = (await env.actor.page.locator("body").innerText()).replace(/\n{3,}/g, "\n\n").trim();
  await writeFile(`${env.shot}.txt`, `${text}\n`);
  return { screenshot, text };
}

async function keep(env: Env, expressions: Record<string, string>): Promise<Outcome> {
  const values: string[] = [];
  for (const [name, expression] of Object.entries(expressions)) {
    const value = await env.actor.page.evaluate(expression);
    if (value === null || value === undefined) throw new Error(`\`${expression}\` gave nothing`);
    const text = typeof value === "string" ? value : JSON.stringify(value);
    env.kept.set(name, text);
    values.push(`${name} = ${JSON.stringify(text)}`);
  }
  return { answer: values.join(" · ") };
}

async function request(env: Env, call: ApiCall): Promise<Outcome> {
  const url = new URL(filled(call.path, env.kept), env.base).toString();
  const body =
    call.body === undefined
      ? undefined
      : typeof call.body === "string"
        ? filled(call.body, env.kept)
        : JSON.parse(filled(JSON.stringify(call.body), env.kept));
  const response = await env.actor.context.request.fetch(url, {
    method: call.method ?? "GET",
    data: body,
    failOnStatusCode: false,
  });
  const text = (await response.text()).replace(/\s+/g, " ").trim();
  const cut = text.length > BODY_CHARS ? `${text.slice(0, BODY_CHARS)}…` : text;
  return { answer: `${response.status()}${cut ? ` ${cut}` : ""}` };
}

async function click(env: Env, target: Target, times: number): Promise<Outcome> {
  const element = locate(env.actor.page, target);
  for (let i = 0; i < times; i++) await element.click();
  return {};
}

type Action = (env: Env, value: unknown, step: WalkStep) => Promise<Outcome>;

/** An action that only does something on the page, and adds nothing to the log. */
const just =
  (act: (env: Env, value: unknown, step: WalkStep) => Promise<unknown>): Action =>
  async (env, value, step) => {
    await act(env, value, step);
    return {};
  };

/** What each kind of step does; each returns what it adds to the log. */
const ACTIONS: Record<string, Action> = {
  go: just(({ actor, base, kept }, path) =>
    actor.page.goto(new URL(filled(path as string, kept), base).toString()),
  ),
  click: (env, target, step) => click(env, target as Target, step.times ?? 1),
  fill: just(({ actor, kept }, value) => {
    const fill = value as Field & { value: string };
    return field(actor.page, fill).fill(filled(fill.value, kept));
  }),
  select: just(({ actor }, value) => {
    const select = value as Field & { option: string };
    return field(actor.page, select).selectOption({ label: select.option });
  }),
  press: just(({ actor }, key) => actor.page.keyboard.press(key as string)),
  wait: just(({ actor }, ms) => actor.page.waitForTimeout(ms as number)),
  back: just(({ actor }) => actor.page.goBack()),
  reload: just(({ actor }) => actor.page.reload()),
  look: (env) => look(env),
  keep: (env, expressions) => keep(env, expressions as Record<string, string>),
  request: (env, call) => request(env, call as ApiCall),
  offline: just(({ actor }, offline) => actor.context.setOffline(offline as boolean)),
  clear: just(({ actor }, what) =>
    what === "cookies"
      ? actor.context.clearCookies()
      : actor.page.evaluate("localStorage.clear(); sessionStorage.clear()"),
  ),
};

const COLOURS = new RegExp(`${String.fromCharCode(27)}\\[\\d+m`, "g");

/**
 * Why a step could not be done, in one line. Playwright says only «Timeout exceeded» first; its call
 * log tells whether nothing matched, or what it found and why it could not use it (disabled, hidden,
 * covered).
 */
export function reason(message: string): string {
  const lines = message
    .replace(COLOURS, "")
    .split("\n")
    .map((line) => line.trim().replace(/^- /, ""))
    .filter((line) => line !== "");
  const first = lines[0] ?? "failed";
  if (!/Timeout \d+ms exceeded/.test(first)) return first;
  const found = lines.find((line) => line.startsWith("locator resolved to "));
  if (!found) return `${first} Nothing on the page matched it.`;
  const why = lines.findLast((line) => /^element is |intercepts pointer events/.test(line));
  return `${first} It found ${found.slice("locator resolved to ".length)}${why ? `, but the ${why}` : ""}.`;
}

/** Runs one step's action, and waits for what it set off. */
async function perform(env: Env, step: WalkStep): Promise<Outcome> {
  const [kind, value] = Object.entries(step).find(([key]) => key in ACTIONS) ?? [];
  const action = kind ? ACTIONS[kind] : undefined;
  if (!action) throw new Error("a step with no action");
  const outcome = await action(env, value, step);
  if (kind !== "look" && kind !== "keep") await settle(env.actor);
  return outcome;
}

/**
 * Plays a walk in a real browser, one context per person, and logs what the app answered to each
 * step. Stops at the first step that cannot be done, with a screenshot of what the screen showed
 * instead. The browser is closed whatever happens.
 */
export async function playWalk(
  playwright: Playwright,
  walk: Walk,
  outDir: string,
): Promise<WalkLog> {
  const browser = await playwright.chromium.launch();
  const actors = new Map<string, Actor>();
  let bucket: Bucket = { calls: [], consoleErrors: [], pageErrors: [] };
  const actorFor = async (name: string): Promise<Actor> => {
    const known = actors.get(name);
    if (known) return known;
    const device = walk.people[name]?.device ?? "desktop";
    const context = await browser.newContext({ ...SCREENS[device] });
    const page = await context.newPage();
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    const actor = { name, context, page, inflight: { count: 0 } };
    listen(actor, walk.app.url, () => bucket);
    actors.set(name, actor);
    return actor;
  };
  const steps: StepLog[] = [];
  const kept = new Map<string, string>();
  let person = Object.keys(walk.people)[0] ?? "person";
  try {
    for (const [i, step] of walk.steps.entries()) {
      person = step.as ?? person;
      const actor = await actorFor(person);
      bucket = { calls: [], consoleErrors: [], pageErrors: [] };
      const n = i + 1;
      const shot = join(outDir, `${String(n).padStart(2, "0")}-${person}`);
      const base = { n, person, step: describeStep(step) };
      try {
        const outcome = await perform({ actor, base: walk.app.url, kept, shot }, step);
        steps.push({ ...base, url: actor.page.url(), ...bucket, ...outcome });
      } catch (error) {
        const failure = reason((error as Error).message);
        const screenshot = `${shot}.png`;
        await actor.page.screenshot({ path: screenshot }).catch(() => undefined);
        steps.push({ ...base, url: actor.page.url(), ...bucket, screenshot, failure });
        return { title: walk.title, url: walk.app.url, steps, stopped: true };
      }
    }
    return { title: walk.title, url: walk.app.url, steps, stopped: false };
  } finally {
    await browser.close();
  }
}
