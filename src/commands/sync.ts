import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { copilot } from "../adapters/copilot.ts";
import type { Adapter, GeneratedFile } from "../adapters/shared.ts";
import { type Agent, parseAgent } from "../core/agent.ts";

/** Supported AI tools, by the name used in `sync.harnesses`. */
const ADAPTERS: Record<string, Adapter> = { copilot };

interface Problem {
  readonly file: string;
  readonly messages: readonly string[];
}

interface Plan {
  readonly files: readonly GeneratedFile[];
  readonly problems: readonly Problem[];
}

async function loadAgents(root: string, dir: string) {
  const names = (await readdir(join(root, dir))).filter(
    (f) => f.endsWith(".md") && f !== "README.md",
  );
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
  const unknown = harnesses.filter((h) => !(h in ADAPTERS));
  const supported = `supported: ${Object.keys(ADAPTERS).join(", ")}`;
  const harnessProblems = unknown.map((h) => ({
    file: "sync.harnesses",
    messages: [`unknown harness "${h}" (${supported})`],
  }));
  const { agents, problems } = await loadAgents(root, dir);
  const adapters = harnesses.flatMap((h) => ADAPTERS[h] ?? []);
  const files = agents.flatMap(({ agent, source }) =>
    adapters.flatMap((render) => render(agent, source)),
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

export function formatSync(plan: Plan): string {
  const problems = plan.problems.flatMap((p) => p.messages.map((m) => `  ✗ ${p.file}: ${m}`));
  const written = plan.files.map((f) => `    ${f.path}`);
  if (problems.length > 0) return ["Nothing written. Fix these first:", ...problems].join("\n");
  return [`Generated ${plan.files.length} file(s):`, ...written].join("\n");
}
