import { createServer, request as forward, type IncomingMessage } from "node:http";
import { connect, type Socket } from "node:net";
import { BLOCKED } from "./qa-origins.ts";

/** A call the proxy did not let out: its method and where it went (`host:port` for a tunnel). */
interface Refusal {
  readonly method: string;
  readonly url: string;
}

/** The proxy every person's browser goes through; `refused` fills as calls are stopped. */
export interface WalkProxy {
  readonly url: string;
  readonly refused: Refusal[];
  close(): Promise<void>;
}

const parse = (address: string): URL | undefined => {
  try {
    return new URL(address);
  } catch {
    return undefined;
  }
};

/** `host:port` of a tunnel (https, or a socket), as `allowed` reads it: by either scheme. */
function tunnelAllowed(allowed: (address: string) => boolean, target: string): boolean {
  return allowed(`https://${target}/`) || allowed(`http://${target}/`);
}

/** The headers a proxy must not pass on. */
const forwarded = (headers: IncomingMessage["headers"]) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => !name.startsWith("proxy-")));

/** Pipes two sockets into each other, and closes both when either fails. */
function splice(a: Socket, b: Socket): void {
  a.on("error", () => b.destroy());
  b.on("error", () => a.destroy());
  a.pipe(b);
  b.pipe(a);
}

/**
 * Starts the proxy a walk's browser goes through, loopback included. It lets out only what
 * `allowed` accepts, at every hop: a redirect to another host is a new call, refused here, where
 * the page's own routing would only see the first one. Workers, prefetches, service workers and
 * sockets go through it too.
 */
export async function startProxy(allowed: (address: string) => boolean): Promise<WalkProxy> {
  const refused: Refusal[] = [];
  const tunnels = new Set<Socket>();
  const server = createServer((req, res) => {
    const url = parse(req.url ?? "");
    if (url?.protocol !== "http:" || !allowed(url.href)) {
      refused.push({ method: req.method ?? "GET", url: req.url ?? "" });
      res.writeHead(403, { "content-type": "text/plain" }).end(BLOCKED);
      return;
    }
    const upstream = forward(url, { method: req.method, headers: forwarded(req.headers) }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on("error", () => res.destroy());
    req.pipe(upstream);
  });
  server.on("connect", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const target = req.url ?? "";
    const at = target.lastIndexOf(":");
    if (at < 0 || !tunnelAllowed(allowed, target)) {
      refused.push({ method: "CONNECT", url: target });
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const host = target.slice(0, at).replace(/^\[(.*)\]$/, "$1");
    const upstream = connect(Number(target.slice(at + 1)), host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      splice(socket, upstream);
    });
    upstream.on("error", () => socket.destroy());
    for (const end of [socket, upstream]) {
      tunnels.add(end);
      end.on("close", () => tunnels.delete(end));
    }
  });
  // A socket asked for without a tunnel: Chromium tunnels its sockets, so none is let out this way.
  server.on("upgrade", (req: IncomingMessage, socket: Socket) => {
    refused.push({ method: req.method ?? "GET", url: req.url ?? "" });
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    refused,
    close: () =>
      new Promise((resolve) => {
        for (const tunnel of tunnels) tunnel.destroy();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** How the browser is launched to go only through the proxy: loopback too, and no direct UDP. */
export const proxiedLaunch = (proxy: WalkProxy) => ({
  proxy: { server: proxy.url, bypass: "<-loopback>" },
  args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
});
