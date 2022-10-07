import * as http from "http";
import * as https from "https";
import * as net from "net";
import type { Duplex } from "stream";
import * as util from "util";
import WebSocket, { Server as WsServer } from "ws";

import { CERTIFICATE } from "./Certificate";
import { Port, PortChoice } from "./Port";

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

        const byte = buffer[0];

        // TODO: Just check 22 and always use http otherwise?
        const server =
          byte === 22
            ? this.https
            : byte !== undefined && byte > 32 && byte < 127
            ? this.http
            : undefined;

        if (server !== undefined) {
          socket.unshift(buffer);
          server.emit("connection", socket);
        }

        // TODO: Test if nextTick is needed.
        process.nextTick(() => socket.resume());
      });
    });
  }

  listen(port: number): void {
    this.net.listen(port);
  }

  close(callback: (err?: Error) => void): void {
    this.net.close(callback);
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

  constructor(portChoice: PortChoice) {
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
      response.end(html(isHttps, request));
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
    return new Promise((resolve, reject) => {
      // This terminates all connections.
      this.webSocketServer.close();
      this.polyHttpServer.close((error) => {
        // istanbul ignore else
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
      for (const webSocket of this.webSocketServer.clients) {
        webSocket.close();
      }
    });
  }
}

function html(isHttps: boolean, request: http.IncomingMessage): string {
  const { host, referer } = request.headers;
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>elm-watch</title>
    <style>
      html {
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <p>ℹ️ This is the elm-watch Web Socket server.</p>
    ${
      request.url === "/accept"
        ? isHttps
          ? `<p>✅ Certificate accepted. You may now ${maybeLink(
              referer !== undefined && new URL(referer).host !== host
                ? referer
                : undefined,
              "return to your page"
            )}.</p>`
          : `<p>Did you mean to go to the ${maybeLink(
              host !== undefined ? `https://${host}${request.url}` : undefined,
              "HTTPS version of this page"
            )} to accept elm-watch’s self-signed certificate?</p>`
        : ""
    }
  </body>
</html>
  `.trim();
}

function maybeLink(href: string | undefined, text: string): string {
  return href === undefined ? text : `<a href="${href}">${text}</a>`;
}
