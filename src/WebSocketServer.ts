import * as util from "util";
import WebSocket, { Server as WsServer } from "ws";

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

export class WebSocketServer {
  private webSocketServer: WsServer;

  port: Port;

  private dispatch: (msg: WebSocketServerMsg) => void;

  private msgQueue: Array<WebSocketServerMsg> = [];

  listening: Promise<void>;

  constructor(portChoice: PortChoice) {
    this.dispatch = this.dispatchToQueue;

    this.webSocketServer = new WsServer({
      // If `port` is 0, the operating system will assign an arbitrary unused port.
      port: portChoice.tag === "NoPort" ? 0 : portChoice.port.thePort,
    });

    this.port = { tag: "Port", thePort: 0 };
    this.listening = new Promise((resolve) => {
      this.webSocketServer.once("listening", () => {
        const { port } =
          this.webSocketServer.address() as WebSocket.AddressInfo;
        this.port.thePort = port;
        resolve();
      });
    });

    this.webSocketServer.on("connection", (webSocket, request) => {
      (
        webSocket as WebSocket & {
          [util.inspect.custom]: util.CustomInspectFunction;
        }
      )[util.inspect.custom] = (_depth, options) =>
        options.stylize("WebSocket", "special");

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

    this.webSocketServer.on("error", (error: Error & { code?: string }) => {
      this.dispatch({
        tag: "WebSocketServerError",
        error:
          error.code === "EADDRINUSE"
            ? { tag: "PortConflict", portChoice, error }
            : // istanbul ignore next
              { tag: "OtherError", error },
      });
    });
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
      // This terminates all connections and closes the server.
      this.webSocketServer.close((error) => {
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
