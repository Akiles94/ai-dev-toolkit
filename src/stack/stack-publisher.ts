import type { CommandRunner } from "./command-runner.port.ts";
import type { StackEntry } from "./stack-plan.ts";

/** Where the code is hosted, from the remote URL. Decides which CLI opens the PRs. */
type Host = "github" | "gitlab" | "other";

/** How the stack was delivered, as recorded in `state.json` (`delivery.tool`). */
type DeliveryTool = "gh-stack" | "gh" | "glab" | "git";

/** What publishing left behind: the PR (or MR) of each section and anything worth telling. */
export interface Published {
  readonly tool: DeliveryTool;
  readonly prs: ReadonlyMap<string, string>;
  readonly notes: readonly string[];
}

/** `git@github.com:o/r.git` → github; `https://gitlab.example.com/…` → gitlab; else other. */
export function hostOf(remoteUrl: string): Host {
  const host = remoteUrl.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i)?.[1] ?? "";
  if (host === "github.com" || host.startsWith("github.")) return "github";
  if (host.includes("gitlab")) return "gitlab";
  return "other";
}

const succeeds = (run: CommandRunner, command: string, args: string[]): Promise<boolean> =>
  run(command, args).then(
    () => true,
    () => false,
  );

const lastUrl = (output: string): string =>
  output.match(/https?:\/\/\S+/g)?.at(-1) ?? output.trim();

/** Pushes every branch at once; `--force-with-lease` so a restacked branch updates safely. */
async function pushAll(run: CommandRunner, remote: string, entries: StackEntry[]): Promise<void> {
  await run("git", ["push", "--force-with-lease", "-u", remote, ...entries.map((e) => e.branch)]);
}

/** The open PR of a section's branch, or a new draft PR on the branch below it. */
async function gitHubPr(run: CommandRunner, e: StackEntry): Promise<string> {
  const list = ["pr", "list", "--head", e.branch, "--state", "open", "--json", "url"];
  const existing = (await run("gh", [...list, "--jq", ".[0].url // empty"])).trim();
  if (existing) return existing;
  const create = ["pr", "create", "--draft", "--base", e.base, "--head", e.branch];
  return lastUrl(await run("gh", [...create, "--title", e.title, "--body", e.body]));
}

/** The open MR of a section's branch, or a new draft MR on the branch below it. */
async function gitLabMr(run: CommandRunner, e: StackEntry): Promise<string> {
  const listed = await run("glab", ["mr", "list", "--source-branch", e.branch, "-F", "json"]);
  const existing = (JSON.parse(listed || "[]") as { web_url?: string }[])[0]?.web_url;
  if (existing) return existing;
  const create = ["mr", "create", "--draft", "--yes", "--source-branch", e.branch];
  const fields = ["--target-branch", e.base, "--title", e.title, "--description", e.body];
  return lastUrl(await run("glab", [...create, ...fields]));
}

/** One PR per section, in order, so each base exists before the PR on top of it. */
async function openAll(
  entries: StackEntry[],
  open: (e: StackEntry) => Promise<string>,
): Promise<Map<string, string>> {
  const prs = new Map<string, string>();
  for (const e of entries) prs.set(e.id, await open(e));
  return prs;
}

async function publishGitHub(run: CommandRunner, remote: string, entries: StackEntry[]) {
  await pushAll(run, remote, entries);
  const prs = await openAll(entries, (e) => gitHubPr(run, e));
  const trunk = entries[0]?.base as string;
  const linked = await succeeds(run, "gh", [
    "stack",
    "link",
    "--base",
    trunk,
    ...entries.map((e) => e.branch),
  ]);
  const notes = linked
    ? []
    : ["gh stack is not available: the PRs are chained by base branch, not linked as a stack."];
  return { tool: linked ? "gh-stack" : "gh", prs, notes } satisfies Published;
}

async function publishGitLab(run: CommandRunner, remote: string, entries: StackEntry[]) {
  await pushAll(run, remote, entries);
  const prs = await openAll(entries, (e) => gitLabMr(run, e));
  return { tool: "glab", prs, notes: [] } satisfies Published;
}

async function publishPlain(run: CommandRunner, remote: string, entries: StackEntry[]) {
  await pushAll(run, remote, entries);
  const notes = entries.map((e) => `Open a draft PR: ${e.branch} → ${e.base} ("${e.title}")`);
  return { tool: "git", prs: new Map(), notes } satisfies Published;
}

/**
 * Pushes the stack and opens one draft PR per section with the host's CLI. A missing CLI falls
 * back to pushing the branches and listing the PRs to open by hand: delivery never blocks.
 */
export async function publishStack(
  run: CommandRunner,
  host: Host,
  remote: string,
  entries: StackEntry[],
): Promise<Published> {
  if (host === "github" && (await succeeds(run, "gh", ["--version"]))) {
    return publishGitHub(run, remote, entries);
  }
  if (host === "gitlab" && (await succeeds(run, "glab", ["--version"]))) {
    return publishGitLab(run, remote, entries);
  }
  const published = await publishPlain(run, remote, entries);
  if (host === "other") return published;
  const cli = host === "github" ? "gh" : "glab";
  return { ...published, notes: [`${cli} is not installed: pushed only.`, ...published.notes] };
}
