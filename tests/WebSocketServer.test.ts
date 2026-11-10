import * as fs from "fs";
import * as http from "http";
import * as net from "net";
import { setTimeout } from "node:timers/promises";
import * as os from "os";
import * as path from "path";
import { describe, expect, test, vi } from "vitest";
import WebSocket from "ws";

import { AllowedHost } from "../src/AllowedHosts.ts";
import { markAsHost } from "../src/Host.ts";
import { markAsPort } from "../src/Port.ts";
import {
  markAsAbsolutePath,
  markAsStaticFilesDir,
  markAsWebSocketToken,
  type TargetName,
} from "../src/Types.ts";
import {
  type OutputRequest,
  WebSocketServer,
  type WebSocketServerMsg,
  type WebSocketServerOptions,
} from "../src/WebSocketServer.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

const TOKEN = "token";

const OPTIONS: WebSocketServerOptions = {
  createServer: ({ onRequest, onUpgrade }) =>
    http.createServer(onRequest).on("upgrade", onUpgrade),
  getNow: () => new Date(),
  portChoice: { tag: "NoPort" },
  host: markAsHost("127.0.0.1"),
  staticFilesDirectory: undefined,
  webSocketToken: markAsWebSocketToken(TOKEN),
  allowedHosts: [],
  configSource: { tag: "Options" },
};

async function withServer(
  allowedHosts: Array<string>,
  f: (helpers: {
    get: (headers: http.OutgoingHttpHeaders) => Promise<string>;
    connect: (headers: http.OutgoingHttpHeaders) => Promise<string>;
    rejections: Array<unknown>;
  }) => Promise<void>,
): Promise<void> {
  const server = new WebSocketServer({
    ...OPTIONS,
    allowedHosts: allowedHosts.map((host) => {
      const result = AllowedHost.decoder(host);
      if (result.tag === "DecoderError") {
        throw new Error(`Invalid allowed host: ${host}`);
      }
      return result.value;
    }),
  });
  const rejections: Array<unknown> = [];
  server.setDispatch((msg: WebSocketServerMsg) => {
    switch (msg.tag) {
      case "WebSocketConnectionRejected":
        rejections.push(msg);
        return;
      case "WebSocketConnected":
        msg.connection.webSocket.close();
        return;
      default:
        return;
    }
  });
  await server.listening;
  const { port } = server;

  const get = (headers: http.OutgoingHttpHeaders): Promise<string> =>
    new Promise((resolve, reject) => {
      http
        .get({ port, headers, agent: false }, (response) => {
          let body = "";
          response.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          response.on("end", () => {
            const h1 = /<h1>([^<]*)<\/h1>/.exec(body)?.[1] ?? "(no h1)";
            resolve(`${response.statusCode ?? "(no status)"} ${h1}`);
          });
        })
        .on("error", reject);
    });

  const connect = (headers: http.OutgoingHttpHeaders): Promise<string> =>
    new Promise((resolve, reject) => {
      const webSocket = new WebSocket(
        `ws://127.0.0.1:${port}/elm-watch?webSocketToken=${TOKEN}`,
        { headers },
      );
      webSocket.on("open", () => {
        webSocket.close();
        resolve("open");
      });
      webSocket.on("unexpected-response", (_request, response) => {
        resolve(
          `${response.statusCode ?? "(no status)"} ${String(response.headers["x-reason"])}`,
        );
      });
      webSocket.on("error", reject);
    });

  try {
    await f({ get, connect, rejections });
  } finally {
    await server.close();
  }
}

describe("WebSocketServer", () => {
  test("HTTP requests: Host header", async () => {
    await withServer(["dev.example.com"], async ({ get }) => {
      expect(await get({})).toMatchInlineSnapshot(
        `200 Enable elm-watch static file server?`,
      );
      expect(await get({ Host: "localhost:1234" })).toMatchInlineSnapshot(
        `200 Enable elm-watch static file server?`,
      );
      expect(await get({ Host: "my-macbook.local" })).toMatchInlineSnapshot(
        `200 Enable elm-watch static file server?`,
      );
      expect(await get({ Host: "dev.example.com" })).toMatchInlineSnapshot(
        `200 Enable elm-watch static file server?`,
      );
      expect(await get({ Host: "evil.com:1234" })).toMatchInlineSnapshot(
        `403 Host not allowed`,
      );
      expect(await get({ Host: "evil.com/" })).toMatchInlineSnapshot(
        `403 Invalid Host header`,
      );
    });
  });

  test("isAllowedHost for custom request handlers", async () => {
    let isAllowedHost:
      | ((request: http.IncomingMessage) => boolean)
      | undefined = undefined;
    const server = new WebSocketServer({
      ...OPTIONS,
      createServer: ({
        onRequest,
        onUpgrade,
        isAllowedHost: givenIsAllowedHost,
      }) => {
        isAllowedHost = givenIsAllowedHost;
        return http.createServer(onRequest).on("upgrade", onUpgrade);
      },
    });
    server.setDispatch(() => {
      // Do nothing.
    });
    await server.listening;
    await server.close();

    const check = (host: string | undefined): boolean | undefined => {
      const request = new http.IncomingMessage(new net.Socket());
      request.headers.host = host;
      return isAllowedHost?.(request);
    };
    expect(check("localhost:1234")).toBe(true);
    expect(check("127.0.0.1")).toBe(true);
    expect(check("evil.com")).toBe(false);
    expect(check(undefined)).toBe(false);
  });

  test("WebSocket: Host and Origin headers", async () => {
    await withServer(["dev.example.com"], async ({ connect, rejections }) => {
      expect(await connect({})).toMatchInlineSnapshot(`open`);
      expect(await connect({ Origin: "null" })).toMatchInlineSnapshot(`open`);
      expect(
        await connect({
          Host: "localhost:8000",
          Origin: "http://localhost:3000",
        }),
      ).toMatchInlineSnapshot(`open`);
      expect(
        await connect({
          Host: "127.0.0.1:8000",
          Origin: "https://dev.example.com",
        }),
      ).toMatchInlineSnapshot(`open`);
      expect(rejections).toStrictEqual([]);

      expect(
        await connect({
          Host: "evil.com:8000",
          Origin: "http://evil.com:8000",
        }),
      ).toMatchInlineSnapshot(`403 Host not allowed`);
      expect(
        await connect({ Host: "localhost:8000", Origin: "https://evil.com" }),
      ).toMatchInlineSnapshot(`403 Origin not allowed`);
      expect(
        await connect({ Host: "localhost:8000", Origin: "not a url" }),
      ).toMatchInlineSnapshot(`403 Origin not allowed`);

      expect(rejections).toMatchInlineSnapshot(`
        [
          {
            origin: http://evil.com:8000,
            reason: {
              rejectedHost: {
                hostname: evil.com,
                tag: NotAllowed,
              },
              tag: HostNotAllowed,
            },
            tag: WebSocketConnectionRejected,
          },
          {
            origin: https://evil.com,
            reason: {
              rejectedHost: {
                hostname: evil.com,
                tag: NotAllowed,
              },
              tag: OriginNotAllowed,
            },
            tag: WebSocketConnectionRejected,
          },
          {
            origin: not a url,
            reason: {
              rejectedHost: {
                tag: Invalid,
                value: not a url,
              },
              tag: OriginNotAllowed,
            },
            tag: WebSocketConnectionRejected,
          },
        ]
      `);
    });
  });

  test("messages received while dispatch is unset are queued and replayed", async () => {
    const server = new WebSocketServer(OPTIONS);

    const log: Array<string> = [];
    const describeMsg = (msg: WebSocketServerMsg): string =>
      msg.tag === "WebSocketMessageReceived"
        ? `${msg.tag} ${(msg.data as Buffer).toString()}`
        : msg.tag;
    const record =
      (name: string) =>
      (msg: WebSocketServerMsg): void => {
        log.push(`${name}: ${describeMsg(msg)}`);
      };

    // Spy on the queueing, to know when messages have arrived.
    let numQueued = 0;
    const originalDispatchToQueue = server.dispatchToQueue;
    server.dispatchToQueue = (msg) => {
      numQueued++;
      originalDispatchToQueue(msg);
    };
    const waitForQueued = (n: number): Promise<void> =>
      vi.waitFor(() => {
        expect(numQueued).toBe(n);
      });

    server.setDispatch(record("A"));
    await server.listening;
    server.unsetDispatch();

    const webSocket = new WebSocket(
      `ws://127.0.0.1:${server.port}/elm-watch?webSocketToken=${TOKEN}`,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        webSocket.on("open", () => {
          resolve();
        });
        webSocket.on("error", reject);
      });
      webSocket.send("one");
      webSocket.send("two");
      await waitForQueued(3);
      expect(log).toStrictEqual([]);

      // Replayed in a microtask, not during `setDispatch`.
      server.setDispatch(record("B"));
      expect(log).toStrictEqual([]);
      await setTimeout(0);
      expect(log).toStrictEqual([
        "B: WebSocketConnected",
        "B: WebSocketMessageReceived one",
        "B: WebSocketMessageReceived two",
      ]);

      // If dispatch is unset again before the replay, the messages are queued
      // again (not lost), and replayed on the next `setDispatch`.
      log.length = 0;
      server.unsetDispatch();
      webSocket.send("three");
      await waitForQueued(4);
      server.setDispatch(record("C"));
      server.unsetDispatch();
      await setTimeout(0);
      expect(log).toStrictEqual([]);
      server.setDispatch(record("D"));
      await setTimeout(0);
      expect(log).toStrictEqual(["D: WebSocketMessageReceived three"]);

      // The queue is cleared after replaying.
      server.setDispatch(record("E"));
      await setTimeout(0);
      expect(log).toStrictEqual(["D: WebSocketMessageReceived three"]);
    } finally {
      webSocket.close();
      await server.close();
    }
  });

  test("output requests are kept track of until responded to or given up on", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elm-watch-requests-"));
    fs.writeFileSync(path.join(dir, "Main.js"), "on disk");
    fs.writeFileSync(path.join(dir, "other.js"), "other");
    const server = new WebSocketServer({
      ...OPTIONS,
      staticFilesDirectory: markAsStaticFilesDir(markAsAbsolutePath(dir)),
    });
    server.setResolveOutput((absolutePath) =>
      path.basename(absolutePath) === "Main.js"
        ? ("Main" as TargetName)
        : undefined,
    );
    const received: Array<OutputRequest> = [];
    server.setDispatch((msg) => {
      if (msg.tag === "OutputRequested") {
        received.push(msg.outputRequest);
      }
    });
    await server.listening;

    const request = (
      urlPath: string,
    ): { response: Promise<string>; abort: () => void } => {
      const clientRequest = http.get({
        port: server.port,
        path: urlPath,
        agent: false,
      });
      const response = new Promise<string>((resolve, reject) => {
        clientRequest.on("response", (incoming) => {
          let body = "";
          incoming.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          incoming.on("end", () => {
            resolve(body);
          });
        });
        clientRequest.on("error", reject);
      });
      return {
        response,
        abort: () => {
          response.catch(() => {
            // Expected.
          });
          clientRequest.destroy();
        },
      };
    };

    try {
      // Other files are served right away.
      expect(await request("/other.js").response).toBe("other");
      expect(received).toStrictEqual([]);

      // Responded to.
      const first = request("/Main.js");
      await vi.waitFor(() => {
        expect(received).toHaveLength(1);
      });
      expect(Array.from(server.getOutputRequests())).toStrictEqual(received);
      received[0]?.serveJavaScript("compiled");
      expect(server.getOutputRequests().size).toBe(0);
      expect(await first.response).toBe("compiled");

      const second = request("/Main.js");
      await vi.waitFor(() => {
        expect(received).toHaveLength(2);
      });
      received[1]?.serveFile();
      expect(server.getOutputRequests().size).toBe(0);
      expect(await second.response).toBe("on disk");

      // Given up on.
      const third = request("/Main.js");
      await vi.waitFor(() => {
        expect(received).toHaveLength(3);
      });
      expect(server.getOutputRequests().size).toBe(1);
      third.abort();
      await vi.waitFor(() => {
        expect(server.getOutputRequests().size).toBe(0);
      });
    } finally {
      await server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  describe("port conflicts", () => {
    async function listenOther(host: string | undefined): Promise<http.Server> {
      const server = http.createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, host, resolve);
      });
      return server;
    }

    async function closeServer(server: http.Server): Promise<void> {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }

    function createServer(port: number): WebSocketServer {
      return new WebSocketServer({
        ...OPTIONS,
        portChoice: { tag: "PortFromConfig", port: markAsPort(port) },
      });
    }

    // On macOS, listening on 127.0.0.1 succeeds even if another program
    // listens on the same port on `::`, 0.0.0.0 or ::1. We still want to
    // report a port conflict in those cases.
    for (const otherHost of [undefined, "::", "0.0.0.0", "127.0.0.1", "::1"]) {
      test(`other program listening on ${otherHost ?? "(default)"}`, async () => {
        const other = await listenOther(otherHost);
        const { port } = other.address() as net.AddressInfo;
        const server = createServer(port);
        const result = await new Promise<string>((resolve, reject) => {
          server.setDispatch((msg) => {
            resolve(
              msg.tag === "WebSocketServerError" ? msg.error.tag : msg.tag,
            );
          });
          server.listening
            .then(() => {
              resolve("Listening");
            })
            .catch(reject);
        });
        await server.close();
        await closeServer(other);
        expect(result).toBe("PortConflict");
      });
    }

    test("closing while checking the port", async () => {
      const temporary = await listenOther("127.0.0.1");
      const { port } = temporary.address() as net.AddressInfo;
      await closeServer(temporary);

      const server = createServer(port);
      await server.close();
      // Give the port check time to finish.
      await setTimeout(100);

      // The port should not have been taken after closing.
      const again = http.createServer();
      await expect(
        new Promise<void>((resolve, reject) => {
          again.once("error", reject);
          again.listen(port, "127.0.0.1", resolve);
        }),
      ).resolves.toBeUndefined();
      await closeServer(again);
    });
  });
});
