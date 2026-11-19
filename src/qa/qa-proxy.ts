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

/** A tunnel's target, `host:port`, read once: what is checked is what is dialled. */
const TARGET = /^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):(\d{1,5})$/;

/**
 * Where a host is dialled: a `*.localhost` name is this machine (RFC 6761), whatever DNS says, as
 * `localhost`, so both IPv4 and IPv6 are tried.
 */
export const dialHost = (hostname: string): string => {
  const bare = hostname.replace(/^\[(.*)\]$/, "$1");
  return bare.toLowerCase().endsWith(".localhost") ? "localhost" : bare;
};

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

/** Refuses a call that came as a raw socket (a tunnel or a socket upgrade). */
function refuseSocket(socket: Socket, refused: Refusal[], refusal: Refusal): void {
  refused.push(refusal);
  socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
}

/**
 * Starts the proxy a walk's browser goes through, loopback included. It lets out only what
 * `allowed` accepts, at every hop: a redirect to another host is a new call, refused here, where
 * the page's own routing would only see the first one. Workers, prefetches, service workers and
 * sockets go through it too. A call the browser drops (the person left, the walk ended) is dropped
 * on the app's side too, so the app sees it end and nothing keeps the walk running.
 */
export async function startProxy(allowed: (address: string) => boolean): Promise<WalkProxy> {
  const refused: Refusal[] = [];
  const open = new Set<{ destroy(): unknown }>();
  const track = (end: { destroy(): unknown; on(e: "close", f: () => void): unknown }) => {
    open.add(end);
    end.on("close", () => open.delete(end));
  };
  const server = createServer((req, res) => {
    const url = parse(req.url ?? "");
    if (url?.protocol !== "http:" || !allowed(url.href)) {
      refused.push({ method: req.method ?? "GET", url: req.url ?? "" });
      res.writeHead(403, { "content-type": "text/plain" }).end(BLOCKED);
      return;
    }
    const target = {
      host: dialHost(url.hostname),
      port: url.port || 80,
      path: url.pathname + url.search,
    };
    const upstream = forward(
      { ...target, method: req.method, headers: forwarded(req.headers) },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
        // An answer the app cut off half-way fails for the browser too, as it would without us.
        up.on("close", () => {
          if (!up.complete) res.destroy();
        });
      },
    );
    track(upstream);
    upstream.on("error", (error: NodeJS.ErrnoException) => {
      if (res.headersSent) return res.destroy();
      res
        .writeHead(502, { "content-type": "text/plain" })
        .end(`nothing answers: ${error.code ?? error.message}`);
    });
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.on("error", () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on("connect", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    socket.on("error", () => socket.destroy());
    const [, host, port] = TARGET.exec(req.url ?? "") ?? [];
    const target = `${host}:${port}`;
    if (!host || !port || !(allowed(`https://${target}/`) || allowed(`http://${target}/`)))
      return refuseSocket(socket, refused, { method: "CONNECT", url: req.url ?? "" });
    let established = false;
    const upstream = connect(Number(port), dialHost(host), () => {
      established = true;
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      splice(socket, upstream);
    });
    // Nothing listening there: said as a proxy says it, so the caller reads a 502, not a hang-up.
    upstream.on("error", () =>
      established ? socket.destroy() : socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"),
    );
    track(socket);
    track(upstream);
  });
  // A socket asked for without a tunnel: Chromium tunnels its sockets, so none is let out this way.
  server.on("upgrade", (req: IncomingMessage, socket: Socket) => {
    socket.on("error", () => socket.destroy());
    refuseSocket(socket, refused, { method: req.method ?? "GET", url: req.url ?? "" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    refused,
    close: () =>
      new Promise((resolve) => {
        for (const end of open) end.destroy();
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
