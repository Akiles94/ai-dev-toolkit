import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startApp, stopApp } from "./demo-app.ts";

const POSIX = process.platform !== "win32";
const serverOn = (port: number) =>
  `require('http').createServer((q, s) => s.end('ok')).listen(${port})`;

/** A port nobody listens on, for an app the test starts itself. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  return typeof address === "object" && address ? address.port : 0;
}

const node = (code: string) => `"${process.execPath}" -e "${code}"`;
const answers = (url: string) =>
  fetch(url).then(
    () => true,
    () => false,
  );

describe("startApp", () => {
  it("starts nothing without a command", async () => {
    expect(await startApp(tmpdir(), undefined, "http://127.0.0.1:9")).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("fails at once, with its error output, when the command exits before the app answers", async () => {
    const began = Date.now();
    const started = await startApp(
      tmpdir(),
      node("console.error('Cannot find module x'); process.exit(3)"),
      "http://127.0.0.1:9",
    );
    expect(!started.ok && started.error).toContain("exited (3)");
    expect(!started.ok && started.error).toContain("Cannot find module x");
    expect(Date.now() - began).toBeLessThan(10_000);
  });

  it.skipIf(process.platform === "win32")(
    "waits for an app left in the background, and stopApp still stops it",
    async () => {
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      const server = `require('http').createServer((q, s) => s.end('ok')).listen(${port})`;
      const started = await startApp(tmpdir(), `(sleep 1; ${node(server)}) &`, url);
      expect(started.ok).toBe(true);
      stopApp(started.ok ? started.value : undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await answers(url)).toBe(false);
    },
  );

  it.skipIf(!POSIX)(
    "stops what a failing start left in the background, and fails at once",
    async () => {
      const [left, wanted] = [await freePort(), await freePort()];
      const command = `${node(serverOn(left))} & sleep 1; exit 1`;
      const started = await startApp(tmpdir(), command, `http://127.0.0.1:${wanted}`);
      expect(!started.ok && started.error).toContain("exited (1)");
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await answers(`http://127.0.0.1:${left}`)).toBe(false);
    },
  );

  it.skipIf(!POSIX)("fails at once when the start is killed by a signal", async () => {
    const began = Date.now();
    const command = `exec ${node("process.kill(process.pid, 'SIGKILL')")}`;
    const started = await startApp(tmpdir(), command, "http://127.0.0.1:9");
    expect(!started.ok && started.error).toContain("exited (SIGKILL)");
    expect(Date.now() - began).toBeLessThan(10_000);
  });

  it.skipIf(!POSIX)("never keeps the CLI alive, whether the start works or fails", async () => {
    const ports = await Promise.all([1, 2, 3, 4, 5, 6].map(() => freePort()));
    const [bg, bgFailing, bgWanted, detached, detachedFailing, detachedWanted] = ports as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const app = new URL("./demo-app.ts", import.meta.url).href;
    // An app handed to a new session keeps the error pipe: only unref and destroy free the CLI.
    const spawner = join(mkdtempSync(join(tmpdir(), "aidt-detach-")), "detach.cjs");
    writeFileSync(
      spawner,
      `const [port, code] = process.argv.slice(2);
       require("child_process").spawn(process.execPath, ["-e",
         "require('http').createServer((q, s) => s.end('ok')).listen(" + port + "); setTimeout(() => process.exit(), 5000)"],
         { detached: true, stdio: ["ignore", "ignore", "inherit"] }).unref();
       if (code) setTimeout(() => process.exit(Number(code)), 300);`,
    );
    const run = (command: string, wanted: number) => {
      const began = Date.now();
      const { status } = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { startApp, stopApp } from ${JSON.stringify(app)};
           const started = await startApp(process.cwd(), ${JSON.stringify(command)}, "http://127.0.0.1:${wanted}");
           if (started.ok) stopApp(started.value);`,
        ],
        { cwd: tmpdir(), timeout: 15_000 },
      );
      return { status, ms: Date.now() - began };
    };
    const spawn = (port = 0, code = "") => `"${process.execPath}" "${spawner}" ${port} ${code}`;
    expect(run(`${node(serverOn(bg))} &`, bg).status).toBe(0);
    expect(run(`${node(serverOn(bgFailing))} & sleep 1; exit 1`, bgWanted).status).toBe(0);
    const works = run(spawn(detached), detached);
    expect(works.status).toBe(0);
    expect(works.ms).toBeLessThan(4000);
    const fails = run(spawn(detachedFailing, "1"), detachedWanted);
    expect(fails.status).toBe(0);
    expect(fails.ms).toBeLessThan(4000);
  });

  it("hands out the process as soon as it exists, so an interrupted wait can stop it", async () => {
    let spawned = 0;
    await startApp(tmpdir(), node("process.exit(1)"), "http://127.0.0.1:9", () => spawned++);
    expect(spawned).toBe(1);
  });

  it("waits for the app to answer, and stopApp stops it", async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const server = `require('http').createServer((q, s) => s.end('ok')).listen(${port})`;
    const started = await startApp(tmpdir(), node(server), url);
    expect(started.ok && started.value?.pid).toBeTruthy();
    expect(await answers(url)).toBe(true);
    stopApp(started.ok ? started.value : undefined);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await answers(url)).toBe(false);
  });
});
