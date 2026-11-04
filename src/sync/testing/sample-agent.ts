import { type Agent, parseAgent } from "../agent.ts";

/** A small valid agent used by the sync tests. */
export const REFINER = `---
name: refiner
description: Turns a ticket into a business spec before any code.
tier: balanced
capabilities: [read, ask, write, shell]
writes:
  - .aidt/tasks/*/spec.md
commands:
  - git branch
handoff: planner
---
Ask business questions only.
`;

export function parsed(file: string, markdown: string): Agent {
  const result = parseAgent(file, markdown);
  if (!result.ok) throw new Error(result.error.join("; "));
  return result.value;
}
