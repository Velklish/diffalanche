import type { Hono } from "hono";

/** `hostname` is the address the socket is bound to, read back from the runtime
 * rather than repeated: it is what says the server is on loopback and nowhere else. */
type RunningServer = { port: number; hostname: string; close: () => Promise<void> };

type BunGlobal = {
  serve: (options: {
    port: number;
    hostname: string;
    idleTimeout: number;
    fetch: (request: Request) => Response | Promise<Response>;
  }) => { port: number; hostname: string; stop: (closeActiveConnections?: boolean) => void };
};

/** The one place the two runtimes differ, resolving once the socket listens rather than when
 * `serve` returns (07-server.md, "The runtime switch"; ADR-008). */
export async function startServer(
  app: Hono,
  port: number,
  hostname = "127.0.0.1",
): Promise<RunningServer> {
  const bun = (globalThis as { Bun?: BunGlobal }).Bun;
  if (bun) {
    // Bun closes a connection idle for ten seconds, and SSE between events is idle for fifteen;
    // Node has no such timeout on a response it is still writing (07-server.md, "The live stream").
    const server = bun.serve({ port, hostname, idleTimeout: 0, fetch: app.fetch });
    return {
      port: server.port,
      hostname: server.hostname,
      close: async () => {
        server.stop(true);
      },
    };
  }

  const { serve } = await import("@hono/node-server");
  return new Promise<RunningServer>((resolve, reject) => {
    const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
      resolve({
        port: info.port,
        hostname: info.address,
        close: () =>
          new Promise<void>((closed, failed) => {
            server.close((error) => (error ? failed(error) : closed()));
          }),
      });
    });
    server.once("error", reject);
  });
}
