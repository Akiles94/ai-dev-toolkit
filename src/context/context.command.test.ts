import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../shared/config/config.ts";
import { featureRepo, write } from "../shared/testing/temp-repo.ts";
import { contextCommand } from "./context.command.ts";

async function check(repo: string, flags = {}) {
  const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  const code = await contextCommand({ root: repo, config: await loadConfig(repo), flags }, "check");
  const printed = out.mock.calls.map((c) => String(c[0])).filter((s) => !s.includes("\u0000"));
  return { code, out: printed.join("") };
}

/** A repo whose CLAUDE.md imports AGENTS.md and a rules file, with a status in `.aidt/`. */
function projectRepo(status: string): string {
  const repo = featureRepo();
  mkdirSync(join(repo, ".aidt"));
  mkdirSync(join(repo, "docs"));
  write(repo, {
    "AGENTS.md": "# Rules\nRun npm test.\n",
    "CLAUDE.md": "@AGENTS.md\n@docs/rules.md\n",
    "docs/rules.md": "Names in English.\n",
    "docs/flow.md": "x".repeat(400),
    ".aidt/status.md": status,
  });
  return repo;
}

const STATUS = "# Status\n## Next\n### Read first\n- `docs/flow.md`\n";

describe("aidt context check", () => {
  afterEach(() => vi.restoreAllMocks());

  it("measures what loads by itself, each file once, and the reading list", async () => {
    const { code, out } = await check(projectRepo(STATUS));
    expect(code).toBe(0);
    expect(out).toContain("Always (loaded by the tool): 18 / 3,000 tokens · ok");
    expect(out).toContain("docs/rules.md  5  (imported by CLAUDE.md)");
    expect(out.match(/AGENTS\.md {2}/g)).toHaveLength(1);
    expect(out).toContain("Read first (next session): 1 path(s), 100 tokens");
  });

  it("counts what AGENTS.md imports when CLAUDE.md imports AGENTS.md", async () => {
    const repo = projectRepo(STATUS);
    write(repo, { "AGENTS.md": "# Rules\n@docs/flow.md\n" });
    const { out } = await check(repo);
    expect(out).toContain("docs/flow.md  100  (imported by AGENTS.md)");
  });

  it("follows imports inside the repository only, each file once, at most five hops", async () => {
    const repo = projectRepo(STATUS);
    const outside = `${basename(repo)}-outside.md`;
    writeFileSync(join(repo, "..", outside), "o".repeat(4000));
    mkdirSync(join(repo, "chain"));
    write(repo, {
      "CLAUDE.md": `@../${outside} @docs/rules.md @chain/1.md\n`,
      "docs/rules.md": "@../CLAUDE.md @rules.md\n",
      ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`chain/${i}.md`, `@${i + 1}.md\n`])),
    });
    const { out } = await check(repo);
    rmSync(join(repo, "..", outside));
    expect(out).not.toContain(outside);
    expect(out.match(/docs\/rules\.md {2}/g)).toHaveLength(1);
    expect(out).toContain("chain/5.md");
    expect(out).not.toContain("chain/6.md");
  });

  it("fails over budget and names the sections to move", async () => {
    const repo = projectRepo(`# Status\n## Now\nwork\n## Done\n${"d".repeat(12_000)}\n`);
    const { code, out } = await check(repo);
    expect(code).toBe(1);
    expect(out).toContain("Start (read first, every session): 3,008 / 2,500 tokens · over by 508");
    expect(out).toContain("  3,003  ## Done");
  });

  it("resolves the status's links from its own folder", async () => {
    const repo = projectRepo("## Next\n### Read first\n- [the plan](tasks/feat-x/plan.md)\n");
    mkdirSync(join(repo, ".aidt", "tasks", "feat-x"), { recursive: true });
    write(repo, { ".aidt/tasks/feat-x/plan.md": "# Plan\n" });
    const { code, out } = await check(repo);
    expect(code).toBe(0);
    expect(out).not.toContain("missing");
  });

  it("fails when a path the next session must read does not exist", async () => {
    const repo = projectRepo(`${STATUS}- \`docs/gone.md\`\n`);
    const { code, out } = await check(repo);
    expect(code).toBe(1);
    expect(out).toContain("missing: docs/gone.md");
  });

  it("reads the files and budgets of the config, and prints JSON with --json", async () => {
    const repo = projectRepo(STATUS);
    write(repo, {
      ".aidt/config.json": JSON.stringify({
        context: { start: ["docs/flow.md"], budget: { start: 50 } },
      }),
    });
    const { code, out } = await check(repo, { json: true });
    const report = JSON.parse(out);
    expect(code).toBe(1);
    expect(report.layers[1]).toMatchObject({ name: "start", budget: 50, tokens: 100, over: true });
    expect(report.layers[0].budget).toBe(3000);
    expect(report.reading).toEqual([]);
  });
});
