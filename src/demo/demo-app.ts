import { type ChildProcess, spawn } from "node:child_process";
import { fail, ok, type Result } from "../shared/result/result.ts";

/** Whether the product answers at `url`, whatever the status. */
const answers = (url: string): Promise<boolean> =>
  fetch(url).then(
    () => true,
    () => false,
  );

/** The last lines a process wrote to its error output, enough to say why it stopped. */
const tail = (text: string): string => text.trim().split("\n").slice(-20).join("\n");

/**
 * Starts the product with `command` (from `demo.start` in the config, which an agent cannot
 * change) and waits until `url` answers, 60 s at most. Nothing is started when it already answers.
 *
 * - A command that fails (exits with an error) fails at once, with its error output.
 * - A command that exits cleanly may have left the app in the background (`docker compose up -d`,
 *   `node server.js &`): the wait goes on, and the app is still stopped with its process group.
 * - `onSpawn` receives the process as soon as it exists, so an interrupted wait can stop it too.
 */
export async function startApp(
  root: string,
  command: string | undefined,
  url: string,
  onSpawn: (child: ChildProcess) => void = () => {},
): Promise<Result<ChildProcess | undefined, string>> {
  if (!command || (await answers(url))) return ok(undefined);
  const child = spawn(command, {
    cwd: root,
    shell: true,
    stdio: ["ignore", "ignore", "pipe"],
    detached: process.platform !== "win32",
  });
  onSpawn(child);
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = (stderr + String(chunk)).slice(-8000);
  });
  let failedWith: number | undefined;
  child.on("exit", (code) => {
    if (code) failedWith = code;
  });
  for (let waited = 0; waited < 60_000; waited += 250) {
    if (failedWith !== undefined) {
      return fail(`\`${command}\` exited (${failedWith}) before ${url} answered:\n${tail(stderr)}`);
    }
    if (await answers(url)) {
      // An app left in the background keeps the error pipe open: it must not keep the CLI alive.
      (child.stderr as { unref?: () => void } | null)?.unref?.();
      child.unref();
      return ok(child);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopApp(child);
  return fail(`${url} did not answer within 60 s after \`${command}\`:\n${tail(stderr)}`);
}

/**
 * Stops the product and everything it started: its process group (which outlives a shell that
 * put the app in the background), or its process tree on Windows.
 */
export function stopApp(child: ChildProcess | undefined): void {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else process.kill(-child.pid);
  } catch {
    // Already gone.
  }
}
