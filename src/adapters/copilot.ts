import type { Agent, Capability } from "../core/agent.ts";
import { type Adapter, generatedBanner, limitsSection, markdown, yamlString } from "./shared.ts";

/**
 * VS Code tool names per capability. Copilot cannot scope writes or commands, so `write` maps to
 * the edit tools and the limits travel as instructions (see `limitsSection`).
 */
const TOOLS: Record<Capability, string[]> = {
  read: ["read", "search"],
  ask: ["vscode/askQuestions"],
  write: ["edit"],
  edit: ["edit"],
  shell: ["execute/runInTerminal", "execute/getTerminalOutput"],
};

function tools(agent: Agent): string {
  const names = [...new Set(agent.capabilities.flatMap((c) => TOOLS[c]))];
  return `[${names.map(yamlString).join(", ")}]`;
}

/** A button shown after the agent answers; `send: false` lets the user read before going on. */
function handoff(next: string): string[] {
  return [
    "handoffs:",
    `  - label: ${yamlString(`Continue with ${next}`)}`,
    `    agent: ${next}`,
    `    prompt: ${yamlString("The previous step is approved. Continue the task from its state.json.")}`,
    "    send: false",
  ];
}

/** Custom agent for GitHub Copilot in VS Code: `.github/agents/<name>.agent.md`. */
export const copilot: Adapter = (agent, source) => {
  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: ${yamlString(agent.description)}`,
    `tools: ${tools(agent)}`,
    ...(agent.handoff ? handoff(agent.handoff) : []),
    "---",
  ].join("\n");
  const content = markdown(
    frontmatter,
    generatedBanner(source),
    limitsSection(agent),
    agent.instructions,
  );
  return [{ path: `.github/agents/${agent.name}.agent.md`, content }];
};
