import * as crypto from "crypto";
import * as https from "https";
import type { AddressInfo } from "net";
import type { Duplex } from "stream";
import * as util from "util";
import WebSocket, { WebSocketServer as WsServer } from "ws";

import { toError } from "./Helpers";
import { Host } from "./Host";
import { markAsPort, Port, PortChoice } from "./Port";
import * as SimpleStaticFileServer from "./SimpleStaticFileServer";
import { CreateServer, StaticFilesDir } from "./Types";
import { WebSocketToken } from "./Types";

// We used to require `/?`. Putting “elm-watch” in the path is useful for people
// running elm-watch behind a proxy: They can use the same port for both the web
// site and elm-watch, and direct traffic by path matching.
const WEBSOCKET_URL_EXPECTED_START = "/elm-watch?";

export type WebSocketServerMsg =
  | {
      tag: "WebSocketClosed";
      webSocket: WebSocket;
    }
  | {
      tag: "WebSocketConnected";
      webSocket: WebSocket;
      urlParams: URLSearchParams;
    }
  | {
      tag: "WebSocketConnectionRejected";
      origin: string | undefined;
      reason: WebSocketConnectionRejectedReason;
    }
  | {
      tag: "WebSocketMessageReceived";
      webSocket: WebSocket;
      data: WebSocket.Data;
    }
  | {
      tag: "WebSocketServerError";
      error: WebSocketServerError;
    };

type WebSocketServerError =
  | {
      tag: "HostNotFound";
      host: Host;
      error: Error;
    }
  | {
      tag: "OtherError";
      error: Error;
    }
  | {
      tag: "PortConflict";
      portChoice: PortChoice;
      error: Error;
    };

export type WebSocketConnectionRejectedReason =
  | {
      tag: "BadUrl";
      expectedStart: typeof WEBSOCKET_URL_EXPECTED_START;
      actualUrlString: string;
    }
  | {
      tag: "WrongToken";
    };

export class WebSocketServer {
  private polyHttpServer: ReturnType<CreateServer>;

  private webSocketServer = new WsServer({ noServer: true });

  private sockets = new Set<Duplex>();

  isHTTPS: boolean;

  port: Port;

  private dispatch: (msg: WebSocketServerMsg) => void;

  private msgQueue: Array<WebSocketServerMsg> = [];

  listening: Promise<void>;

  constructor(
    createServer: CreateServer,
    portChoice: PortChoice,
    host: Host,
    staticFilesDirectory: StaticFilesDir | undefined,
    webSocketToken: WebSocketToken,
  ) {
    this.polyHttpServer = createServer({
      onRequest: (request, response) => {
        if (staticFilesDirectory !== undefined) {
          try {
            SimpleStaticFileServer.serveStatic(staticFilesDirectory)(
              request,
              response,
            );
          } catch (unknownError) {
            SimpleStaticFileServer.respondHtml(
              response,
              500,
              SimpleStaticFileServer.errorHtml(toError(unknownError).message),
            );
          }
        } else {
          SimpleStaticFileServer.respondHtml(
            response,
            200,
            SimpleStaticFileServer.staticFileNotEnabledHtml(),
          );
        }
      },
      onUpgrade: (request, socket, head) => {
        // `request.url` is always a string here, but the types says it can be undefined:
        // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/15808
        const urlString =
          /* v8 ignore next */
          request.url ?? "/";

        const { origin } = request.headers;

        if (!urlString.startsWith(WEBSOCKET_URL_EXPECTED_START)) {
          error401(socket, "Invalid URL");
          this.dispatch({
            tag: "WebSocketConnectionRejected",
            origin,
            reason: {
              tag: "BadUrl",
              expectedStart: WEBSOCKET_URL_EXPECTED_START,
              actualUrlString: urlString,
            },
          });
          return;
        }

        // This never throws as far as I can tell.
        const urlParams = new URLSearchParams(
          urlString.slice(WEBSOCKET_URL_EXPECTED_START.length),
        );

        const urlToken = urlParams.get("webSocketToken") ?? "";

        const actualToken = Buffer.from(urlToken);
        const expectedToken = Buffer.from(webSocketToken);
        const tokenIsCorrect =
          Buffer.byteLength(actualToken) === Buffer.byteLength(expectedToken) &&
          crypto.timingSafeEqual(actualToken, expectedToken);

        if (!tokenIsCorrect) {
          error401(socket, "Invalid token");
          this.dispatch({
            tag: "WebSocketConnectionRejected",
            origin,
            reason: { tag: "WrongToken" },
          });
          return;
        }

        this.webSocketServer.handleUpgrade(
          request,
          socket,
          head,
          (webSocket) => {
            (
              webSocket as WebSocket & {
                [util.inspect.custom]: util.CustomInspectFunction;
              }
            )[util.inspect.custom] =
              /* v8 ignore next */
              (_depth, options) => options.stylize("WebSocket", "special");

            this.dispatch({
              tag: "WebSocketConnected",
              webSocket,
              urlParams,
            });

            webSocket.on("message", (data) => {
              this.dispatch({
                tag: "WebSocketMessageReceived",
                webSocket,
                data,
              });
            });

            webSocket.on("close", () => {
              this.dispatch({ tag: "WebSocketClosed", webSocket });
            });

            /* v8 ignore start */
            webSocket.on("error", (error) => {
              this.dispatch({
                tag: "WebSocketServerError",
                error: { tag: "OtherError", error },
              });
            });
            /* v8 ignore stop */
          },
        );
      },
    });

    this.isHTTPS = this.polyHttpServer instanceof https.Server;

    this.dispatch = this.dispatchToQueue;

    this.polyHttpServer.on("error", (error: NodeJS.ErrnoException) => {
      this.dispatch({
        tag: "WebSocketServerError",
        error:
          error.code === "EADDRINUSE"
            ? { tag: "PortConflict", portChoice, error }
            : error.code === "ENOTFOUND"
              ? { tag: "HostNotFound", host, error }
              : /* v8 ignore next */
                { tag: "OtherError", error },
      });
    });

    this.polyHttpServer.on("connection", (socket: Duplex) => {
      this.sockets.add(socket);
      socket.once("close", () => {
        this.sockets.delete(socket);
      });
    });

    this.port = markAsPort(0);
    this.listening = new Promise((resolve) => {
      this.polyHttpServer.once("listening", () => {
        const address = this.polyHttpServer.address() as AddressInfo;
        this.port = markAsPort(address.port);
        resolve();
      });
    });

    this.polyHttpServer.listen(
      // If `port` is 0, the operating system will assign an arbitrary unused port.
      portChoice.tag === "NoPort" ? 0 : portChoice.port,
      host,
    );
  }

  dispatchToQueue = (msg: WebSocketServerMsg): void => {
    this.msgQueue.push(msg);
  };

  setDispatch(dispatch: (msg: WebSocketServerMsg) => void): void {
    this.dispatch = dispatch;
    // When testing, a change to elm.json gives a 5 ms room where queueing is needed.
    // That’s very unlikely to even be needed, and very hard to test.
    /* v8 ignore start */
    for (const msg of this.msgQueue) {
      dispatch(msg);
    }
    /* v8 ignore stop */
  }

  unsetDispatch(): void {
    this.dispatch = this.dispatchToQueue;
  }

  async close(): Promise<void> {
    this.unsetDispatch();
    // This terminates all connections.
    this.webSocketServer.close();
    for (const socket of this.sockets) {
      socket.destroy();
    }
    await new Promise<void>((resolve, reject) => {
      this.polyHttpServer.close((error: NodeJS.ErrnoException | undefined) => {
        if (error !== undefined && error.code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    for (const webSocket of this.webSocketServer.clients) {
      webSocket.close();
    }
  }
}

function error401(socket: Duplex, message: string): void {
  socket.write(`HTTP/1.1 401 Unauthorized\r\nX-Reason: ${message}\r\n\r\n`);
  socket.destroy();
}
