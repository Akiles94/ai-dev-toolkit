import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { type CliContext, print } from "../shared/cli/cli-context.ts";
import { type Agent, parseAgent } from "./agent.ts";
import { GENERATED_MARKER } from "./agent-markdown.ts";
import type { AgentRenderer, GeneratedFile } from "./agent-renderer.port.ts";
import { claudeCodeAgentRenderer } from "./claude-code-agent-renderer.ts";
import { copilotAgentRenderer } from "./copilot-agent-renderer.ts";

/** Supported AI tools, by the name used in `sync.harnesses`. */
const RENDERERS: Record<string, AgentRenderer> = {
  copilot: copilotAgentRenderer,
  "claude-code": claudeCodeAgentRenderer,
};

interface Problem {
  readonly file: string;
  readonly messages: readonly string[];
}

/** Folders the renderers write into, scanned for generated files whose agent is gone. */
const OUTPUT_DIRS = [".github/agents", ".claude/skills"];

interface Plan {
  readonly files: readonly GeneratedFile[];
  /** Generated files on disk that no agent produces anymore (agent deleted or harness dropped). */
  readonly orphans: readonly string[];
  readonly problems: readonly Problem[];
}

async function loadAgents(root: string, dir: string) {
  const all = await readdir(join(root, dir)).catch(() => [] as string[]);
  const names = all.filter((f) => f.endsWith(".md") && f !== "README.md");
  const parsed = await Promise.all(
    names.map(async (file) => ({
      file,
      result: parseAgent(file, await readFile(join(root, dir, file), "utf8")),
    })),
  );
  const agents: { agent: Agent; source: string }[] = [];
  const problems: Problem[] = [];
  for (const { file, result } of parsed) {
    if (result.ok) agents.push({ agent: result.value, source: `${dir}/${file}` });
    else problems.push({ file: `${dir}/${file}`, messages: result.error });
  }
  return { agents, problems };
}

/** Generated files already on disk, recognised by their banner so hand-written files are never touched. */
async function generatedOnDisk(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const dir of OUTPUT_DIRS) {
    const entries = await readdir(join(root, dir), { recursive: true, withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries.filter((e) => e.isFile() && e.name.endsWith(".md"))) {
      const path = join(entry.parentPath, entry.name);
      const content = await readFile(path, "utf8");
      if (content.includes(GENERATED_MARKER)) found.push(relative(root, path).split(sep).join("/"));
    }
  }
  return found.sort();
}

/** A handoff to an agent the project does not have is dropped, so no tool offers a dead button. */
function withInstalledHandoff(agent: Agent, installed: ReadonlySet<string>): Agent {
  if (!agent.handoff || installed.has(agent.handoff)) return agent;
  const { handoff: _dropped, ...rest } = agent;
  return rest;
}

/** Reads the canonical agents and renders them for each harness, without writing anything. */
export async function planSync(
  root: string,
  dir: string,
  harnesses: readonly string[],
): Promise<Plan> {
  const unknown = harnesses.filter((h) => !(h in RENDERERS));
  const supported = `supported: ${Object.keys(RENDERERS).join(", ")}`;
  const harnessProblems = unknown.map((h) => ({
    file: "sync.harnesses",
    messages: [`unknown harness "${h}" (${supported})`],
  }));
  const { agents, problems } = await loadAgents(root, dir);
  const renderers = harnesses.flatMap((h) => RENDERERS[h] ?? []);
  const installed = new Set(agents.map(({ agent }) => agent.name));
  const files = agents.flatMap(({ agent, source }) =>
    renderers.flatMap((render) => render(withInstalledHandoff(agent, installed), source)),
  );
  const produced = new Set(files.map((f) => f.path));
  const orphans = (await generatedOnDisk(root)).filter((path) => !produced.has(path));
  return { files, orphans, problems: [...harnessProblems, ...problems] };
}

/** Writes every generated file, creating folders as needed, and removes the orphans. */
export async function writeSync(
  root: string,
  plan: Pick<Plan, "files" | "orphans">,
): Promise<void> {
  for (const file of plan.files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
  for (const orphan of plan.orphans) await rm(join(root, orphan));
}

/** Generated files whose content on disk differs from what `sync` would write, or that are missing. */
export async function staleFiles(root: string, files: readonly GeneratedFile[]): Promise<string[]> {
  const stale: string[] = [];
  for (const file of files) {
    const current = await readFile(join(root, file.path), "utf8").catch(() => undefined);
    if (current !== file.content) stale.push(file.path);
  }
  return stale;
}

function formatStale(stale: readonly string[]): string {
  if (stale.length === 0) return "Generated agent files are up to date.";
  const lines = stale.map((path) => `  ✗ ${path}`);
  return ["Out of date. Run `aidt sync` and commit the result:", ...lines].join("\n");
}

function formatSync(plan: Plan): string {
  const problems = plan.problems.flatMap((p) => p.messages.map((m) => `  ✗ ${p.file}: ${m}`));
  const written = plan.files.map((f) => `    ${f.path}`);
  if (problems.length > 0) return ["Nothing written. Fix these first:", ...problems].join("\n");
  const lines = [`Generated ${plan.files.length} file(s):`, ...written];
  if (plan.orphans.length > 0) {
    lines.push(
      `Removed ${plan.orphans.length} file(s) whose agent is gone:`,
      ...plan.orphans.map((p) => `    ${p}`),
    );
  }
  return lines.join("\n");
}

/** `aidt sync`: renders the agents, or with `--check` lists generated files out of date. */
export async function syncCommand({ root, config, flags }: CliContext): Promise<number> {
  const plan = await planSync(root, flags.from ?? config.sync.agents, config.sync.harnesses);
  if (plan.problems.length > 0) {
    print(formatSync(plan));
    return 1;
  }
  if (flags.check) {
    const stale = [...(await staleFiles(root, plan.files)), ...plan.orphans];
    print(formatStale(stale));
    return stale.length > 0 ? 1 : 0;
  }
  await writeSync(root, plan);
  return print(formatSync(plan));
}
