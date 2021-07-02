import WebSocket from "ws";

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
    };

export class WebSocketServer {
  webSocketServer: WebSocket.Server;

  port: number;

  dispatch: (msg: WebSocketServerMsg) => void;

  msgQueue: Array<WebSocketServerMsg> = [];

  constructor({
    port,
    rejectPromise,
  }: {
    port: number;
    rejectPromise: (error: Error) => void;
  }) {
    this.webSocketServer = new WebSocket.Server({ port });
    this.port = (this.webSocketServer.address() as WebSocket.AddressInfo).port;
    this.dispatch = this.dispatchToQueue;

    this.webSocketServer.on("connection", (webSocket, request) => {
      this.dispatch({
        tag: "WebSocketConnected",
        webSocket,
        // `request.url` is always a string here, but the types says it can be undefined:
        // https://github.com/DefinitelyTyped/DefinitelyTyped/issues/15808
        urlString: request.url ?? "/",
      });

      webSocket.on("message", (data) => {
        this.dispatch({ tag: "WebSocketMessageReceived", webSocket, data });
      });

      webSocket.on("close", () => {
        this.dispatch({ tag: "WebSocketClosed", webSocket });
      });

      webSocket.on("error", rejectPromise);
    });

    this.webSocketServer.on("error", rejectPromise);
  }

  dispatchToQueue = (msg: WebSocketServerMsg): void => {
    this.msgQueue.push(msg);
  };

  setDispatch(dispatch: (msg: WebSocketServerMsg) => void): void {
    this.dispatch = dispatch;
    for (const msg of this.msgQueue) {
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
        if (error === undefined) {
          resolve();
        } else {
          reject(error);
        }
      });
    });
  }
}
