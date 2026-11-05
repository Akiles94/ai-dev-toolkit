import type { Agent, Tier } from "./agent.ts";
import { generatedBanner, limitsSection, markdown, yamlString } from "./agent-markdown.ts";
import type { AgentRenderer } from "./agent-renderer.port.ts";

const MODELS: Record<Tier, string> = { efficient: "haiku", balanced: "sonnet", max: "opus" };

/**
 * Permission rules the skill pre-approves. Anything else still asks the user, which keeps the
 * write and command limits in force even though skills cannot forbid tools outright.
 */
export function allowedTools(agent: Agent): string[] {
  const has = (capability: Agent["capabilities"][number]) =>
    agent.capabilities.includes(capability);
  return [
    ...(has("read") ? ["Read", "Grep", "Glob"] : []),
    ...(has("ask") ? ["AskUserQuestion"] : []),
    ...(has("edit") ? ["Edit", "Write"] : agent.writes.map((glob) => `Edit(${glob})`)),
    ...agent.commands.map((command) => `Bash(${command} *)`),
  ];
}

/** In a forked context the agent cannot talk to the user: the main conversation asks for approval. */
const FRESH_CONTEXT_NOTE = [
  "## Running in a fresh context",
  "",
  "You run without the conversation that produced this work. Do everything up to the approval",
  "step, then end with that summary: the main conversation shows it and asks the user.",
].join("\n");

const handoffNote = (next: string) =>
  `When the user approves, suggest continuing with \`/${next}\`. Never start it yourself.`;

/** Claude Code skill, invoked as `/<name>`: `.claude/skills/<name>/SKILL.md`. */
export const claudeCodeAgentRenderer: AgentRenderer = (agent, source) => {
  const fresh = agent.context === "fresh";
  const frontmatter = [
    "---",
    `name: ${agent.name}`,
    `description: ${yamlString(agent.description)}`,
    // Workflow steps run when the user asks, never because the model thinks they apply.
    "disable-model-invocation: true",
    `model: ${MODELS[agent.tier]}`,
    "allowed-tools:",
    ...allowedTools(agent).map((rule) => `  - ${yamlString(rule)}`),
    ...(fresh ? ["context: fork", "agent: general-purpose", "background: false"] : []),
    "---",
  ].join("\n");
  const content = markdown(
    frontmatter,
    generatedBanner(source),
    limitsSection(agent),
    fresh ? FRESH_CONTEXT_NOTE : "",
    agent.instructions,
    agent.handoff ? handoffNote(agent.handoff) : "",
  );
  return [{ path: `.claude/skills/${agent.name}/SKILL.md`, content }];
};
