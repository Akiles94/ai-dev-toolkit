import { describe, expect, it } from "vitest";
import { isMarkdown, stripGuides } from "./guide-comments.ts";

const M = "@guide";

describe("stripGuides", () => {
  it("removes full-line guide comments in every supported syntax", () => {
    const input = [
      "const a = 1;",
      `// ${M}: explains a`,
      `# ${M}: python or yaml`,
      `-- ${M}: sql`,
      `<!-- ${M}: html -->`,
      `/* ${M}: block on one line */`,
      ` * ${M}: inside a block comment`,
      "const b = 2;",
    ].join("\n");
    const result = stripGuides(input, M);
    expect(result.content).toBe("const a = 1;\nconst b = 2;");
    expect(result.removed).toBe(6);
  });

  it("removes JSX guide comments, on one line or several", () => {
    const input = [
      "<form>",
      `  {/* ${M}: one line */}`,
      `  {/* ${M}: same labels as the Project screen:`,
      "      only two of them are translated */}",
      "  <select />",
      "</form>",
    ].join("\n");
    const result = stripGuides(input, M);
    expect(result.content).toBe("<form>\n  <select />\n</form>");
    expect(result.removed).toBe(3);
  });

  it("removes a whole guide block comment when only its first line is marked", () => {
    const input = [`/* ${M}: why this order`, "   matters for the lock", "*/", "lock();"].join(
      "\n",
    );
    expect(stripGuides(input, M)).toEqual({ content: "lock();", removed: 3 });
  });

  it("keeps a normal block comment that follows a guide line", () => {
    const input = [`// ${M}: explains`, "/* keep this", "   block */", "x();"].join("\n");
    expect(stripGuides(input, M).content).toBe("/* keep this\n   block */\nx();");
  });

  it("removes only the comment when it trails code", () => {
    const result = stripGuides(`check(ip); // ${M}: before the password\n`, M);
    expect(result.content).toBe("check(ip);\n");
    expect(result.removed).toBe(1);
  });

  it("keeps normal comments and the marker inside other words", () => {
    const input = `// keep me\n// ${M}d is not the marker\nconst url = "http://x";\n`;
    expect(stripGuides(input, M)).toEqual({ content: input, removed: 0 });
  });

  it("preserves CRLF line endings", () => {
    const result = stripGuides(`a\r\n// ${M}: x\r\nb\r\n`, M);
    expect(result.content).toBe("a\r\nb\r\n");
  });

  it("supports a custom marker", () => {
    expect(stripGuides("// @explain: hi\n// @guide: not this one\n", "@explain").removed).toBe(1);
  });

  it("leaves Markdown code fences untouched when asked", () => {
    const input = `Intro\n<!-- ${M}: remove -->\n\`\`\`ts\n// ${M}: example\n\`\`\`\n`;
    const result = stripGuides(input, M, { skipFences: true });
    expect(result.content).toBe(`Intro\n\`\`\`ts\n// ${M}: example\n\`\`\`\n`);
    expect(result.removed).toBe(1);
  });
});

describe("isMarkdown", () => {
  it("detects Markdown files", () => {
    expect(isMarkdown("docs/a.md")).toBe(true);
    expect(isMarkdown("README.MDX")).toBe(true);
    expect(isMarkdown("src/a.ts")).toBe(false);
  });
});
