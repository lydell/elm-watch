import * as http from "http";
import * as https from "https";
import * as net from "net";
import type { Duplex } from "stream";
import * as util from "util";
import WebSocket, { Server as WsServer } from "ws";

import { CERTIFICATE } from "./Certificate";
import { toError } from "./Helpers";
import { Port, PortChoice } from "./Port";
import * as SimpleStaticFileServer from "./SimpleStaticFileServer";
import { ElmWatchJsonPath } from "./Types";

export type WebSocketServerMsg =
  | {
      tag: "WebSocketClosed";
      webSocket: WebSocket;
    }
  | {
      tag: "WebSocketConnected";
      webSocket: WebSocket;
      urlString: string;
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
      tag: "OtherError";
      error: Error;
    }
  | {
      tag: "PortConflict";
      portChoice: PortChoice;
      error: Error;
    };

// Inspired by: https://stackoverflow.com/a/42019773
class PolyHttpServer {
  private net = net.createServer();

  private http = http.createServer();

  private https = https.createServer(CERTIFICATE);

  constructor() {
    this.net.on("connection", (socket) => {
      socket.once("data", (buffer) => {
        socket.pause();
        const server = buffer[0] === 22 ? this.https : this.http;
        socket.unshift(buffer);
        server.emit("connection", socket);
        server.on("close", () => {
          socket.destroy();
        });
        process.nextTick(() => socket.resume());
      });
    });
  }

  listen(port: number): void {
    this.net.listen(port);
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      let numClosed = 0;
      const callback = (
        error: (Error & { code?: string }) | undefined
      ): void => {
        numClosed++;
        // istanbul ignore if
        if (error !== undefined && error.code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error);
        } else if (numClosed === 3) {
          resolve();
        }
      };
      this.net.close(callback);
      this.http.close(callback);
      this.https.close(callback);
    });
  }

  onRequest(listener: (isHttps: boolean) => http.RequestListener): void {
    this.http.on("request", listener(false));
    this.https.on("request", listener(true));
  }

  onUpgrade(
    listener: (
      req: InstanceType<typeof http.IncomingMessage>,
      socket: Duplex,
      head: Buffer
    ) => void
  ): void {
    this.http.on("upgrade", listener);
    this.https.on("upgrade", listener);
  }

  onError(listener: (error: Error & { code?: string }) => void): void {
    this.net.on("error", listener);
    this.http.on("error", listener);
    this.https.on("error", listener);
  }

  onceListening(listener: (address: net.AddressInfo) => void): void {
    this.net.once("listening", () => {
      listener(this.net.address() as net.AddressInfo);
    });
  }
}

export class WebSocketServer {
  private polyHttpServer = new PolyHttpServer();

  private webSocketServer = new WsServer({ noServer: true });

  port: Port;

  private dispatch: (msg: WebSocketServerMsg) => void;

  private msgQueue: Array<WebSocketServerMsg> = [];

  listening: Promise<void>;

  constructor(portChoice: PortChoice, elmWatchJsonPath: ElmWatchJsonPath) {
    this.dispatch = this.dispatchToQueue;

    this.webSocketServer.on("connection", (webSocket, request) => {
      (
        webSocket as WebSocket & {
          [util.inspect.custom]: util.CustomInspectFunction;
        }
      )[util.inspect.custom] =
        // istanbul ignore next
        (_depth, options) => options.stylize("WebSocket", "special");

      this.dispatch({
        tag: "WebSocketConnected",
        webSocket,
        // `request.url` is always a string here, but the types says it can be undefined:
        // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/15808
        urlString:
          // istanbul ignore next
          request.url ?? "/",
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

      // istanbul ignore next
      webSocket.on("error", (error) => {
        this.dispatch({
          tag: "WebSocketServerError",
          error: { tag: "OtherError", error },
        });
      });
    });

    this.polyHttpServer.onError((error) => {
      this.dispatch({
        tag: "WebSocketServerError",
        error:
          error.code === "EADDRINUSE"
            ? { tag: "PortConflict", portChoice, error }
            : // istanbul ignore next
              { tag: "OtherError", error },
      });
    });

    this.polyHttpServer.onRequest((isHttps) => (request, response) => {
      // Copied from: https://github.com/nodejs/node/issues/2642#issuecomment-1427461414
      // Otherwise `httpServer.close()` never finishes (it waits for open connections).
      response.on("finish", () => {
        request.socket.destroy();
      });
      if (request.method === "GET" && request.url === "/accept") {
        SimpleStaticFileServer.respondHtml(
          response,
          200,
          SimpleStaticFileServer.acceptHtml(isHttps, request)
        );
      } else {
        try {
          SimpleStaticFileServer.serveStatic(elmWatchJsonPath)(
            request,
            response
          );
        } catch (unknownError) {
          SimpleStaticFileServer.respondHtml(
            response,
            500,
            SimpleStaticFileServer.errorHtml(toError(unknownError).message)
          );
        }
      }
    });

    this.polyHttpServer.onUpgrade((request, socket, head) => {
      this.webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.webSocketServer.emit("connection", webSocket, request);
      });
    });

    this.port = { tag: "Port", thePort: 0 };
    this.listening = new Promise((resolve) => {
      this.polyHttpServer.onceListening((address) => {
        this.port.thePort = address.port;
        resolve();
      });
    });

    this.polyHttpServer.listen(
      // If `port` is 0, the operating system will assign an arbitrary unused port.
      portChoice.tag === "NoPort" ? 0 : portChoice.port.thePort
    );
  }

  dispatchToQueue = (msg: WebSocketServerMsg): void => {
    this.msgQueue.push(msg);
  };

  setDispatch(dispatch: (msg: WebSocketServerMsg) => void): void {
    this.dispatch = dispatch;
    for (const msg of this.msgQueue) {
      // When testing, a change to elm.json gives a 5 ms room where queueing is needed.
      // That’s very unlikely to even be needed, and very hard to test.
      // istanbul ignore next
      dispatch(msg);
    }
  }

  unsetDispatch(): void {
    this.dispatch = this.dispatchToQueue;
  }

  async close(): Promise<void> {
    this.unsetDispatch();
    // This terminates all connections.
    this.webSocketServer.close();
    await this.polyHttpServer.close();
    for (const webSocket of this.webSocketServer.clients) {
      webSocket.close();
    }
  }
}
