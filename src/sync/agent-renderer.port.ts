import type { Agent } from "./agent.ts";

/** A file a renderer produces, relative to the repository root. */
export interface GeneratedFile {
  readonly path: string;
  readonly content: string;
}

/** Renders a canonical agent into the files one AI tool understands. */
export type AgentRenderer = (agent: Agent, source: string) => GeneratedFile[];
