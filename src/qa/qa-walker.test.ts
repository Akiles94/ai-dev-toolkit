import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPlaywright, type Playwright } from "../shared/browser/playwright.ts";
import { parseWalk, type Walk } from "./qa-walk.ts";
import { playWalk, reason } from "./qa-walker.ts";

// A real browser, where Playwright is installed; skipped where it is not (CI).

/** A tiny shop for walks to run against: a page that adds to a cart, a disabled button, a link. */
const PAGE = `<!doctype html><title>Shop</title><h1>Shop</h1><p id="count">0 in cart</p>
<button onclick="add()">Add</button><button disabled>Pay</button><a href="/next">Next</a>
<script>
localStorage.setItem("cartId", "cart-42");
async function add() {
  try {
    const res = await fetch("/items", { method: "POST" });
    document.getElementById("count").textContent = (await res.json()).count + " in cart";
  } catch { document.getElementById("count").textContent = "Could not add"; }
}
</script>`;

/** Starts the shop on a free port; every start has an empty cart. */
async function startShop(): Promise<{ url: string; close: () => void }> {
  let items = 0;
  const server = createServer((req, res) => {
    if (req.url === "/items" && req.method === "POST") {
      items++;
      return res.writeHead(200, { "content-type": "application/json" }).end(`{"count":${items}}`);
    }
    if (req.url === "/items/cart-42" && req.method === "DELETE") {
      items = 0;
      return res.writeHead(204).end();
    }
    if (req.url === "/" || req.url === "/next")
      return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    res.writeHead(404).end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

const playwright = loadPlaywright(process.cwd());

let shop: Awaited<ReturnType<typeof startShop>>;

beforeAll(async () => {
  shop = await startShop();
});
afterAll(() => shop.close());

function walkOf(steps: object[]): Walk {
  const parsed = parseWalk({
    title: "Cart",
    app: { url: shop.url },
    people: { shopper: {}, intruder: { device: "phone" } },
    steps,
  });
  if (!parsed.ok) throw new Error(parsed.error.join("; "));
  return parsed.value;
}

describe("playWalk", () => {
  it.skipIf(!playwright)(
    "plays every kind of step as each person, logging each answer with the step that caused it",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "aidt-walk-"));
      const log = await playWalk(
        playwright as Playwright,
        walkOf([
          { go: "/" },
          { click: "Add", times: 2 },
          { keep: { cart: "localStorage.getItem('cartId')" } },
          { look: "the count after a double tap" },
          { as: "intruder", request: { method: "DELETE", path: "/items/{cart}" } },
          { as: "intruder", go: "/missing" },
          { offline: true },
          { click: "Add" },
          { offline: false },
          { click: "Next" },
          { back: true },
          { reload: true },
          { clear: "storage" },
          { keep: { left: "String(localStorage.length)" } },
        ]),
        out,
      );
      expect(log.stopped).toBe(false);
      const step = (n: number) => log.steps[n - 1];
      expect(step(1)?.calls).toEqual([{ method: "GET", path: "/", status: 200 }]);
      expect(step(2)?.calls).toEqual([
        { method: "POST", path: "/items", status: 200 },
        { method: "POST", path: "/items", status: 200 },
      ]);
      expect(step(3)?.answer).toBe('cart = "cart-42"');
      expect(step(4)?.text).toContain("2 in cart");
      expect(readFileSync(join(out, "04-shopper.txt"), "utf8")).toContain("2 in cart");
      expect(existsSync(join(out, "04-shopper.png"))).toBe(true);
      expect(step(5)).toMatchObject({ person: "intruder", answer: "204" });
      expect(step(6)).toMatchObject({ person: "intruder" });
      expect(step(7)).toMatchObject({ person: "shopper" });
      expect(step(6)?.calls).toEqual([{ method: "GET", path: "/missing", status: 404 }]);
      expect(step(6)?.consoleErrors[0]).toContain("404");
      expect(step(8)?.calls).toEqual([
        { method: "POST", path: "/items", status: "net::ERR_INTERNET_DISCONNECTED" },
      ]);
      expect(step(10)?.url).toBe(`${shop.url}/next`);
      expect(step(11)?.url).toBe(`${shop.url}/`);
      expect(step(14)?.answer).toBe('left = "0"');
    },
  );

  it.skipIf(!playwright)(
    "stops at a step it cannot do, with a screenshot and the reason",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "aidt-walk-"));
      const log = await playWalk(
        playwright as Playwright,
        walkOf([{ go: "/" }, { click: "Pay" }, { go: "/" }]),
        out,
      );
      expect(log.stopped).toBe(true);
      expect(log.steps).toHaveLength(2);
      expect(log.steps[1]?.failure).toContain(
        "It found <button disabled>Pay</button>, but the element is not enabled.",
      );
      expect(existsSync(join(out, "02-shopper.png"))).toBe(true);
    },
  );

  it.skipIf(!playwright)(
    "stops a step that needs a page, for a person who never opened one",
    async () => {
      const out = mkdtempSync(join(tmpdir(), "aidt-walk-"));
      const log = await playWalk(
        playwright as Playwright,
        walkOf([
          { go: "/" },
          { as: "intruder", request: { path: "/" } },
          { as: "intruder", reload: true },
        ]),
        out,
      );
      expect(log.steps[1]).toMatchObject({
        person: "intruder",
        answer: expect.stringMatching(/^200/),
      });
      expect(log.steps[2]?.failure).toBe(
        "intruder has no page open yet: their first step on a page is a go",
      );
    },
  );

  it.skipIf(!playwright)("never runs a step with a name nothing was kept as", async () => {
    const out = mkdtempSync(join(tmpdir(), "aidt-walk-"));
    const log = await playWalk(
      playwright as Playwright,
      walkOf([{ request: { method: "DELETE", path: "/items/{cart}" } }]),
      out,
    );
    expect(log.steps[0]?.failure).toBe("nothing was kept as {cart} before this step");
  });
});

describe("reason", () => {
  const ESC = String.fromCharCode(27);
  // As Playwright writes its call log: one dimmed line per entry, nested by indentation.
  const logged = (...lines: string[]) =>
    [
      "locator.click: Timeout 8000ms exceeded.",
      "Call log:",
      ...lines.map((line) => `${ESC}[2m${line}${ESC}[22m`),
    ].join("\n");

  it("says nothing matched when Playwright found nothing", () => {
    expect(reason(logged("  - waiting for locator('button')"))).toBe(
      "locator.click: Timeout 8000ms exceeded. Nothing on the page matched it.",
    );
  });

  it("says what it found and why it could not use it", () => {
    const message = logged(
      "  - waiting for locator('button')",
      "  - locator resolved to <button disabled>Pay</button>",
      "    - element is not visible",
      "    - element is not enabled",
    );
    expect(reason(message)).toBe(
      "locator.click: Timeout 8000ms exceeded. It found <button disabled>Pay</button>, but the element is not enabled.",
    );
  });

  it("keeps the first line of any other error", () => {
    expect(reason("nothing was kept as {cart} before this step")).toBe(
      "nothing was kept as {cart} before this step",
    );
  });
});
