import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type CliContext, print, UsageError } from "../shared/cli/cli-context.ts";
import { fail, ok, type Result } from "../shared/result/result.ts";

/** Shipped next to the CLI, both from `src/` and from the built `dist/`. */
const PRODUCTS_DIR = fileURLToPath(new URL("../../products/", import.meta.url));

/** Something `add` installs: files or folders of one product, copied to the same path under `.aidt/`. */
interface Installable {
  readonly product: string;
  readonly paths: readonly string[];
  /** Files it shares with another product, taken from there so they exist once. */
  readonly shared?: readonly { readonly product: string; readonly path: string }[];
  /** What the user does next, when copying the files is not enough. */
  readonly next?: string;
}

const AGENT_FORMAT = "agents/README.md";
const STATE_SCHEMA = "templates/state.schema.json";

/** Whole products, plus the workflow agents that also work alone, with only the files they read. */
const INSTALLABLES: Record<string, Installable> = {
  workflow: { product: "workflow", paths: ["agents", "templates", "practices"] },
  structure: { product: "structure", paths: ["agents", "structure", "templates"] },
  context: {
    product: "context",
    paths: ["practices", "templates"],
    next: [
      "Next: create .aidt/status.md from .aidt/templates/status.md, point your rules file",
      "(AGENTS.md or CLAUDE.md) to it and to .aidt/practices/session-context.md, then run",
      "aidt context check.",
    ].join("\n"),
  },
  refiner: {
    product: "workflow",
    paths: [AGENT_FORMAT, "agents/refiner.md", "templates/spec.md", STATE_SCHEMA],
  },
  reviewer: {
    product: "workflow",
    paths: [
      AGENT_FORMAT,
      "agents/reviewer.md",
      "templates/review-section.md",
      "templates/review-index.md",
      STATE_SCHEMA,
      "practices",
    ],
  },
  walkthrough: {
    product: "workflow",
    paths: [AGENT_FORMAT, "agents/walkthrough.md", "practices"],
  },
  demo: {
    product: "demo",
    paths: ["agents", "templates"],
    next: [
      "Next: set demo.start in .aidt/config.json to the command that starts your app in the",
      "foreground or with & (it is kept out of the scripts the agent writes; one that hands the",
      "app to a daemon leaves it running), then ask for a demo with /demo (Claude Code)",
      "or the demo agent (Copilot). The first render lists any tool to install: Playwright,",
      "ffmpeg and an offline voice (Piper). Videos stay out of git; their scripts are committed.",
    ].join("\n"),
  },
  qa: {
    product: "qa",
    paths: ["agents", "templates"],
    shared: [{ product: "demo", path: "templates/app.md" }],
    next: [
      "Next: ask for a QA pass with /qa (Claude Code) or the qa agent (Copilot), naming the mode",
      "(block, flow or audit) and the branch. It proposes the scope and its cost first, and drafts",
      ".aidt/app.md if the project has none. Walks need Playwright (the first one says how to",
      "install it) and the app running; screenshots stay out of git, walks are committed.",
    ].join("\n"),
  },
};

const CONFIG_FILE = ".aidt/config.json";

/** Starting config: the values a team usually changes first, all with their defaults. */
const STARTER_CONFIG = `${JSON.stringify(
  {
    limits: { sectionLines: 300 },
    guide: { marker: "@guide" },
    sync: { agents: ".aidt/agents", harnesses: ["copilot", "claude-code"] },
    models: {
      agents: {},
      "claude-code": { efficient: "haiku", balanced: "sonnet", max: "opus" },
      copilot: {},
    },
    workflow: { control: "strict" },
  },
  null,
  2,
)}\n`;

interface Copy {
  readonly source: string;
  readonly target: string;
}

interface AddPlan {
  readonly copies: readonly Copy[];
  readonly next?: string | undefined;
  /** Files the project already has: they belong to the project now and are never overwritten. */
  readonly kept: readonly string[];
  readonly createConfig: boolean;
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** The files under `path` of a product (or `path` itself), `/`-separated and relative to the product. */
async function filesAt(productDir: string, path: string): Promise<string[]> {
  const full = join(productDir, path);
  if ((await stat(full)).isFile()) return [path];
  const entries = await readdir(full, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(productDir, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort();
}

/** Lists what `add` would copy and what it would keep, without touching anything. */
async function planAdd(root: string, name: string): Promise<Result<AddPlan, string>> {
  const installable = INSTALLABLES[name];
  if (!installable) {
    const available = Object.keys(INSTALLABLES).join(", ");
    return fail(`Unknown product or agent "${name}". Available: ${available}.`);
  }
  const sources = [
    ...installable.paths.map((path) => ({ product: installable.product, path })),
    ...(installable.shared ?? []),
  ];
  const copies: Copy[] = [];
  const kept: string[] = [];
  for (const { product, path } of sources) {
    const productDir = join(PRODUCTS_DIR, product);
    for (const file of await filesAt(productDir, path)) {
      const target = `.aidt/${file}`;
      if (await exists(join(root, target))) kept.push(target);
      else copies.push({ source: join(productDir, file), target });
    }
  }
  const createConfig = !(await exists(join(root, CONFIG_FILE)));
  return ok({ copies, kept, createConfig, next: installable.next });
}

/** Copies the missing files and creates the config when the project has none. */
async function applyAdd(root: string, plan: AddPlan): Promise<void> {
  for (const { source, target } of plan.copies) {
    await mkdir(dirname(join(root, target)), { recursive: true });
    await copyFile(source, join(root, target));
  }
  if (plan.createConfig) await writeFile(join(root, CONFIG_FILE), STARTER_CONFIG);
}

function formatAdd(plan: AddPlan): string {
  const lines = [`Added ${plan.copies.length} file(s) to .aidt/`];
  if (plan.createConfig) lines.push(`Created ${CONFIG_FILE}`);
  if (plan.kept.length > 0) {
    lines.push(
      `Kept ${plan.kept.length} existing file(s) unchanged:`,
      ...plan.kept.map((p) => `    ${p}`),
    );
  }
  if (plan.next) lines.push(plan.next);
  return lines.join("\n");
}

/** `aidt add <product|agent>`: copies its files the project does not have yet. */
export async function addCommand({ root }: CliContext, name: string | undefined): Promise<number> {
  if (!name) throw new UsageError("Name what to add, e.g. aidt add workflow or aidt add reviewer.");
  const plan = await planAdd(root, name);
  if (!plan.ok) throw new UsageError(plan.error);
  await applyAdd(root, plan.value);
  return print(formatAdd(plan.value));
}
