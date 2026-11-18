import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { startApp, stopApp } from "./demo-app.ts";

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
