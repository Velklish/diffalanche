import type { Hono } from "hono";

export type RunningServer = { port: number; close: () => Promise<void> };

type BunGlobal = {
  serve: (options: {
    port: number;
    hostname: string;
    fetch: (request: Request) => Response | Promise<Response>;
  }) => { port: number; stop: (closeActiveConnections?: boolean) => void };
};

/**
 * The one place where the two runtimes differ: Bun serves natively, Node serves
 * through the Hono adapter. Everything else in `src/` uses APIs both share.
 *
 * The promise resolves when the socket is listening, not when `serve` returns:
 * the Node adapter returns before it listens, and with port 0 the real port is
 * only known then.
 */
export async function startServer(
  app: Hono,
  port: number,
  hostname = "127.0.0.1",
): Promise<RunningServer> {
  const bun = (globalThis as { Bun?: BunGlobal }).Bun;
  if (bun) {
    const server = bun.serve({ port, hostname, fetch: app.fetch });
    return {
      port: server.port,
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
        close: () =>
          new Promise<void>((closed, failed) => {
            server.close((error) => (error ? failed(error) : closed()));
          }),
      });
    });
    server.once("error", reject);
  });
}
