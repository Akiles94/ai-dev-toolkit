import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type CliContext, print } from "../shared/cli/cli-context.ts";
import { type Agent, parseAgent } from "./agent.ts";
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

interface Plan {
  readonly files: readonly GeneratedFile[];
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
  const files = agents.flatMap(({ agent, source }) =>
    renderers.flatMap((render) => render(agent, source)),
  );
  return { files, problems: [...harnessProblems, ...problems] };
}

/** Writes every generated file, creating folders as needed. */
export async function writeSync(root: string, files: readonly GeneratedFile[]): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(join(root, file.path)), { recursive: true });
    await writeFile(join(root, file.path), file.content);
  }
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
  return [`Generated ${plan.files.length} file(s):`, ...written].join("\n");
}

/** `aidt sync`: renders the agents, or with `--check` lists generated files out of date. */
export async function syncCommand({ root, config, flags }: CliContext): Promise<number> {
  const plan = await planSync(root, flags.from ?? config.sync.agents, config.sync.harnesses);
  if (plan.problems.length > 0) {
    print(formatSync(plan));
    return 1;
  }
  if (flags.check) {
    const stale = await staleFiles(root, plan.files);
    print(formatStale(stale));
    return stale.length > 0 ? 1 : 0;
  }
  await writeSync(root, plan.files);
  return print(formatSync(plan));
}
