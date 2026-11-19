import { createServer, request as httpRequest, type Server } from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { originPolicy } from "./qa-origins.ts";
import { proxiedLaunch, startProxy, type WalkProxy } from "./qa-proxy.ts";

// The proxy alone, with Node as its client: these run where no browser is installed.

let app: Server;
let appPort = 0;
let outside: Server;
let outsidePort = 0;
let outsideHits = 0;
let proxy: WalkProxy;

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
};

beforeAll(async () => {
  app = createServer((req, res) => {
    if (req.url === "/away")
      return res.writeHead(302, { location: `http://127.0.0.1:${outsidePort}/leak` }).end();
    res
      .writeHead(200)
      .end(`app ${req.method} ${req.url} via ${req.headers["proxy-connection"] ?? "-"}`);
  });
  outside = createServer((_, res) => {
    outsideHits++;
    res.end("outside");
  });
  appPort = await listen(app);
  outsidePort = await listen(outside);
  // Only the app's origin: the other port of this machine stands for a host the walk must not reach.
  proxy = await startProxy(originPolicy([`http://127.0.0.1:${appPort}`]));
});
afterAll(async () => {
  await proxy.close();
  app.close();
  outside.close();
});

/** A call through the proxy, as a browser makes it: the whole address in the request line. */
function viaProxy(url: string, method = "GET"): Promise<{ status: number; body: string }> {
  const { port } = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method, path: url, headers: { "proxy-connection": "keep-alive" } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** A tunnel asked of the proxy: the status line it answers with. */
function tunnel(target: string): Promise<string> {
  const { port } = new URL(proxy.url);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), "127.0.0.1", () =>
      socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`),
    );
    socket.once("data", (data) => {
      resolve(String(data).split("\r\n")[0] ?? "");
      socket.destroy();
    });
    socket.on("error", reject);
  });
}

describe("the walk's proxy", () => {
  it("lets calls to the app through, without the headers meant for the proxy", async () => {
    expect(await viaProxy(`http://127.0.0.1:${appPort}/cart`, "POST")).toEqual({
      status: 200,
      body: "app POST /cart via -",
    });
  });

  it("refuses anywhere else, logs it, and passes a redirect on for the browser to ask again", async () => {
    proxy.refused.splice(0);
    const away = await viaProxy(`http://127.0.0.1:${appPort}/away`);
    expect(away.status).toBe(302);
    const leak = await viaProxy(`http://127.0.0.1:${outsidePort}/leak`, "POST");
    expect(leak).toEqual({ status: 403, body: "blocked: outside qa.origins" });
    expect(proxy.refused).toEqual([
      { method: "POST", url: `http://127.0.0.1:${outsidePort}/leak` },
    ]);
    expect(outsideHits).toBe(0);
  });

  it("opens a tunnel to the app only", async () => {
    proxy.refused.splice(0);
    expect(await tunnel(`127.0.0.1:${appPort}`)).toBe("HTTP/1.1 200 Connection Established");
    expect(await tunnel(`127.0.0.1:${outsidePort}`)).toBe("HTTP/1.1 403 Forbidden");
    expect(proxy.refused).toEqual([{ method: "CONNECT", url: `127.0.0.1:${outsidePort}` }]);
  });

  it("refuses a socket asked for without a tunnel", async () => {
    const { port } = new URL(proxy.url);
    const answer = await new Promise<string>((resolve) => {
      const socket = connect(Number(port), "127.0.0.1", () =>
        socket.write(
          `GET http://127.0.0.1:${appPort}/ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
        ),
      );
      socket.once("data", (data) => resolve(String(data).split("\r\n")[0] ?? ""));
    });
    expect(answer).toBe("HTTP/1.1 403 Forbidden");
  });

  it("launches the browser through it for every address, this machine included, with no direct UDP", () => {
    expect(proxiedLaunch(proxy)).toEqual({
      proxy: { server: proxy.url, bypass: "<-loopback>" },
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    });
  });
});
