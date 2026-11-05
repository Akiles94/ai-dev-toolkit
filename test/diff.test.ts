import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../src/core/config.ts";
import { classify, parseNumstat, summarize } from "../src/core/diff.ts";

describe("parseNumstat", () => {
  it("parses plain, binary and renamed entries from -z output", () => {
    const output = "10\t2\tsrc/a.ts\0-\t-\tlogo.png\x003\t1\t\0old/b.ts\0new/b.ts\0";
    expect(parseNumstat(output)).toEqual([
      { path: "src/a.ts", added: 10, deleted: 2, binary: false },
      { path: "logo.png", added: 0, deleted: 0, binary: true },
      { path: "new/b.ts", oldPath: "old/b.ts", added: 3, deleted: 1, binary: false },
    ]);
  });

  it("returns nothing for an empty diff", () => {
    expect(parseNumstat("")).toEqual([]);
  });
});

describe("classify", () => {
  const change = (path: string, added = 5, deleted = 0) => ({
    path,
    added,
    deleted,
    binary: false,
  });
  const real = (paths: string[]) => new Map(paths.map((p) => [p, 5]));

  it("separates code, tests, noise and formatting-only changes", () => {
    const changes = [
      change("src/rate-limiter.ts"),
      change("src/rate-limiter.test.ts"),
      change("package.json", 2, 1),
      change(".github/workflows/ci.yml"),
      change("package-lock.json", 900, 40),
      change("src/__snapshots__/a.snap"),
      change("src/reformatted.ts", 7, 7),
    ];
    const withoutWhitespace = real([
      "src/rate-limiter.ts",
      "src/rate-limiter.test.ts",
      "package.json",
      ".github/workflows/ci.yml",
    ]);
    const categories = classify(changes, withoutWhitespace, DEFAULT_CONFIG).map((c) => c.category);
    expect(categories).toEqual([
      "code",
      "test",
      "config",
      "config",
      "noise",
      "noise",
      "formatting",
    ]);
  });

  it("does not count task artifacts (spec, plan, reviews) as code", () => {
    const [result] = classify(
      [change(".aidt/tasks/feat-x/spec.md")],
      real([".aidt/tasks/feat-x/spec.md"]),
      DEFAULT_CONFIG,
    );
    expect(result?.category).toBe("noise");
  });

  it("does not call a pure rename a formatting change", () => {
    const [result] = classify([change("src/moved.ts", 0, 0)], new Map(), DEFAULT_CONFIG);
    expect(result?.category).toBe("code");
  });

  it("honours custom exclude globs", () => {
    const limits = { ...DEFAULT_CONFIG.limits, exclude: ["**/*.sql"] };
    const config = { ...DEFAULT_CONFIG, limits };
    const [result] = classify([change("db/schema.sql")], real(["db/schema.sql"]), config);
    expect(result?.category).toBe("noise");
  });
});

describe("summarize", () => {
  it("adds up each category", () => {
    const summary = summarize("main...HEAD", [
      { path: "a.ts", added: 10, deleted: 2, binary: false, category: "code" },
      { path: "b.ts", added: 5, deleted: 1, binary: false, category: "code" },
      { path: "a.test.ts", added: 20, deleted: 0, binary: false, category: "test" },
    ]);
    expect(summary.totals.code).toEqual({ files: 2, added: 15, deleted: 3 });
    expect(summary.totals.test).toEqual({ files: 1, added: 20, deleted: 0 });
    expect(summary.totals.noise).toEqual({ files: 0, added: 0, deleted: 0 });
  });
});
