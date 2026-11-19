import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

// The few Playwright calls the toolkit makes, so it needs no dependency on Playwright: the project
// or the machine has it, and `loadPlaywright` finds it.

export interface Locator {
  nth(i: number): Locator;
  first(): Locator;
  count(): Promise<number>;
  filter(o: { hasText: string }): Locator;
  boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  scrollIntoViewIfNeeded(): Promise<void>;
  click(o?: { delay?: number; clickCount?: number }): Promise<void>;
  pressSequentially(text: string, o: { delay: number }): Promise<void>;
  fill(text: string): Promise<void>;
  selectOption(option: { label: string }): Promise<unknown>;
  innerText(): Promise<string>;
}

export interface Request {
  method(): string;
  url(): string;
  resourceType(): string;
  failure(): { errorText: string } | null;
}

interface Response {
  status(): number;
  url(): string;
  request(): Request;
}

interface ConsoleMessage {
  type(): string;
  text(): string;
}

export interface Page {
  goto(url: string): Promise<Response | null>;
  goBack(): Promise<Response | null>;
  reload(): Promise<Response | null>;
  url(): string;
  waitForTimeout(ms: number): Promise<void>;
  waitForLoadState(state: "load" | "networkidle", o?: { timeout: number }): Promise<void>;
  locator(selector: string): Locator;
  getByText(text: string): Locator;
  getByLabel(text: string): Locator;
  keyboard: { press(key: string): Promise<void> };
  /** Runs `expression` inside the page: written as text, since the toolkit is not built for the DOM. */
  evaluate(expression: string): Promise<unknown>;
  screenshot(o: { path: string }): Promise<unknown>;
  on(event: "pageerror", fn: (e: Error) => void): void;
  on(event: "console", fn: (m: ConsoleMessage) => void): void;
  on(event: "response", fn: (r: Response) => void): void;
  on(event: "request" | "requestfinished" | "requestfailed", fn: (r: Request) => void): void;
  video(): { path(): Promise<string> } | null;
  setDefaultTimeout(ms: number): void;
}

interface ApiResponse {
  status(): number;
  text(): Promise<string>;
}

/** A call held on its way out, to let it go or stop it. */
interface Route {
  request(): Request;
  continue(): Promise<void>;
  abort(errorCode: string): Promise<void>;
}

export interface BrowserContext {
  newPage(): Promise<Page>;
  route(url: string, handler: (route: Route) => unknown): Promise<void>;
  routeWebSocket(
    url: (url: URL) => boolean,
    handler: (socket: { close(o: { code: number; reason: string }): unknown }) => unknown,
  ): Promise<void>;
  addInitScript(s: string): Promise<void>;
  setOffline(offline: boolean): Promise<void>;
  clearCookies(): Promise<void>;
  /** Calls made with this context's cookies, as the person whose context it is. */
  request: {
    fetch(
      url: string,
      o: { method: string; data?: unknown; failOnStatusCode: false },
    ): Promise<ApiResponse>;
  };
  close(): Promise<void>;
}

export interface Browser {
  newContext(o: object): Promise<BrowserContext>;
  close(): Promise<void>;
}

export interface Playwright {
  chromium: { launch(o?: object): Promise<Browser> };
}

/** Playwright from the project, or installed globally; the toolkit does not ship it. */
export function loadPlaywright(root: string): Playwright | undefined {
  const from = (folder: string): Playwright | undefined => {
    try {
      return createRequire(join(folder, "package.json"))("playwright") as Playwright;
    } catch {
      return undefined;
    }
  };
  return from(root) ?? from(globalModules());
}

/** npm's global folder (`npm root -g`), where a global `playwright` is; empty when npm is not there. */
function globalModules(): string {
  try {
    const shell = process.platform === "win32";
    return execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell }).trim();
  } catch {
    return "";
  }
}

/** What installs Playwright and its browser, for a command that needs it. */
export const INSTALL_PLAYWRIGHT = "npm install -D playwright && npx playwright install chromium";

/** The screens a page is opened on: a desktop, or a phone at twice the pixels. */
export const SCREENS = {
  desktop: { viewport: { width: 1280, height: 720 } },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
} as const;

export type Device = keyof typeof SCREENS;
