import type { DiffSource } from "../changes/changes.ts";
import type { AidtConfig } from "../config/config.ts";
import { defaultBranch } from "../git/git.ts";

/** Every command-line option, already parsed. Each command reads only the ones it uses. */
export interface Flags {
  base?: string | undefined;
  head?: string | undefined;
  staged?: boolean | undefined;
  worktree?: boolean | undefined;
  files?: boolean | undefined;
  json?: boolean | undefined;
  check?: boolean | undefined;
  from?: string | undefined;
  "dry-run"?: boolean | undefined;
}

/** What every command receives: where the repository is, its config and the options given. */
export interface CliContext {
  readonly root: string;
  readonly config: AidtConfig;
  readonly flags: Flags;
}

/** A mistake in how the command was called; the CLI shows its message and exits with 2. */
export class UsageError extends Error {}

/** Writes a line to standard output; returns the success exit code to end a command with it. */
export function print(text: string): number {
  process.stdout.write(`${text}\n`);
  return 0;
}

/** The changes a command works on, from `--base/--head`, `--staged` or `--worktree`. */
export async function resolveSource(root: string, flags: Flags): Promise<DiffSource> {
  if (flags.staged && flags.worktree) throw new UsageError("Use either --staged or --worktree.");
  if (flags.staged) return { kind: "staged" };
  if (flags.worktree) return { kind: "worktree" };
  const base = flags.base ?? (await defaultBranch(root));
  return { kind: "range", base, head: flags.head ?? "HEAD" };
}
