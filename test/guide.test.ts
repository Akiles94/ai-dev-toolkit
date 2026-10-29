import { describe, expect, it } from "vitest";
import { countGuides, isMarkdown, stripGuides } from "../src/core/guide.ts";

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
    expect(countGuides("// @explain: hi\n// @guide: not this one\n", "@explain")).toBe(1);
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
