import { describe, expect, it } from "vitest";
import type { CommandRunner } from "./command-runner.port.ts";
import type { StackEntry } from "./stack-plan.ts";
import { hostOf, publishStack } from "./stack-publisher.ts";

const ENTRIES: StackEntry[] = [
  { id: "S1", branch: "t-s01", base: "main", commit: "a", title: "S1 title", body: "S1 guide" },
  { id: "S2", branch: "t-s02", base: "t-s01", commit: "b", title: "S2 title", body: "S2 guide" },
];

/** Records every call; `answers` maps "command firstArg secondArg" to stdout, or an Error. */
function fakeRunner(answers: Record<string, string | Error> = {}) {
  const calls: string[] = [];
  const run: CommandRunner = async (command, args) => {
    const call = [command, ...args].join(" ");
    calls.push(call);
    const key = Object.keys(answers).find((k) => call.startsWith(k));
    const answer = key === undefined ? "" : answers[key];
    if (answer instanceof Error) throw answer;
    return answer ?? "";
  };
  return { run, calls };
}

describe("hostOf", () => {
  it("reads the host from SSH and HTTPS remotes", () => {
    expect(hostOf("git@github.com:o/r.git")).toBe("github");
    expect(hostOf("https://github.com/o/r")).toBe("github");
    expect(hostOf("https://gitlab.example.com/o/r.git")).toBe("gitlab");
    expect(hostOf("ssh://git@bitbucket.org/o/r.git")).toBe("other");
  });
});

describe("publishStack on GitHub", () => {
  it("pushes, opens chained draft PRs and links them with gh stack", async () => {
    const { run, calls } = fakeRunner({
      "gh pr create --draft --base main": "https://github.com/o/r/pull/1\n",
      "gh pr create --draft --base t-s01": "https://github.com/o/r/pull/2\n",
    });
    const published = await publishStack(run, "github", "origin", ENTRIES);

    expect(published.tool).toBe("gh-stack");
    expect([...published.prs]).toEqual([
      ["S1", "https://github.com/o/r/pull/1"],
      ["S2", "https://github.com/o/r/pull/2"],
    ]);
    expect(calls).toContain("git push --force-with-lease -u origin t-s01 t-s02");
    expect(calls).toContain(
      "gh pr create --draft --base t-s01 --head t-s02 --title S2 title --body S2 guide",
    );
    expect(calls.at(-1)).toBe("gh stack link --base main t-s01 t-s02");
  });

  it("reuses open PRs and says so when gh stack is missing", async () => {
    const { run, calls } = fakeRunner({
      "gh pr list --head t-s01": "https://github.com/o/r/pull/7\n",
      "gh stack": new Error("unknown command"),
    });
    const published = await publishStack(run, "github", "origin", ENTRIES);

    expect(published.tool).toBe("gh");
    expect(published.prs.get("S1")).toBe("https://github.com/o/r/pull/7");
    expect(calls.filter((c) => c.startsWith("gh pr create"))).toHaveLength(1);
    expect(published.notes[0]).toContain("gh stack is not available");
  });

  it("falls back to pushing only when gh is not installed", async () => {
    const { run, calls } = fakeRunner({ gh: new Error("not found") });
    const published = await publishStack(run, "github", "origin", ENTRIES);

    expect(published.tool).toBe("git");
    expect(calls.at(-1)).toBe("git push --force-with-lease -u origin t-s01 t-s02");
    expect(published.notes).toEqual([
      "gh is not installed: pushed only.",
      'Open a draft PR: t-s01 → main ("S1 title")',
      'Open a draft PR: t-s02 → t-s01 ("S2 title")',
    ]);
  });
});

describe("publishStack on GitLab", () => {
  it("opens chained draft MRs, reusing open ones", async () => {
    const { run, calls } = fakeRunner({
      "glab mr list --source-branch t-s01":
        '[{"web_url":"https://gitlab.com/o/r/-/merge_requests/3"}]',
      "glab mr create": "Creating draft merge request\nhttps://gitlab.com/o/r/-/merge_requests/4\n",
    });
    const published = await publishStack(run, "gitlab", "origin", ENTRIES);

    expect(published.tool).toBe("glab");
    expect([...published.prs.values()]).toEqual([
      "https://gitlab.com/o/r/-/merge_requests/3",
      "https://gitlab.com/o/r/-/merge_requests/4",
    ]);
    expect(calls).toContain(
      "glab mr create --draft --yes --source-branch t-s02 --target-branch t-s01 --title S2 title --description S2 guide",
    );
  });
});
