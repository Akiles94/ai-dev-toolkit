import type { Agent, Capability } from "./agent.ts";
import {
  generatedBanner,
  limitsSection,
  markdown,
  yamlModel,
  yamlString,
} from "./agent-markdown.ts";
import type { AgentRenderer } from "./agent-renderer.port.ts";

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

/**
 * Custom agent for GitHub Copilot in VS Code: `.github/agents/<name>.agent.md`. Without a
 * configured model it runs on the one selected in the chat.
 */
export const copilotAgentRenderer: AgentRenderer = (agent, source, model) => {
  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: ${yamlString(agent.description)}`,
    `tools: ${tools(agent)}`,
    ...(model ? [`model: ${yamlModel(model)}`] : []),
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
