import { describe, expect, it } from "vitest";
import { narration, parseScript } from "./demo-script.ts";

const valid = {
  title: "Low-stock page",
  app: { start: "npm start", url: "http://localhost:3000" },
  scenes: [
    {
      title: "The admin opens the page",
      steps: [
        { go: "/admin" },
        { say: "Every product about to run out, lowest first." },
        { click: "Restock" },
        { click: { selector: "#qty", nth: 1 } },
        { fill: { label: "Quantity", value: "12" } },
        { press: "Enter" },
        { scroll: "Alerts" },
        { wait: 500 },
      ],
    },
    { title: "Other paths", steps: [{ say: "With nothing low, the page says so." }] },
  ],
};

describe("parseScript", () => {
  it("accepts every kind of step, on a desktop unless the script says otherwise", () => {
    const parsed = parseScript(valid);
    expect(parsed.ok && parsed.value.device).toBe("desktop");
  });

  it("reports every problem at once, with the scene and step where it is", () => {
    const parsed = parseScript({
      title: "",
      app: { url: "localhost:3000" },
      device: "tablet",
      scenes: [
        {
          title: "One",
          steps: [{ say: "" }, { click: {} }, { go: "/", say: "two kinds" }, { wait: 0 }],
        },
        { steps: [] },
      ],
    });
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toEqual([
      "needs a `title`",
      "`app.url` must be an http(s) address",
      "`device` is `desktop` or `phone`",
      "scene 1, step 1: say needs a text",
      "scene 1, step 2: click needs a text, or an object with `text` or `selector`",
      "scene 1, step 3: must have exactly one of go, say, press, scroll, wait, click, fill",
      "scene 1, step 4: wait needs milliseconds",
      "scene 2: needs a `title` and a list of `steps`",
    ]);
  });

  it("needs at least one scene", () => {
    const parsed = parseScript({ ...valid, scenes: [] });
    expect(!parsed.ok && parsed.error).toEqual(["needs at least one scene"]);
  });

  it("rejects what is not an object", () => {
    expect(parseScript([]).ok).toBe(false);
  });
});

describe("narration", () => {
  it("lists every line the voice says, in order", () => {
    const parsed = parseScript(valid);
    expect(parsed.ok && narration(parsed.value)).toEqual([
      "Every product about to run out, lowest first.",
      "With nothing low, the page says so.",
    ]);
  });
});
