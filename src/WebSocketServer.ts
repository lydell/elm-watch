import * as crypto from "crypto";
import * as https from "https";
import type { AddressInfo } from "net";
import * as net from "net";
import type { Duplex } from "stream";
import * as util from "util";
import type WebSocket from "ws";
import { WebSocketServer as WsServer } from "ws";

import {
  type AllowedHost,
  checkHostHeader,
  checkOriginHeader,
  type RejectedHost,
} from "./AllowedHosts.ts";
import type { ConfigSource } from "./Config.ts";
import { toError } from "./Helpers.ts";
import type { Host } from "./Host.ts";
import { markAsPort, type Port, type PortChoice } from "./Port.ts";
import * as SimpleStaticFileServer from "./SimpleStaticFileServer.ts";
import type {
  AbsolutePath,
  CreateServer,
  GetNow,
  StaticFilesDir,
  TargetName,
  WebSocketToken,
} from "./Types.ts";

// We used to require `/?`. Putting “elm-watch” in the path is useful for people
// running elm-watch behind a proxy: They can use the same port for both the web
// site and elm-watch, and direct traffic by path matching.
const WEBSOCKET_URL_EXPECTED_START = "/elm-watch?";

// The server keeps track of the open web sockets, since it outlives each run of
// Hot (it is kept when restarting).
export type WebSocketConnection = {
  webSocket: WebSocket;
  urlParams: URLSearchParams;
  // When the web socket connected, or when its tab was last focused. Outputs
  // with recently connected or focused web sockets are compiled first.
  priority: number;
};

// An HTTP request for an output, which waits for the output to be compiled.
// Like web sockets, these are kept track of by the server, since they might
// need to wait across restarts.
export type OutputRequest = {
  targetName: TargetName;
  // When the request was made. Outputs with recent requests are compiled first.
  priority: number;
  // Serve the file on disk.
  serveFile: () => void;
  serveJavaScript: (code: string) => void;
};

export type WebSocketServerMsg =
  | {
      tag: "OutputRequested";
      outputRequest: OutputRequest;
    }
  | {
      tag: "WebSocketConnected";
      connection: WebSocketConnection;
    }
  | {
      tag: "WebSocketConnectionRejected";
      origin: string | undefined;
      reason: WebSocketConnectionRejectedReason;
    }
  | {
      tag: "WebSocketMessageReceived";
      connection: WebSocketConnection;
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
      tag: "HostNotAllowed";
      rejectedHost: RejectedHost;
    }
  | {
      tag: "OriginNotAllowed";
      rejectedHost: RejectedHost;
    }
  | {
      tag: "WrongToken";
    };

export type WebSocketServerOptions = {
  createServer: CreateServer;
  getNow: GetNow;
  portChoice: PortChoice;
  host: Host;
  staticFilesDirectory: StaticFilesDir | undefined;
  webSocketToken: WebSocketToken;
  allowedHosts: ReadonlyArray<AllowedHost>;
  configSource: ConfigSource;
};

export class WebSocketServer {
  private polyHttpServer: ReturnType<CreateServer>;

  // Messages from the client are tiny, so there’s no need for the default
  // limit of 100 MiB.
  private webSocketServer = new WsServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    // We keep track of the connections ourselves (see `connections`).
    clientTracking: false,
  });

  private sockets = new Set<Duplex>();

  private connections = new Set<WebSocketConnection>();

  private outputRequests = new Set<OutputRequest>();

  isHTTPS: boolean;

  port: Port;

  private dispatch: (msg: WebSocketServerMsg) => void;

  // Requests for outputs are dispatched instead of served right away, so that
  // they can wait for the output to be compiled. This is kept between restarts
  // (where the messages are queued), so that requests made while restarting
  // also wait.
  private resolveOutput: (
    absolutePath: AbsolutePath,
  ) => TargetName | undefined = () => undefined;

  private msgQueue: Array<WebSocketServerMsg> = [];

  listening: Promise<void>;

  private closed = false;

  constructor({
    createServer,
    getNow,
    portChoice,
    host,
    staticFilesDirectory,
    webSocketToken,
    allowedHosts,
    configSource,
  }: WebSocketServerOptions) {
    this.polyHttpServer = createServer({
      isAllowedHost: (request) =>
        checkHostHeader(allowedHosts, request.headers.host).tag === "Allowed",
      onRequest: (request, response) => {
        const hostCheck = checkHostHeader(allowedHosts, request.headers.host);
        if (hostCheck.tag !== "Allowed") {
          SimpleStaticFileServer.respondHtml(
            response,
            403,
            SimpleStaticFileServer.hostNotAllowedHtml(configSource, hostCheck),
          );
          return;
        }

        if (staticFilesDirectory !== undefined) {
          const serveStatic = (): void => {
            try {
              SimpleStaticFileServer.serveStatic(
                configSource,
                staticFilesDirectory,
              )(request, response);
            } catch (unknownError) {
              SimpleStaticFileServer.respondHtml(
                response,
                500,
                SimpleStaticFileServer.errorHtml(toError(unknownError).message),
              );
            }
          };
          const absolutePath = SimpleStaticFileServer.requestedFilePath(
            staticFilesDirectory,
            request,
          );
          const targetName =
            absolutePath === undefined
              ? undefined
              : this.resolveOutput(absolutePath);
          if (targetName === undefined) {
            serveStatic();
          } else if (!response.closed) {
            // (A custom `createServer` might call `onRequest` after the
            // browser has given up on the request already.)
            const outputRequest: OutputRequest = {
              targetName,
              priority: getNow().getTime(),
              serveFile: () => {
                this.outputRequests.delete(outputRequest);
                serveStatic();
              },
              serveJavaScript: (code) => {
                this.outputRequests.delete(outputRequest);
                SimpleStaticFileServer.respondJavaScript(
                  request,
                  response,
                  code,
                );
              },
            };
            this.outputRequests.add(outputRequest);
            response.once("close", () => {
              this.outputRequests.delete(outputRequest);
            });
            this.dispatch({ tag: "OutputRequested", outputRequest });
          }
        } else {
          SimpleStaticFileServer.respondHtml(
            response,
            200,
            SimpleStaticFileServer.staticFileNotEnabledHtml(configSource),
          );
        }
      },
      onUpgrade: (request, socket, head) => {
        // `request.url` is always a string here, but the types says it can be undefined:
        // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/15808
        const urlString = request.url ?? "/";

        const { origin } = request.headers;

        const hostCheck = checkHostHeader(allowedHosts, request.headers.host);
        if (hostCheck.tag !== "Allowed") {
          rejectUpgrade(socket, "403 Forbidden", "Host not allowed");
          this.dispatch({
            tag: "WebSocketConnectionRejected",
            origin,
            reason: { tag: "HostNotAllowed", rejectedHost: hostCheck },
          });
          return;
        }

        if (!urlString.startsWith(WEBSOCKET_URL_EXPECTED_START)) {
          rejectUpgrade(socket, "404 Not Found", "Invalid URL");
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

        const originCheck = checkOriginHeader(allowedHosts, origin);
        if (originCheck.tag !== "Allowed") {
          rejectUpgrade(socket, "403 Forbidden", "Origin not allowed");
          this.dispatch({
            tag: "WebSocketConnectionRejected",
            origin,
            reason: { tag: "OriginNotAllowed", rejectedHost: originCheck },
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
          rejectUpgrade(socket, "401 Unauthorized", "Invalid token");
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
            )[util.inspect.custom] = (_depth, options) =>
              options.stylize("WebSocket", "special");

            const connection: WebSocketConnection = {
              webSocket,
              urlParams,
              priority: getNow().getTime(),
            };
            this.connections.add(connection);

            this.dispatch({ tag: "WebSocketConnected", connection });

            webSocket.on("message", (data) => {
              this.dispatch({
                tag: "WebSocketMessageReceived",
                connection,
                data,
              });
            });

            webSocket.on("close", () => {
              this.connections.delete(connection);
            });

            // Errors for a single web socket (such as a client sending an
            // invalid frame) are followed by "close", so there’s nothing more
            // to do. Without a listener, the error would crash elm-watch.
            webSocket.on("error", () => {
              // Do nothing.
            });
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
              : { tag: "OtherError", error },
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

    // If `port` is 0, the operating system will assign an arbitrary unused port.
    const port = portChoice.tag === "NoPort" ? 0 : portChoice.port;

    if (host === LOOPBACK_IPV4) {
      probePort(port)
        .then((result) => {
          if (this.closed) {
            return;
          }
          switch (result.tag) {
            case "Free":
              this.polyHttpServer.listen(result.port, host);
              return;
            case "Error":
              this.polyHttpServer.emit("error", result.error);
              return;
          }
        })
        .catch((error: unknown) => {
          this.polyHttpServer.emit("error", toError(error));
        });
    } else {
      this.polyHttpServer.listen(port, host);
    }
  }

  getConnections(): ReadonlySet<WebSocketConnection> {
    return this.connections;
  }

  dispatchToQueue = (msg: WebSocketServerMsg): void => {
    this.msgQueue.push(msg);
  };

  setDispatch(dispatch: (msg: WebSocketServerMsg) => void): void {
    this.dispatch = dispatch;
    // Messages received while restarting (for example when elm.json changes)
    // are queued, and replayed here. Clear the queue so the messages aren’t
    // replayed again on the next `setDispatch`. Replay them in a microtask,
    // since the caller might not be ready to receive messages until
    // `setDispatch` returns. Use `this.dispatch` in case `unsetDispatch` is
    // called before then (re-queueing the messages).
    const { msgQueue } = this;
    this.msgQueue = [];
    if (msgQueue.length > 0) {
      queueMicrotask(() => {
        for (const msg of msgQueue) {
          this.dispatch(msg);
        }
      });
    }
  }

  // Requests not yet responded to, and not given up on by the browser.
  getOutputRequests(): ReadonlySet<OutputRequest> {
    return this.outputRequests;
  }

  setResolveOutput(
    resolveOutput: (absolutePath: AbsolutePath) => TargetName | undefined,
  ): void {
    this.resolveOutput = resolveOutput;
  }

  unsetDispatch(): void {
    this.dispatch = this.dispatchToQueue;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.unsetDispatch();
    // Since ws 8, this does not close existing web sockets, but destroying
    // all sockets below does (including the ones upgraded to web sockets).
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
  }
}

// The server is kept between restarts (unless elm-watch.json changes), so that
// browsers stay connected. This owns it across restarts, so that it is closed
// when elm-watch exits, no matter how.
export class WebSocketServerHolder {
  private server: WebSocketServer | undefined = undefined;

  getOrCreate(options: WebSocketServerOptions): {
    server: WebSocketServer;
    isNew: boolean;
  } {
    if (this.server !== undefined) {
      return { server: this.server, isNew: false };
    }
    this.server = new WebSocketServer(options);
    return { server: this.server, isNew: true };
  }

  async close(): Promise<void> {
    const { server } = this;
    this.server = undefined;
    await server?.close();
  }
}

const LOOPBACK_IPV4 = "127.0.0.1";

type ProbeResult =
  | { tag: "Free"; port: number }
  | { tag: "Error"; error: NodeJS.ErrnoException };

// On macOS (and possibly Windows), listening on 127.0.0.1 succeeds even if
// another program already listens on the same port on 0.0.0.0 or `::` (which is
// the default for Node.js servers), or on ::1. Then we wouldn’t get a port
// conflict error, and `localhost` could go to the other program. To detect such
// conflicts, briefly listen on 0.0.0.0 and ::1 first. (Listening on 0.0.0.0
// fails if another program listens on 0.0.0.0 or `::`.) The actual listening
// on 127.0.0.1 then catches conflicts with programs listening on 127.0.0.1.
async function probePort(port: number): Promise<ProbeResult> {
  const result = await probe(port, "0.0.0.0");
  switch (result.tag) {
    case "Error":
      return result;
    case "Free": {
      const ipv6Result = await probe(result.port, "::1");
      return ipv6Result.tag === "Error" &&
        // IPv6 might not be available.
        (ipv6Result.error.code === "EADDRNOTAVAIL" ||
          ipv6Result.error.code === "EAFNOSUPPORT")
        ? result
        : ipv6Result;
    }
  }
}

async function probe(port: number, host: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve({ tag: "Error", error });
    });
    server.listen(port, host, () => {
      const address = server.address() as AddressInfo;
      server.close(() => {
        resolve({ tag: "Free", port: address.port });
      });
    });
  });
}

function rejectUpgrade(
  socket: Duplex,
  status: "401 Unauthorized" | "403 Forbidden" | "404 Not Found",
  message: string,
): void {
  socket.write(`HTTP/1.1 ${status}\r\nX-Reason: ${message}\r\n\r\n`);
  socket.destroy();
}
