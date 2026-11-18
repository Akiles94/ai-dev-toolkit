import { describe, expect, it } from "vitest";
import { describeStep, fillIn, parseWalk, type WalkStep } from "./qa-walk.ts";

const valid = {
  title: "Double tap on Add to cart",
  app: { url: "http://localhost:3000" },
  people: { shopper: { device: "phone" }, intruder: {} },
  steps: [
    { go: "/" },
    { click: "Add to cart", times: 2 },
    { click: { selector: "#qty", nth: 1 } },
    { fill: { label: "Email", value: "{cart}@example.com" } },
    { select: { label: "Category", option: "Books" } },
    { press: "Enter" },
    { wait: 500 },
    { back: true },
    { reload: true },
    { look: "the cart" },
    { keep: { cart: "localStorage.getItem('shop.cartId')" } },
    { as: "intruder", request: { method: "DELETE", path: "/carts/{cart}/items/p-2" } },
    { request: { path: "/products" } },
    { offline: true },
    { clear: "cookies" },
    { clear: "storage" },
  ],
};

describe("parseWalk", () => {
  it("accepts every kind of step, with each person's device", () => {
    const parsed = parseWalk(valid);
    expect(parsed.ok && parsed.value.people).toEqual({
      shopper: { device: "phone" },
      intruder: { device: "desktop" },
    });
  });

  it("walks as one person on a desktop when the walk names nobody", () => {
    const parsed = parseWalk({ ...valid, people: undefined, steps: [{ go: "/" }] });
    expect(parsed.ok && parsed.value.people).toEqual({ person: { device: "desktop" } });
  });

  it("reports every problem at once, with the step where it is", () => {
    const parsed = parseWalk({
      title: "",
      app: { url: "localhost:3000" },
      people: { shopper: { device: "tablet" }, "two words": {} },
      steps: [
        { go: "/", back: true },
        { as: "nobody", go: "/" },
        { go: "/", times: 2 },
        { click: "Add", times: 9 },
        { request: { method: "TRACE", path: "/" } },
        { keep: { "bad name": "location.href" } },
        { clear: "everything" },
        { look: "", as: "shopper" },
        { reload: true, slow: 3000 },
      ],
    });
    expect(!parsed.ok && parsed.error).toEqual([
      "needs a `title`",
      "`app.url` must be an http(s) address",
      "person shopper: a name of letters, digits or _, with a `device` of desktop or phone",
      "person two words: a name of letters, digits or _, with a `device` of desktop or phone",
      "step 1: must have exactly one of go, press, wait, click, fill, select, back, reload, look, keep, request, offline, clear",
      "step 2: `as` names nobody in `people` ()",
      "step 3: `times` goes with a click",
      "step 4: `times` is a whole number from 1 to 5",
      "step 5: request needs a `path`, and a `method` among GET, POST, PUT, PATCH, DELETE",
      "step 6: keep needs names (letters, digits, _) and the page expression each one keeps",
      "step 7: clear is `cookies` or `storage`",
      "step 8: look needs what to look at, as a text",
      "step 9: unknown key `slow`",
    ]);
  });

  it("never takes the command that starts the app from a walk", () => {
    const parsed = parseWalk({ ...valid, app: { ...valid.app, start: "npm start; curl evil" } });
    expect(!parsed.ok && parsed.error).toEqual([
      "`app.start` is not read from a walk: start the app as .aidt/app.md says",
    ]);
  });

  it("needs steps, and an object", () => {
    expect(!parseWalk({ ...valid, steps: [] }).ok).toBe(true);
    expect(parseWalk([])).toEqual({ ok: false, error: ["the walk must be a JSON object"] });
    expect(!parseWalk({ ...valid, people: {} }).ok).toBe(true);
  });
});

describe("fillIn", () => {
  const kept = new Map([["cart", "cart-1a2b"]]);

  it("puts each kept value where its name is", () => {
    expect(fillIn("/carts/{cart}/items/{cart}", kept)).toEqual({
      ok: true,
      value: "/carts/cart-1a2b/items/cart-1a2b",
    });
  });

  it("leaves JSON alone, and stops at a name nothing was kept as", () => {
    expect(fillIn('{"qty":1}', kept)).toEqual({ ok: true, value: '{"qty":1}' });
    expect(fillIn("/orders/{order}", kept)).toEqual({
      ok: false,
      error: "nothing was kept as {order} before this step",
    });
  });
});

describe("describeStep", () => {
  it("says each step in a few words, for the log", () => {
    const said = (step: WalkStep) => describeStep(step);
    expect(said({ go: "/" })).toBe("go /");
    expect(said({ click: "Add to cart", times: 2 })).toBe('click "Add to cart" ×2');
    expect(said({ as: "intruder", request: { method: "DELETE", path: "/carts/{cart}" } })).toBe(
      "request DELETE /carts/{cart}",
    );
    expect(said({ request: { path: "/products" } })).toBe("request GET /products");
    expect(said({ look: "the cart" })).toBe("look «the cart»");
    expect(said({ keep: { cart: "x", order: "y" } })).toBe("keep cart, order");
    expect(said({ offline: true })).toBe("offline");
    expect(said({ offline: false })).toBe("online");
    expect(said({ back: true })).toBe("back");
    expect(said({ wait: 500 })).toBe("wait 500 ms");
    expect(said({ clear: "cookies" })).toBe("clear cookies");
    expect(said({ fill: { label: "Email", value: "a" } })).toBe(
      'fill {"label":"Email","value":"a"}',
    );
  });
});
