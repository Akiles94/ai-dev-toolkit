import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../shared/config.ts";
import { featureRepo, write } from "../shared/testing/temp-repo.ts";
import { structureCommand } from "./structure.command.ts";

async function audit(repo: string, flags = {}) {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const code = await structureCommand(
    { root: repo, config: await loadConfig(repo), flags },
    "audit",
  );
  // Only what the command printed, as one string.
  const printed = out.mock.calls.map((c) => String(c[0])).filter((s) => !s.includes("\u0000"));
  return { code, out: printed.join("") };
}

/** A repo with a junk drawer, a test and a config file next to the clean `app.ts`. */
function messyRepo(): string {
  const repo = featureRepo();
  mkdirSync(join(repo, "src", "utils"), { recursive: true });
  write(repo, {
    "src/utils/format.ts": "export const f = 1;\n",
    "src/utils/format.test.ts": "test\n",
    "vite.config.ts": "export default {};\n",
  });
  return repo;
}

describe("aidt structure audit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reports broken rules on source files only and exits 1", async () => {
    const { code, out } = await audit(messyRepo());
    expect(code).toBe(1);
    expect(out).toContain("1 finding(s) in 2 source files");
    expect(out).toContain("src/utils/  junk-drawer folder");
  });

  it("skips the exceptions recorded in the structure decision", async () => {
    const repo = messyRepo();
    mkdirSync(join(repo, ".aidt"));
    writeFileSync(join(repo, ".aidt", "structure.md"), "## Exceptions\n- `src/utils/**` legacy\n");
    const { code, out } = await audit(repo);
    expect(code).toBe(0);
    expect(out).toContain("1 source files, no findings");
  });

  it("prints JSON with --json", async () => {
    const { out } = await audit(messyRepo(), { json: true });
    expect(JSON.parse(out).findings[0]).toEqual({
      rule: "S1",
      path: "src/utils/",
      message: "junk-drawer folder",
    });
  });
});
