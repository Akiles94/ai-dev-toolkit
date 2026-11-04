import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../shared/config.ts";
import { auditStructure, exceptionGlobs, type SourceFile } from "./structure-rules.ts";

const RULES = { ...DEFAULT_CONFIG.structure, maxFileLines: 100, maxFolderFiles: 3 };
const files = (...paths: string[]): SourceFile[] => paths.map((path) => ({ path, lines: 10 }));
const audit = (list: SourceFile[]) =>
  auditStructure(list, RULES).map((f) => `${f.rule} ${f.path} ${f.message}`);

describe("auditStructure", () => {
  it("passes a feature-first layout", () => {
    expect(
      audit(
        files(
          "src/main.ts",
          "src/features/orders/orders.api.ts",
          "src/features/orders/order-list.ts",
          "src/shared/money/format-money.ts",
        ),
      ),
    ).toEqual([]);
  });

  it("S1: reports junk-drawer folders and files, and loose files in umbrella folders", () => {
    expect(
      audit(files("src/utils/format.ts", "src/orders/order-helpers.ts", "src/shared/a.ts")),
    ).toEqual([
      "S1 src/utils/ junk-drawer folder",
      "S1 src/orders/order-helpers.ts junk-drawer file",
      "S1 src/shared/ loose files in src/shared: a.ts",
    ]);
  });

  it("S2: reports one file for everything at a root or umbrella, not inside a feature", () => {
    expect(audit(files("src/api.ts", "src/common/http/types.ts", "src/orders/api.ts"))).toEqual([
      "S2 src/api.ts one file for the whole app: split it by feature",
      "S4 src/api.ts loose file among folders",
    ]);
  });

  it("S3: reports long files and crowded folders", () => {
    const crowded = files("src/a/w.ts", "src/a/x.ts", "src/a/y.ts", "src/a/z.ts");
    expect(audit([{ path: "src/b/big.ts", lines: 101 }, ...crowded])).toEqual([
      "S3 src/b/big.ts 101 lines (max 100)",
      "S3 src/a/ 4 files directly inside (max 3)",
    ]);
  });

  it("S4: reports non-entry files among folders", () => {
    expect(audit(files("src/index.ts", "src/router.ts", "src/a/x.ts", "src/b/y.ts"))).toEqual([
      "S4 src/router.ts loose file among folders",
    ]);
  });

  it("S5: reports the minority casing per extension and ignores one-word names", () => {
    expect(
      audit(
        files(
          "src/a/order-list.ts",
          "src/a/order-row.ts",
          "src/b/orderForm.ts",
          "src/b/x.ts",
          "src/b/Page.tsx",
        ),
      ),
    ).toEqual(["S5 src/b/orderForm.ts camelCase among .ts files that are mostly kebab-case"]);
  });
});

describe("exceptionGlobs", () => {
  it("reads the globs of the Exceptions section only, ignoring comments", () => {
    const decision = [
      "## Naming",
      "`src/**/*.ts` kebab-case",
      "## Exceptions",
      "<!-- e.g. `example/**` -->",
      "- `src/legacy/**` keeps its layout until migrated",
      "- `src/**/errors.ts`: one per module",
      "## Migration",
      "`src/old/**`",
    ].join("\n");
    expect(exceptionGlobs(decision)).toEqual(["src/legacy/**", "src/**/errors.ts"]);
  });
});
