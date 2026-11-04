import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../shared/config/config.ts";
import { commitAll, featureRepo, write } from "../shared/testing/temp-repo.ts";
import { checkCommand } from "./check.command.ts";

const TASK = ".aidt/tasks/feature";
const SPEC = "## Requirements\n- **R1** adds\n- **R2** subtracts\n";

/** A `feature` task with one committed section of `lines` lines and its tests. */
function task(lines: number, tests: string): string {
  const repo = featureRepo();
  write(repo, {
    "calc.ts": "export const x = 1;\n".repeat(lines),
    "calc.test.ts": tests,
  });
  commitAll(repo, "feat: calc");
  const commit = "HEAD";
  mkdirSync(join(repo, TASK), { recursive: true });
  writeFileSync(join(repo, TASK, "spec.md"), SPEC);
  const sections = [{ id: "S1", name: "Calc", status: "approved", commit }];
  writeFileSync(
    join(repo, TASK, "state.json"),
    JSON.stringify({ version: 1, branch: "feature", phase: "build", sections }),
  );
  return repo;
}

async function check(repo: string) {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const code = await checkCommand({ root: repo, config: await loadConfig(repo), flags: {} });
  const printed = out.mock.calls.map((c) => String(c[0])).filter((s) => !s.includes("\u0000"));
  return { code, out: printed.join("") };
}

describe("aidt check", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes when sections are small and every requirement has a test", async () => {
    const { code, out } = await check(task(10, 'it("R1: adds"); it("R2: subtracts");'));
    expect(code).toBe(0);
    expect(out).toContain("✓ S1  10 reviewable lines");
    expect(out).toContain("Requirements with a test: 2/2");
  });

  it("fails on an oversized section and on a requirement without a test", async () => {
    const { code, out } = await check(task(301, 'it("R1: adds");'));
    expect(code).toBe(1);
    expect(out).toContain("✗ S1  301 reviewable lines");
    expect(out).toContain("✗ R2 is not referenced by any test of this task");
  });
});
