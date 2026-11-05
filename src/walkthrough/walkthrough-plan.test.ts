import { describe, expect, it } from "vitest";
import type { FileCategory, FileChange } from "../shared/changes/changes.ts";
import { layerOf, planWalkthrough, subjectOf } from "./walkthrough-plan.ts";

const file = (path: string, added: number, category: FileCategory = "code"): FileChange => ({
  path,
  added,
  deleted: 0,
  binary: false,
  category,
});

const paths = (plan: ReturnType<typeof planWalkthrough>) =>
  plan.sections.map((s) => s.files.map((f) => f.path));

describe("layerOf", () => {
  it.each([
    ["src/domain/order.ts", "contracts"],
    ["src/cart/cart.types.ts", "contracts"],
    ["src/cart/cart-service.ts", "core"],
    ["src/api/orders.ts", "integration"],
    ["src/components/Cart.tsx", "ui"],
    ["web/styles/cart.css", "ui"],
    ["docs/design.md", "docs"],
  ])("%s → %s", (path, layer) => {
    expect(layerOf(path)).toBe(layer);
  });
});

describe("subjectOf", () => {
  it.each([
    ["src/cart.test.ts", "cart"],
    ["src/cart.spec.tsx", "cart"],
    ["pkg/cart_test.go", "cart"],
    ["tests/test_cart.py", "cart"],
    ["Tests/CartTests.swift", "cart"],
  ])("%s → %s", (path, subject) => {
    expect(subjectOf(path)).toBe(subject);
  });
});

describe("planWalkthrough", () => {
  it("orders sections from contracts to UI, then loose tests and config", () => {
    const plan = planWalkthrough(
      [
        file("src/components/Cart.tsx", 50),
        file("src/api/orders.ts", 40),
        file("src/cart/cart.ts", 60),
        file("src/domain/order.ts", 30),
        file("README.md", 10),
        file("test/e2e/checkout.test.ts", 20, "test"),
        file("package.json", 2, "config"),
      ],
      300,
    );
    expect(plan.sections.map((s) => s.layer)).toEqual([
      "contracts",
      "core",
      "integration",
      "ui",
      "docs",
      "tests",
      "config",
    ]);
    expect(plan.sections.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
  });

  it("reads each test next to the file it tests, without counting it toward the limit", () => {
    const plan = planWalkthrough(
      [file("src/cart/cart.ts", 280), file("src/cart/cart.test.ts", 150, "test")],
      300,
    );
    expect(paths(plan)).toEqual([["src/cart/cart.ts", "src/cart/cart.test.ts"]]);
    expect(plan.sections[0]).toMatchObject({ lines: 280, testLines: 150, oversized: false });
  });

  it("keeps a folder together when it fits, and starts a new section when it does not", () => {
    const plan = planWalkthrough(
      [
        file("src/a/one.ts", 150),
        file("src/a/two.ts", 100),
        file("src/b/three.ts", 100),
        file("src/b/four.ts", 100),
      ],
      300,
    );
    expect(paths(plan)).toEqual([
      ["src/a/one.ts", "src/a/two.ts"],
      ["src/b/four.ts", "src/b/three.ts"],
    ]);
  });

  it("packs a big folder file by file and gives an oversized file a section of its own", () => {
    const plan = planWalkthrough(
      [file("src/x/a.ts", 200), file("src/x/b.ts", 500), file("src/x/c.ts", 50)],
      300,
    );
    expect(paths(plan)).toEqual([["src/x/a.ts"], ["src/x/b.ts"], ["src/x/c.ts"]]);
    expect(plan.sections.map((s) => s.oversized)).toEqual([false, true, false]);
  });

  it("lists noise and formatting apart and never reads them", () => {
    const plan = planWalkthrough(
      [
        file("src/a.ts", 10),
        file("package-lock.json", 900, "noise"),
        file("src/b.ts", 4, "formatting"),
      ],
      300,
    );
    expect(paths(plan)).toEqual([["src/a.ts"]]);
    expect(plan.skipped.map((f) => f.path)).toEqual(["package-lock.json", "src/b.ts"]);
  });
});
