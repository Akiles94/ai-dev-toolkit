import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type CliContext, print, UsageError } from "../shared/cli/cli-context.ts";
import { fail, ok, type Result } from "../shared/result/result.ts";

/** Shipped next to the CLI, both from `src/` and from the built `dist/`. */
const PRODUCTS_DIR = fileURLToPath(new URL("../../products/", import.meta.url));

/** What each product copies into the project, as folders under `.aidt/`. */
const PRODUCTS: Record<string, readonly string[]> = {
  workflow: ["agents", "templates", "practices"],
  structure: ["agents", "structure", "templates"],
};

const CONFIG_FILE = ".aidt/config.json";

/** Starting config: the values a team usually changes first, all with their defaults. */
const STARTER_CONFIG = `${JSON.stringify(
  {
    limits: { sectionLines: 300 },
    guide: { marker: "@guide" },
    sync: { agents: ".aidt/agents", harnesses: ["copilot", "claude-code"] },
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
  /** Files the project already has: they belong to the project now and are never overwritten. */
  readonly kept: readonly string[];
  readonly createConfig: boolean;
}

const exists = (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

/** Every file under `dir`, as `/`-separated paths relative to it, subfolders included. */
async function filesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split(sep).join("/"))
    .sort();
}

/** Lists what `add` would copy and what it would keep, without touching anything. */
async function planAdd(root: string, product: string): Promise<Result<AddPlan, string>> {
  const folders = PRODUCTS[product];
  if (!folders)
    return fail(`Unknown product "${product}". Available: ${Object.keys(PRODUCTS).join(", ")}.`);
  const copies: Copy[] = [];
  const kept: string[] = [];
  for (const folder of folders) {
    for (const name of await filesIn(join(PRODUCTS_DIR, product, folder))) {
      const target = `.aidt/${folder}/${name}`;
      if (await exists(join(root, target))) kept.push(target);
      else copies.push({ source: join(PRODUCTS_DIR, product, folder, name), target });
    }
  }
  return ok({ copies, kept, createConfig: !(await exists(join(root, CONFIG_FILE))) });
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
  return lines.join("\n");
}

/** `aidt add <product>`: copies the product's files the project does not have yet. */
export async function addCommand(
  { root }: CliContext,
  product: string | undefined,
): Promise<number> {
  if (!product) throw new UsageError("Name the product to add, e.g. aidt add workflow.");
  const plan = await planAdd(root, product);
  if (!plan.ok) throw new UsageError(plan.error);
  await applyAdd(root, plan.value);
  return print(formatAdd(plan.value));
}
