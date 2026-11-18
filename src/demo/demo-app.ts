import { type ChildProcess, spawn } from "node:child_process";
import { fail, ok, type Result } from "../shared/result/result.ts";

/** Whether the product answers at `url`, whatever the status. */
const answers = (url: string): Promise<boolean> =>
  fetch(url).then(
    () => true,
    () => false,
  );

/** The last lines a process wrote to its error output, to say why it stopped. */
const tail = (text: string): string => text.trim().split("\n").slice(-5).join("\n");

/**
 * Starts the product with `command` (from `demo.start` in the config, which an agent cannot
 * change) and waits until `url` answers, 60 s at most. Nothing is started when it already answers.
 * A command that exits first fails at once, with what it wrote to its error output.
 */
export async function startApp(
  root: string,
  command: string | undefined,
  url: string,
): Promise<Result<ChildProcess | undefined, string>> {
  if (!command || (await answers(url))) return ok(undefined);
  const child = spawn(command, {
    cwd: root,
    shell: true,
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-4000);
  });
  let exited: number | null | undefined;
  child.on("exit", (code) => {
    exited = code;
  });
  for (let waited = 0; waited < 60_000; waited += 250) {
    if (exited !== undefined) {
      return fail(
        `\`${command}\` exited (${exited ?? "signal"}) before ${url} answered:\n${tail(stderr)}`,
      );
    }
    if (await answers(url)) return ok(child);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopApp(child);
  return fail(`${url} did not answer within 60 s after \`${command}\`.`);
}

/** Stops the product and everything it started: its process group, or its tree on Windows. */
export function stopApp(child: ChildProcess | undefined): void {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else process.kill(-child.pid);
  } catch {
    // Already gone.
  }
}
