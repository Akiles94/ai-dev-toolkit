import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadPlaywright, type Playwright } from "../shared/browser/playwright.ts";
import { originPolicy } from "./qa-origins.ts";
import { parseWalk, type Walk } from "./qa-walk.ts";
import { playWalk, reason } from "./qa-walker.ts";

// A real browser, where Playwright is installed; skipped where it is not (CI).

/** A tiny shop for walks to run against: a page that adds to a cart, a disabled button, a link. */
const PAGE = `<!doctype html><title>Shop</title><h1>Shop</h1><p id="count">0 in cart</p>
<button onclick="add()">Add</button><button disabled>Pay</button><a href="/next">Next</a>
<button onclick="this.disabled = true; fetch('/orders', { method: 'POST' })">Order</button>
<script>
localStorage.setItem("cartId", "cart-42");
async function add() {
  try {
    const res = await fetch("/items", { method: "POST" });
    document.getElementById("count").textContent = (await res.json()).count + " in cart";
  } catch { document.getElementById("count").textContent = "Could not add"; }
}
</script>`;

/** Where the shop's redirect sends a walk. */
let awayTo = "";
/** Event streams a page holds open on the shop. */
let liveEvents = 0;
/** Orders the shop received. */
let orders = 0;

/** Starts the shop on a free port; every start has an empty cart. */
async function startShop(): Promise<{ url: string; close: () => void; hits: () => number }> {
  let items = 0;
  let hits = 0;
  const html = { "content-type": "text/html" };
  const poll = "<p>Polling</p><script>setInterval(() => fetch('/tick'), 150)</script>";
  // What the shop answers, by method and path: [status, headers, body].
  const routes: Record<string, () => [number, Record<string, string>, string]> = {
    "GET /": () => [200, html, PAGE],
    "GET /next": () => [200, html, PAGE],
    "GET /poll": () => [200, html, poll],
    "GET /tick": () => [200, {}, "tick"],
    "POST /orders": () => {
      orders++;
      return [201, {}, ""];
    },
    "GET /live": () => [200, html, "<p>Live</p><script>new EventSource('/events')</script>"],
    "POST /created": () => [201, { location: "/orders/42" }, '{"id":42}'],
    // An open redirect, to wherever the test points it: a walk must not follow it out.
    "GET /away": () => [302, { location: awayTo }, ""],
    "POST /away": () => [307, { location: awayTo }, ""],
    "POST /items": () => [200, { "content-type": "application/json" }, `{"count":${++items}}`],
    "DELETE /items/cart-42": () => {
      items = 0;
      return [204, {}, ""];
    },
  };
  const server = createServer((req, res) => {
    hits++;
    // A stream the page keeps open: a walk that ends must close it, as a person leaving would.
    if (req.url === "/events") {
      liveEvents++;
      req.on("close", () => liveEvents--);
      return res.writeHead(200, { "content-type": "text/event-stream" }).write("data: hi\n\n");
    }
    const route = routes[`${req.method} ${req.url}`];
    const [status, headers, body] = route ? route() : [404, {}, "not found"];
    res.writeHead(status, headers).end(body);
  });
  server.on("upgrade", (_, socket) => {
    hits++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close(), hits: () => hits };
}

const playwright = loadPlaywright(process.cwd());

let shop: Awaited<ReturnType<typeof startShop>>;
/** Another server on this machine, standing for a host the walk must not reach. */
let outside: Awaited<ReturnType<typeof startShop>>;

beforeAll(async () => {
  shop = await startShop();
  outside = await startShop();
});
afterAll(() => {
  shop.close();
  outside.close();
});

/** This machine, the default of `qa.origins`. */
const local = originPolicy(["local"]);
const folder = () => mkdtempSync(join(tmpdir(), "aidt-walk-"));

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
        local,
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
      expect(step(5)?.person).toBe("intruder");
      expect(step(5)?.calls).toEqual([{ method: "DELETE", path: "/items/cart-42", status: 204 }]);
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
        local,
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
        local,
      );
      expect(log.steps[1]).toMatchObject({
        person: "intruder",
        calls: [{ method: "GET", path: "/", status: 200 }],
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
      local,
    );
    expect(log.steps[0]?.failure).toBe("nothing was kept as {cart} before this step");
  });
});

describe("playWalk, as a person would do it", () => {
  it.skipIf(!playwright)(
    "a double tap is two quick clicks: a button that disables itself takes one",
    async () => {
      const before = orders;
      const log = await playWalk(
        playwright as Playwright,
        walkOf([{ go: "/" }, { click: "Order", times: 2 }]),
        folder(),
        local,
      );
      expect(orders - before).toBe(1);
      expect(log.steps[1]?.calls).toEqual([{ method: "POST", path: "/orders", status: 201 }]);
    },
  );

  it.skipIf(!playwright)(
    "fills {names} in any text of a step, and never keeps an empty value",
    async () => {
      const log = await playWalk(
        playwright as Playwright,
        walkOf([
          { go: "/" },
          { keep: { label: "document.querySelector('button').textContent" } },
          { click: "{label}" },
          { keep: { empty: "''" } },
        ]),
        folder(),
        local,
      );
      expect(log.steps[2]?.calls).toEqual([{ method: "POST", path: "/items", status: 200 }]);
      expect(log.steps[3]?.failure).toBe("`''` gave nothing");
    },
  );

  it.skipIf(!playwright)(
    "offline, a person's own calls fail too, and never reach the app",
    async () => {
      const before = shop.hits();
      const log = await playWalk(
        playwright as Playwright,
        walkOf([{ offline: true }, { request: { method: "POST", path: "/orders" } }]),
        folder(),
        local,
      );
      expect(log.steps[1]?.calls).toEqual([
        { method: "POST", path: "/orders", status: "net::ERR_INTERNET_DISCONNECTED" },
      ]);
      expect(shop.hits()).toBe(before);
    },
  );

  it.skipIf(!playwright)(
    "names the person whose page made a call during someone else's step",
    async () => {
      const log = await playWalk(
        playwright as Playwright,
        walkOf([{ go: "/poll" }, { as: "intruder", go: "/" }, { as: "intruder", wait: 600 }]),
        folder(),
        local,
      );
      expect(log.steps[2]?.calls).toContainEqual({
        method: "GET",
        path: "/tick",
        status: 200,
        person: "shopper",
      });
    },
  );
});

describe("playWalk ends cleanly", () => {
  it.skipIf(!playwright)(
    "closes what a page kept open, so the app sees it end and nothing waits",
    async () => {
      await playWalk(
        playwright as Playwright,
        walkOf([{ go: "/live" }, { wait: 300 }]),
        folder(),
        local,
      );
      const until = Date.now() + 2000;
      while (liveEvents > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
      expect(liveEvents).toBe(0);
    },
  );

  it.skipIf(!playwright)("shows a request's body when its location is not a redirect", async () => {
    const log = await playWalk(
      playwright as Playwright,
      walkOf([{ request: { method: "POST", path: "/created" } }]),
      folder(),
      local,
    );
    expect(log.steps[0]).toMatchObject({
      calls: [{ method: "POST", path: "/created", status: 201 }],
      answer: '{"id":42}',
    });
  });

  it.skipIf(!playwright)(
    "walks a *.localhost name listed in qa.origins, as this machine",
    async () => {
      const named = shop.url.replace("127.0.0.1", "shop.localhost");
      const parsed = parseWalk({
        title: "Named",
        app: { url: named },
        steps: [{ go: "/" }, { request: { method: "POST", path: "/orders" } }],
      });
      if (!parsed.ok) throw new Error(parsed.error.join("; "));
      const log = await playWalk(
        playwright as Playwright,
        parsed.value,
        folder(),
        originPolicy([named]),
      );
      expect(log.stopped).toBe(false);
      expect(log.steps[0]?.calls).toEqual([{ method: "GET", path: "/", status: 200 }]);
      expect(log.steps[1]?.calls).toEqual([{ method: "POST", path: "/orders", status: 201 }]);
    },
  );
});

describe("playWalk reaches only what qa.origins allows", () => {
  const onlyTheShop = () => originPolicy([shop.url]);

  it.skipIf(!playwright)("stops a go or a request to anywhere else", async () => {
    for (const step of [
      { go: `${outside.url}/` },
      { request: { method: "POST", path: `${outside.url}/x` } },
    ]) {
      const before = outside.hits();
      const log = await playWalk(playwright as Playwright, walkOf([step]), folder(), onlyTheShop());
      expect(log.stopped).toBe(true);
      expect(log.steps[0]?.failure).toBe(
        `${outside.url}/${"go" in step ? "" : "x"} is outside qa.origins: a walk reaches this machine, or what the config lists`,
      );
      expect(outside.hits()).toBe(before);
    }
  });

  it.skipIf(!playwright)(
    "follows no redirect out: the browser's is blocked, a request's is shown",
    async () => {
      awayTo = `${outside.url}/leak?card=4242`;
      const before = outside.hits();
      const log = await playWalk(
        playwright as Playwright,
        walkOf([
          { go: "/away" },
          { request: { method: "POST", path: "/away", body: { card: 4242 } } },
        ]),
        folder(),
        onlyTheShop(),
      );
      expect(log.steps[0]?.calls).toContainEqual({
        method: "GET",
        path: `${outside.url}/leak?card=4242`,
        status: "blocked: outside qa.origins",
      });
      expect(log.steps[1]?.calls).toEqual([{ method: "POST", path: "/away", status: 307 }]);
      expect(log.steps[1]?.answer).toBe(`redirect to ${outside.url}/leak?card=4242, not followed`);
      expect(outside.hits()).toBe(before);
    },
  );

  it.skipIf(!playwright)(
    "blocks the page's own calls and sockets to anywhere else, and logs them",
    async () => {
      const before = outside.hits();
      const ws = outside.url.replace("http", "ws");
      const log = await playWalk(
        playwright as Playwright,
        walkOf([
          { go: "/" },
          {
            keep: {
              sent: `fetch("${outside.url}/leak", { method: "POST", body: "secret" }).then(() => "sent", () => "blocked")`,
              socket: `new Promise((done) => { const s = new WebSocket("${ws}/leak"); s.onopen = () => done("open"); s.onclose = () => done("closed"); })`,
            },
          },
          { reload: true },
        ]),
        folder(),
        onlyTheShop(),
      );
      expect(log.steps[1]?.answer).toBe('sent = "blocked" · socket = "closed"');
      expect(log.steps.flatMap((s) => s.calls)).toContainEqual({
        method: "CONNECT",
        path: outside.url.replace("http://", ""),
        status: "blocked: outside qa.origins",
      });
      expect(log.steps.flatMap((s) => s.calls)).toContainEqual({
        method: "POST",
        path: `${outside.url}/leak`,
        status: "blocked: outside qa.origins",
      });
      expect(outside.hits()).toBe(before);
    },
  );
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
