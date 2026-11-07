import * as http from "http";
import * as net from "net";
import { describe, expect, test } from "vitest";
import WebSocket from "ws";

import { AllowedHost } from "../src/AllowedHosts";
import { markAsHost } from "../src/Host";
import { markAsPort } from "../src/Port";
import { markAsWebSocketToken } from "../src/Types";
import { WebSocketServer, WebSocketServerMsg } from "../src/WebSocketServer";
import { stringSnapshotSerializer } from "./Helpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

const TOKEN = "token";

async function withServer(
  allowedHosts: Array<string>,
  f: (helpers: {
    get: (headers: http.OutgoingHttpHeaders) => Promise<string>;
    connect: (headers: http.OutgoingHttpHeaders) => Promise<string>;
    rejections: Array<unknown>;
  }) => Promise<void>,
): Promise<void> {
  const server = new WebSocketServer(
    ({ onRequest, onUpgrade }) =>
      http.createServer(onRequest).on("upgrade", onUpgrade),
    { tag: "NoPort" },
    markAsHost("127.0.0.1"),
    undefined,
    markAsWebSocketToken(TOKEN),
    allowedHosts.map((host) => {
      const result = AllowedHost.decoder(host);
      if (result.tag === "DecoderError") {
        throw new Error(`Invalid allowed host: ${host}`);
      }
      return result.value;
    }),
    { tag: "Options" },
  );
  const rejections: Array<unknown> = [];
  server.setDispatch((msg: WebSocketServerMsg) => {
    switch (msg.tag) {
      case "WebSocketConnectionRejected":
        rejections.push(msg);
        return;
      case "WebSocketConnected":
        msg.webSocket.close();
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
    const server = new WebSocketServer(
      ({ onRequest, onUpgrade, isAllowedHost: givenIsAllowedHost }) => {
        isAllowedHost = givenIsAllowedHost;
        return http.createServer(onRequest).on("upgrade", onUpgrade);
      },
      { tag: "NoPort" },
      markAsHost("127.0.0.1"),
      undefined,
      markAsWebSocketToken(TOKEN),
      [],
      { tag: "Options" },
    );
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
      return new WebSocketServer(
        ({ onRequest, onUpgrade }) =>
          http.createServer(onRequest).on("upgrade", onUpgrade),
        { tag: "PortFromConfig", port: markAsPort(port) },
        markAsHost("127.0.0.1"),
        undefined,
        markAsWebSocketToken(TOKEN),
        [],
        { tag: "Options" },
      );
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
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

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
