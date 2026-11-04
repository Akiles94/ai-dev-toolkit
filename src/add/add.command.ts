import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fail, ok, type Result } from "../shared/result.ts";

/** Shipped next to the CLI, both from `src/` and from the built `dist/`. */
const PRODUCTS_DIR = fileURLToPath(new URL("../../products/", import.meta.url));

/** What each product copies into the project, as folders under `.aidt/`. */
const PRODUCTS: Record<string, readonly string[]> = {
  workflow: ["agents", "templates", "practices"],
};

const CONFIG_FILE = ".aidt/config.json";

/** Starting config: the values a team usually changes first, all with their defaults. */
const STARTER_CONFIG = `${JSON.stringify(
  {
    limits: { sectionLines: 300 },
    guide: { marker: "@guide" },
    sync: { agents: ".aidt/agents", harnesses: ["copilot", "claude-code"] },
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

/** Lists what `add` would copy and what it would keep, without touching anything. */
export async function planAdd(root: string, product: string): Promise<Result<AddPlan, string>> {
  const folders = PRODUCTS[product];
  if (!folders)
    return fail(`Unknown product "${product}". Available: ${Object.keys(PRODUCTS).join(", ")}.`);
  const copies: Copy[] = [];
  const kept: string[] = [];
  for (const folder of folders) {
    for (const name of await readdir(join(PRODUCTS_DIR, product, folder))) {
      const target = `.aidt/${folder}/${name}`;
      if (await exists(join(root, target))) kept.push(target);
      else copies.push({ source: join(PRODUCTS_DIR, product, folder, name), target });
    }
  }
  return ok({ copies, kept, createConfig: !(await exists(join(root, CONFIG_FILE))) });
}

/** Copies the missing files and creates the config when the project has none. */
export async function applyAdd(root: string, plan: AddPlan): Promise<void> {
  for (const { source, target } of plan.copies) {
    await mkdir(dirname(join(root, target)), { recursive: true });
    await copyFile(source, join(root, target));
  }
  if (plan.createConfig) await writeFile(join(root, CONFIG_FILE), STARTER_CONFIG);
}

export function formatAdd(plan: AddPlan): string {
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
