import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { UsageError } from "../cli/cli-context.ts";
import type { Result } from "../result/result.ts";

/**
 * Reads a JSON file an agent wrote and checks it with `parse`; every problem is a usage error that
 * names the file, so the agent knows what to fix.
 */
export async function readJsonFile<T>(
  root: string,
  path: string,
  what: string,
  parse: (raw: unknown) => Result<T, string[]>,
): Promise<T> {
  const raw = await readFile(resolve(root, path), "utf8").catch(() => {
    throw new UsageError(`No ${what} at ${path}.`);
  });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`${path} is not valid JSON: ${(error as Error).message}`);
  }
  const parsed = parse(json);
  if (!parsed.ok)
    throw new UsageError(`${path} is not a valid ${what}:\n  ${parsed.error.join("\n  ")}`);
  return parsed.value;
}

/**
 * An output folder for files made again from what is committed (videos, screenshots). When this
 * creates it, it gets a `.gitignore` so they stay out of git; a folder that already existed is left
 * as it is (it may hold files that are committed).
 */
export async function prepareIgnoredFolder(
  root: string,
  folder: string,
  why: string,
): Promise<void> {
  const full = join(root, folder);
  const created = await mkdir(full, { recursive: true });
  if (created !== undefined) await writeFile(join(full, ".gitignore"), `# ${why}\n*\n`);
}
