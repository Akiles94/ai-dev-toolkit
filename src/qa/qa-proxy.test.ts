import { createServer, request as httpRequest, type Server } from "node:http";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { originPolicy } from "./qa-origins.ts";
import { dialHost, proxiedLaunch, startProxy, type WalkProxy } from "./qa-proxy.ts";

// The proxy alone, with Node as its client: these run where no browser is installed.

let app: Server;
let appPort = 0;
let outside: Server;
let outsidePort = 0;
let outsideHits = 0;
let liveCalls = 0;
let proxy: WalkProxy;

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return typeof address === "object" && address ? address.port : 0;
};

beforeAll(async () => {
  app = createServer((req, res) => {
    if (req.url === "/events") {
      liveCalls++;
      req.on("close", () => liveCalls--);
      return res.writeHead(200, { "content-type": "text/event-stream" }).write("data: hi\n\n");
    }
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

  it("refuses a tunnel whose target is not plainly host:port", async () => {
    proxy.refused.splice(0);
    expect(await tunnel(`localhost/.card4242.example.com:${appPort}`)).toBe(
      "HTTP/1.1 403 Forbidden",
    );
    expect(proxy.refused).toEqual([
      { method: "CONNECT", url: `localhost/.card4242.example.com:${appPort}` },
    ]);
  });

  it("survives a browser side that resets, whatever it was asking", async () => {
    const { port } = new URL(proxy.url);
    for (const target of [`127.0.0.1:${appPort}`, `127.0.0.1:${outsidePort}`]) {
      await new Promise<void>((resolve) => {
        const socket = connect(Number(port), "127.0.0.1", () => {
          socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
          socket.resetAndDestroy();
          setTimeout(resolve, 100);
        });
      });
    }
    expect(await viaProxy(`http://127.0.0.1:${appPort}/still`)).toMatchObject({ status: 200 });
  });

  it("drops the call to the app when the browser drops it, so a stream left open ends", async () => {
    const { port } = new URL(proxy.url);
    const req = httpRequest({
      host: "127.0.0.1",
      port,
      path: `http://127.0.0.1:${appPort}/events`,
    });
    await new Promise<void>((resolve) => {
      req.on("response", () => resolve());
      req.end();
    });
    expect(liveCalls).toBe(1);
    req.destroy();
    const until = Date.now() + 1000;
    while (liveCalls > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    expect(liveCalls).toBe(0);
  });

  it("says when nothing answers at an allowed address, and dials *.localhost names here", async () => {
    const closed = await startProxy(() => true);
    const { port } = new URL(closed.url);
    const answer = await new Promise<{ status: number; body: string }>((resolve) => {
      httpRequest({ host: "127.0.0.1", port, path: "http://127.0.0.1:9/x" }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }).end();
    });
    await closed.close();
    expect(answer).toEqual({ status: 502, body: "nothing answers: ECONNREFUSED" });
    expect(dialHost("shop.LocalHost")).toBe("127.0.0.1");
    expect(dialHost("[::1]")).toBe("::1");
    expect(dialHost("example.com")).toBe("example.com");
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
