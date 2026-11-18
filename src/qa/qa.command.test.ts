import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPlaywright } from "../shared/browser/playwright.ts";
import { loadConfig } from "../shared/config/config.ts";
import { commitAll, featureRepo, write } from "../shared/testing/temp-repo.ts";
import { formatWalk, qaCommand } from "./qa.command.ts";
import type { WalkLog } from "./qa-walk.ts";

// A real walk needs a browser. Where Playwright is missing (CI) those tests are skipped; the format
// of a walk is covered by qa-walk.test.ts, and what is printed by the tests below that need none.
// What each kind of step does in the browser is covered by qa-walker.test.ts.
const canWalk = Boolean(loadPlaywright(process.cwd()));

// A page with one button that cannot be used: enough for what the command does around a walk.
const server = createServer((_, res) =>
  res
    .writeHead(200, { "content-type": "text/html" })
    .end("<h1>Shop</h1><button disabled>Pay</button>"),
);
let url = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(() => server.close());

function repoWith(steps: object[], app = url): string {
  const repo = featureRepo();
  mkdirSync(join(repo, ".aidt", "walks"), { recursive: true });
  write(repo, {
    ".aidt/walks/cart.json": JSON.stringify({
      title: "Cart",
      app: { url: app },
      people: { shopper: {}, intruder: { device: "phone" } },
      steps,
    }),
  });
  commitAll(repo, "walk");
  return repo;
}

async function walk(repo: string, file = ".aidt/walks/cart.json") {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  try {
    const config = await loadConfig(repo);
    const code = await qaCommand({ root: repo, config, flags: {} }, ["walk", file]);
    return { code, out: out.mock.calls.map((c) => String(c[0])).join("") };
  } finally {
    out.mockRestore();
  }
}

describe("aidt qa walk", () => {
  it.skipIf(!canWalk)("stops at a step it cannot do, saying why, with a screenshot", async () => {
    const repo = repoWith([{ go: "/" }, { click: "Pay" }, { go: "/" }]);
    write(repo, { "app.ts": "export const a = 2;\n" });
    const { code, out } = await walk(repo);
    expect(code).toBe(1);
    expect(out).toContain("with uncommitted changes");
    expect(out).toContain(
      "It found <button disabled>Pay</button>, but the element is not enabled.",
    );
    expect(out).toContain('Stopped at step 2 (click "Pay")');
    expect(existsSync(join(repo, ".aidt/qa/cart/02-shopper.png"))).toBe(true);
  });

  it.skipIf(!canWalk)(
    "starts nothing: an app that does not answer is the user's to start",
    async () => {
      const { code, out } = await walk(repoWith([{ go: "/" }], "http://127.0.0.1:9"));
      expect(code).toBe(2);
      expect(out).toContain(
        "Nothing answers at http://127.0.0.1:9. Start the app as .aidt/app.md says, then walk again.",
      );
    },
  );

  it("explains a walk it cannot read, before opening anything", async () => {
    const repo = featureRepo();
    write(repo, { "bad.json": JSON.stringify({ title: "x", app: { url: "nope" }, steps: [] }) });
    await expect(walk(repo, "bad.json")).rejects.toThrow("`app.url` must be an http(s) address");
    await expect(walk(repo, "none.json")).rejects.toThrow("No QA walk at none.json.");
    const config = await loadConfig(repo);
    await expect(qaCommand({ root: repo, config, flags: {} }, ["walk"])).rejects.toThrow(
      "Name the walk",
    );
    await expect(qaCommand({ root: repo, config, flags: {} }, ["run"])).rejects.toThrow(
      'Unknown qa action "run"',
    );
  });
});

describe("what a walk prints", () => {
  const log: WalkLog = {
    title: "Cart",
    url: "http://localhost:3000",
    stopped: true,
    steps: [
      {
        n: 1,
        person: "shopper",
        step: "go /",
        url: "http://localhost:3000/",
        calls: [
          { method: "GET", path: "/", status: 200 },
          { method: "GET", path: "/logo.png", status: 404 },
        ],
        consoleErrors: ["Failed to load resource"],
        pageErrors: [],
      },
      {
        n: 2,
        person: "shopper",
        step: "look «the cart»",
        url: "http://localhost:3000/",
        calls: [],
        consoleErrors: [],
        pageErrors: ["x is not defined"],
        screenshot: "/repo/.aidt/qa/cart/02-shopper.png",
        text: Array.from({ length: 32 }, (_, i) => `line ${i + 1}`).join("\n"),
      },
      {
        n: 3,
        person: "intruder",
        step: 'click "Pay"',
        url: "http://localhost:3000/",
        calls: [],
        consoleErrors: [],
        pageErrors: [],
        failure: "Timeout 8000ms exceeded. Nothing on the page matched it.",
        screenshot: "/repo/.aidt/qa/cart/03-intruder.png",
      },
    ],
  };

  it("shows each step with its answer, where it stopped, and a count of what went wrong", () => {
    const text = formatWalk("/repo", log, "a1b2c3d", "/repo/.aidt/qa/cart/walk.json");
    expect(text).toContain("Walk «Cart» · http://localhost:3000 · at a1b2c3d");
    expect(text).toContain(" 1 shopper    go /\n      GET / 200 · GET /logo.png 404");
    expect(text).toContain("console error: Failed to load resource");
    expect(text).toContain("page error: x is not defined");
    expect(text).toContain("│ line 30\n      │ … 2 more line(s) in .aidt/qa/cart/02-shopper.txt");
    expect(text).toContain('Stopped at step 3 (click "Pay")');
    expect(text).toContain(
      "Calls that failed or answered 4xx/5xx: 1 (step 1) · console errors: 1 (step 1) · page errors: 1 (step 2)",
    );
    expect(text.endsWith("Log: .aidt/qa/cart/walk.json")).toBe(true);
  });
});
