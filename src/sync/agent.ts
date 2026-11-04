import { fail, ok, type Result } from "../shared/result/result.ts";

const TIERS = ["efficient", "balanced", "max"] as const;
const CAPABILITIES = ["read", "ask", "write", "edit", "shell"] as const;
const CONTEXTS = ["shared", "fresh"] as const;

/** How much model the agent needs; each tool adapter maps it to a concrete model. */
export type Tier = (typeof TIERS)[number];

/** What an agent may do; each tool adapter maps it to that tool's permissions. */
export type Capability = (typeof CAPABILITIES)[number];

/**
 * `shared`: runs in the user's conversation. `fresh`: runs without it, so it judges the work
 * without inheriting the reasoning that produced it (the reviewer).
 */
type AgentContext = (typeof CONTEXTS)[number];

/** An agent defined once, in the canonical format, and rendered to every AI tool by `aidt sync`. */
export interface Agent {
  readonly name: string;
  readonly description: string;
  readonly tier: Tier;
  readonly context: AgentContext;
  readonly capabilities: readonly Capability[];
  /** Files it may create or change (globs). Only with the `write` capability. */
  readonly writes: readonly string[];
  /** Command prefixes it may run. Only with the `shell` capability. */
  readonly commands: readonly string[];
  /** Next agent of the workflow, offered once the user approves. */
  readonly handoff?: string;
  readonly instructions: string;
}

type Fields = Record<string, string | string[]>;

/** `""` opens a block list, `[a, b]` is an inline list, anything else is a scalar. */
function parseValue(value: string): string | string[] {
  if (value === "") return [];
  if (!value.startsWith("[")) return value;
  return value
    .slice(1, -1)
    .split(",")
    .map((item) => item.trim());
}

/** Parses the frontmatter subset agents use: `key: value`, `key: [a, b]` and `- item` lists. */
function parseFields(frontmatter: string): Fields {
  const fields: Fields = {};
  let listKey: string | undefined;
  for (const line of frontmatter.split("\n")) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && listKey) {
      (fields[listKey] as string[]).push(item[1] ?? "");
      continue;
    }
    const [, key = "", value = ""] = /^(\w[\w-]*):\s*(.*)$/.exec(line) ?? [];
    if (!key) continue;
    fields[key] = parseValue(value);
    listKey = value === "" ? key : undefined;
  }
  return fields;
}

const text = (fields: Fields, key: string) =>
  typeof fields[key] === "string" ? (fields[key] as string) : "";
const list = (fields: Fields, key: string) =>
  Array.isArray(fields[key]) ? (fields[key] as string[]) : [];

function validate(fields: Fields, fileName: string): string[] {
  const errors: string[] = [];
  const name = text(fields, "name");
  const capabilities = list(fields, "capabilities");
  if (`${name}.md` !== fileName) errors.push(`name "${name}" must match the file name`);
  if (text(fields, "description").length < 20) errors.push("description is missing or too short");
  if (!(TIERS as readonly string[]).includes(text(fields, "tier"))) {
    errors.push(`tier must be one of ${TIERS.join(", ")}`);
  }
  for (const unknown of capabilities.filter(
    (c) => !(CAPABILITIES as readonly string[]).includes(c),
  )) {
    errors.push(`unknown capability "${unknown}"`);
  }
  const context = text(fields, "context");
  if (context && !(CONTEXTS as readonly string[]).includes(context)) {
    errors.push(`context must be one of ${CONTEXTS.join(", ")}`);
  }
  if (capabilities.includes("write") && list(fields, "writes").length === 0) {
    errors.push("the write capability needs a writes list");
  }
  if (capabilities.includes("shell") && list(fields, "commands").length === 0) {
    errors.push("the shell capability needs a commands list");
  }
  return errors;
}

/**
 * Reads a canonical agent file. Returns every problem found, not only the first, so the user can
 * fix them all at once.
 */
export function parseAgent(fileName: string, markdown: string): Result<Agent, string[]> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(markdown);
  if (!match) return fail(["missing frontmatter between --- lines"]);
  const fields = parseFields((match[1] ?? "").replace(/\r/g, ""));
  const errors = validate(fields, fileName);
  if (errors.length > 0) return fail(errors);
  const handoff = text(fields, "handoff");
  return ok({
    name: text(fields, "name"),
    description: text(fields, "description"),
    tier: text(fields, "tier") as Tier,
    context: (text(fields, "context") || "shared") as AgentContext,
    capabilities: list(fields, "capabilities") as Capability[],
    writes: list(fields, "writes"),
    commands: list(fields, "commands"),
    ...(handoff ? { handoff } : {}),
    instructions: (match[2] ?? "").trim(),
  });
}
