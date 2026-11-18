import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  importsOf,
  largestSections,
  measureLayer,
  readingList,
} from "./context-budget.ts";

describe("estimateTokens", () => {
  it("counts a token per four characters, rounding up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("largestSections", () => {
  const status = (done: string) =>
    [
      "# Status",
      "intro",
      "## Now",
      "s".repeat(120),
      "## Done",
      done,
      "## Next",
      "z".repeat(40),
    ].join("\n");

  it("splits at the shallowest heading below the title and puts the heaviest first", () => {
    const sections = largestSections(status(`${"x".repeat(40)}\n### F1\n${"y".repeat(40)}`));
    expect(sections.map((s) => s.heading)).toEqual(["## Now", "## Done", "## Next"]);
    expect(sections[1]?.tokens).toBe(25); // its ### F1 stays inside it
  });

  it("goes one level deeper while one part holds more than half the file", () => {
    const done = ["### F1", "x".repeat(800), "### F2", "y".repeat(400)].join("\n");
    const sections = largestSections(status(done));
    expect(sections.map((s) => s.heading)).toEqual(["### F1", "### F2", "## Now"]);
  });

  it("cuts at # when a file has several top headings", () => {
    const rules = ["# Commands", "c".repeat(300), "# Architecture", "a".repeat(600)].join("\n");
    expect(largestSections(rules).map((s) => s.heading)).toEqual(["# Architecture", "# Commands"]);
  });

  it("never cuts at a # inside fenced code, such as a shell comment", () => {
    const setup = [
      "## Setup",
      "```bash",
      "# install the dependencies",
      "npm ci",
      "```",
      "s".repeat(900),
    ];
    const rules = ["# Rules", ...setup, "## Style", "t".repeat(400)].join("\n");
    expect(largestSections(rules).map((s) => s.heading)).toEqual(["## Setup", "## Style", "(top)"]);
  });

  it("does not go deeper when the heaviest part is the preamble", () => {
    const sections = largestSections(`${"p".repeat(1200)}\n## A\n${"a".repeat(600)}\n### A1\nx\n`);
    expect(sections.map((s) => s.heading)).toEqual(["(top)", "## A"]);
    expect(sections[1]?.tokens).toBe(154);
  });

  it("keeps a file without subheadings in one piece", () => {
    expect(largestSections("# Title\nbody\n")).toEqual([{ heading: "(top)", tokens: 4 }]);
  });
});

describe("importsOf", () => {
  it("finds @ imports and leaves out code, emails, absolute and home paths", () => {
    const claude = [
      "See @AGENTS.md and @docs/rules.md.",
      "@./local.md",
      "Write to team@example.com, not @/etc/passwd or @~/.claude/me.md.",
      "`@inline.md` is code.",
      "```",
      "@fenced.md",
      "```",
    ].join("\n");
    expect(importsOf(claude)).toEqual(["AGENTS.md", "docs/rules.md", "./local.md"]);
  });
});

describe("readingList", () => {
  const status = [
    "## Next",
    "Fix the export.",
    "### Read first",
    "- `docs/flows/export.md`: how it works today",
    "- `src/export/export.ts:42` and [the plan](.aidt/tasks/feat-x/plan.md)",
    "- [docs](https://example.com/docs) are not paths in the repository",
    "<!-- - `docs/<flow>.md`: an example in the template -->",
    "Some text with `not/a/list/item.md`.",
    "### Not needed",
    "- `docs/history.md`",
  ].join("\n");

  it("takes the paths of the list under «Read first», up to the next heading", () => {
    expect(readingList(status)).toEqual([
      "docs/flows/export.md",
      "src/export/export.ts",
      ".aidt/tasks/feat-x/plan.md",
    ]);
  });

  it("reads paths before the «: why» part, never the code or links quoted in it", () => {
    const list = [
      "### Read first",
      "- `src/money/money.ts`: how `Money.fromCents` rejects `0.5`",
      "- `https://example.com/api`: the provider's docs",
    ].join("\n");
    expect(readingList(list)).toEqual(["src/money/money.ts"]);
  });

  it("keeps a path with a line number, and reads a link from / at the repository root", () => {
    const list = "### Read first\n- `CONTRIBUTING.md:31`: the size rule\n- [flow](/docs/flow.md)\n";
    expect(readingList(list, ".aidt")).toEqual(["CONTRIBUTING.md", "docs/flow.md"]);
  });

  it("resolves links from the status file's folder, backticks from the repository root", () => {
    const list = "### Read first\n- [the plan](tasks/feat-x/plan.md) and `docs/a.md`\n";
    expect(readingList(list, ".aidt")).toEqual(["docs/a.md", ".aidt/tasks/feat-x/plan.md"]);
  });

  it("is empty when the status has no such list", () => {
    expect(readingList("## Now\n- `a/b.md`\n")).toEqual([]);
  });
});

describe("measureLayer", () => {
  const files = [
    { path: "AGENTS.md", text: `# Rules\n## Commands\n${"a".repeat(80)}\n` },
    { path: "docs/more.md", text: "b".repeat(40), importedBy: "CLAUDE.md" },
  ];

  it("adds up the files and stays quiet within budget", () => {
    const layer = measureLayer("always", files, 100);
    expect(layer).toMatchObject({ name: "always", tokens: 36, over: false });
    expect(layer.files.every((f) => f.largest.length === 0)).toBe(true);
    expect(layer.files[1]?.importedBy).toBe("CLAUDE.md");
  });

  it("over budget, names the heaviest sections of each file", () => {
    const layer = measureLayer("always", files, 10);
    expect(layer.over).toBe(true);
    expect(layer.files[0]?.largest[0]?.heading).toBe("## Commands");
  });
});
