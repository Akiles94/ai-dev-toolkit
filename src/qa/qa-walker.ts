import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Playwright } from "../shared/browser/playwright.ts";
import { type Field, field, locate, type Target } from "../shared/browser/steps.ts";
import { type Actor, type Bucket, openActor, settle, shown } from "./qa-actor.ts";
import {
  type ApiCall,
  type Call,
  describeStep,
  fillStep,
  type StepLog,
  type Walk,
  type WalkLog,
  type WalkStep,
} from "./qa-walk.ts";

/** What a step's action may add to its log. */
type Outcome = Partial<Pick<StepLog, "answer" | "screenshot" | "text">> & {
  readonly calls?: readonly Call[];
};

interface Env {
  readonly actor: Actor;
  readonly base: string;
  readonly kept: Map<string, string>;
  /** Where this step's screenshot and page text go, without the extension. */
  readonly shot: string;
  /** Whether an address is one the walk may reach (`qa.origins`). */
  readonly allowed: (address: string) => boolean;
}

const BODY_CHARS = 300;

/** An address of the walk, resolved against the app's, refused when the walk may not reach it. */
function reachable(env: Env, path: string): string {
  const url = new URL(path, env.base).toString();
  if (!env.allowed(url))
    throw new Error(
      `${url} is outside qa.origins: a walk reaches this machine, or what the config lists`,
    );
  return url;
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
    if (value === null || value === undefined || value === "")
      throw new Error(`\`${expression}\` gave nothing`);
    const text = typeof value === "string" ? value : JSON.stringify(value);
    env.kept.set(name, text);
    values.push(`${name} = ${JSON.stringify(text)}`);
  }
  return { answer: values.join(" · ") };
}

/** A call with the person's cookies; offline, it fails as the page's calls do, without being sent. */
async function request(env: Env, call: ApiCall): Promise<Outcome> {
  const url = reachable(env, call.path);
  const method = call.method ?? "GET";
  const path = shown(url, env.base);
  if (env.actor.offline)
    return { calls: [{ method, path, status: "net::ERR_INTERNET_DISCONNECTED" }] };
  const response = await env.actor.context.request.fetch(url, {
    method,
    data: call.body,
    failOnStatusCode: false,
  });
  const text = (await response.text()).replace(/\s+/g, " ").trim();
  const answer = text.length > BODY_CHARS ? `${text.slice(0, BODY_CHARS)}…` : text;
  return { calls: [{ method, path, status: response.status() }], ...(answer ? { answer } : {}) };
}

/** `times` clicks in quick succession, as a person's double tap: none waits for the button again. */
async function click(env: Env, target: Target, times: number): Promise<Outcome> {
  await locate(env.actor.page, target).click({ clickCount: times });
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
  go: just((env, path) => env.actor.page.goto(reachable(env, path as string))),
  click: (env, target, step) => click(env, target as Target, step.times ?? 1),
  fill: just(({ actor }, value) => {
    const fill = value as Field & { value: string };
    return field(actor.page, fill).fill(fill.value);
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
  offline: just(({ actor }, offline) => {
    actor.offline = offline as boolean;
    return actor.context.setOffline(actor.offline);
  }),
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

/** Steps that need no page: the rest, on a person who never went anywhere, would act on nothing. */
const WITHOUT_PAGE = new Set(["go", "request", "offline", "wait"]);

/** Runs one step's action, and waits for what it set off. */
async function perform(env: Env, written: WalkStep): Promise<Outcome> {
  const filled = fillStep(written, env.kept);
  if (!filled.ok) throw new Error(filled.error);
  const step = filled.value;
  const [kind, value] = Object.entries(step).find(([key]) => Object.hasOwn(ACTIONS, key)) ?? [];
  const action = kind ? ACTIONS[kind] : undefined;
  if (!action) throw new Error("a step with no action");
  if (!WITHOUT_PAGE.has(kind as string) && env.actor.page.url() === "about:blank")
    throw new Error(`${env.actor.name} has no page open yet: their first step on a page is a go`);
  const outcome = await action(env, value, step);
  if (kind !== "look" && kind !== "keep") await settle(env.actor);
  return outcome;
}

/**
 * Plays a walk in a real browser, one context per person, and logs what the app answered to each
 * step. Every person's browser reaches only what `allowed` accepts. Stops at the first step that
 * cannot be done, with a screenshot of what the screen showed instead. The browser is closed
 * whatever happens.
 */
export async function playWalk(
  playwright: Playwright,
  walk: Walk,
  outDir: string,
  allowed: (address: string) => boolean,
): Promise<WalkLog> {
  const browser = await playwright.chromium.launch();
  const actors = new Map<string, Actor>();
  let bucket: Bucket = { calls: [], consoleErrors: [], pageErrors: [] };
  const first = Object.keys(walk.people)[0] ?? "person";
  let person = first;
  const reporting = { base: walk.app.url, bucket: () => bucket, acting: () => person };
  const actorFor = async (name: string): Promise<Actor> => {
    const actor =
      actors.get(name) ??
      (await openActor(browser, name, walk.people[name]?.device ?? "desktop", allowed, reporting));
    actors.set(name, actor);
    return actor;
  };
  const steps: StepLog[] = [];
  const kept = new Map<string, string>();
  try {
    for (const [i, step] of walk.steps.entries()) {
      person = step.as ?? first;
      const actor = await actorFor(person);
      bucket = { calls: [], consoleErrors: [], pageErrors: [] };
      const n = i + 1;
      const shot = join(outDir, `${String(n).padStart(2, "0")}-${person}`);
      const base = { n, person, step: describeStep(step) };
      const env = { actor, base: walk.app.url, kept, shot, allowed };
      try {
        const { calls = [], ...outcome } = await perform(env, step);
        steps.push({
          ...base,
          url: actor.page.url(),
          ...bucket,
          calls: [...bucket.calls, ...calls],
          ...outcome,
        });
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
