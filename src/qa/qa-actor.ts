import { setTimeout as sleep } from "node:timers/promises";
import {
  type Browser,
  type BrowserContext,
  type Device,
  type Page,
  type Request,
  SCREENS,
} from "../shared/browser/playwright.ts";
import type { Call } from "./qa-walk.ts";

/** One person's browser: a context of their own (cookies, storage, device) and its page. */
export interface Actor {
  readonly name: string;
  readonly context: BrowserContext;
  readonly page: Page;
  /** Calls the page started that have not finished or failed yet. */
  readonly inflight: { count: number };
  /** Whether the person's network is down (`offline`): their `request` steps fail too. */
  offline: boolean;
}

/** What every page did during the step being played. */
export interface Bucket {
  calls: Call[];
  consoleErrors: string[];
  pageErrors: string[];
}

const ACTION_TIMEOUT_MS = 8000;
/** A step is over when its page made no call for `QUIET_MS`, or after `SETTLE_MS` at most. */
const SETTLE_MS = 3000;
const QUIET_MS = 500;

/** A call's address as the log shows it: the path for the app itself, the whole URL otherwise. */
export const shown = (url: string, base: string): string => {
  const parsed = new URL(url);
  return parsed.origin === new URL(base).origin ? parsed.pathname + parsed.search : url;
};

/** Pages, and the calls a script makes; images, styles and fonts only when they fail. */
const worthLogging = (request: Request, status: number) =>
  ["document", "xhr", "fetch"].includes(request.resourceType()) || status >= 400;

/** Where a person's page reports: the step being played, and who is playing it. */
interface Reporting {
  readonly base: string;
  readonly bucket: () => Bucket;
  readonly acting: () => string;
  /** What the walk may reach: a call elsewhere was stopped by the proxy, which logs it once. */
  readonly allowed: (address: string) => boolean;
  /** The walk's proxy, which the person's `request` steps go through as their page does. */
  readonly proxy: string;
}

function listen(actor: Actor, { base, bucket, acting, allowed }: Reporting): void {
  const { page, inflight } = actor;
  // Another person's page may still be working (a timer, a poll): its calls name who made them.
  const call = (request: Request, status: number | string) =>
    bucket().calls.push({
      method: request.method(),
      path: shown(request.url(), base),
      status,
      ...(actor.name === acting() ? {} : { person: actor.name }),
    });
  page.on("request", () => {
    inflight.count++;
  });
  page.on("requestfinished", () => {
    inflight.count--;
  });
  page.on("response", (response) => {
    const request = response.request();
    if (allowed(request.url()) && worthLogging(request, response.status()))
      call(request, response.status());
  });
  page.on("requestfailed", (request) => {
    inflight.count--;
    if (allowed(request.url())) call(request, request.failure()?.errorText ?? "failed");
  });
  page.on("console", (message) => {
    if (message.type() === "error") bucket().consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => bucket().pageErrors.push(error.message));
}

/** A new browser context for a person, with its page; the browser goes through the walk's proxy. */
export async function openActor(
  browser: Browser,
  name: string,
  device: Device,
  reporting: Reporting,
): Promise<Actor> {
  const proxy = { server: reporting.proxy, bypass: "<-loopback>" };
  const context = await browser.newContext({ ...SCREENS[device], proxy });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  const actor: Actor = { name, context, page, inflight: { count: 0 }, offline: false };
  listen(actor, reporting);
  return actor;
}

/**
 * Waits for what a step set off: the page loaded, then no call in flight for a moment, so every
 * answer is logged with the step that caused it. Playwright's own «networkidle» is reached once per
 * page load and would not wait for the calls a tap makes later. A call a page makes later still (a
 * timer, a search that waits for typing to stop) is logged with the step being played then.
 */
export async function settle(actor: Actor): Promise<void> {
  await actor.page.waitForLoadState("load", { timeout: ACTION_TIMEOUT_MS }).catch(() => undefined);
  const until = Date.now() + SETTLE_MS;
  let quietSince = Date.now();
  while (Date.now() < until) {
    await sleep(50);
    if (actor.inflight.count > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET_MS) return;
  }
}
