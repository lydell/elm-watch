import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as path from "path";
import type { Duplex } from "stream";
import * as util from "util";
import WebSocket, { Server as WsServer } from "ws";

import { CERTIFICATE } from "./Certificate";
import { join, toError } from "./Helpers";
import { absoluteDirname } from "./PathHelpers";
import { Port, PortChoice } from "./Port";
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
      if (request.method === "GET" && request.url === "/accept") {
        response.writeHead(200, { "Content-Type": "text/html" });
        response.end(acceptHtmlPage(isHttps, request));
      } else {
        try {
          simpleStaticFileServer(elmWatchJsonPath)(request, response);
        } catch (unknownError) {
          const error = toError(unknownError);
          response.writeHead(500);
          response.end(error.message);
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

function baseHtml(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} - elm-watch</title>
    <style>
      html {
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    ${body.trim()}
    <hr />
    <p>ℹ️ This is the elm-watch WebSocket and simple HTTP server.</p>
  </body>
</html>
  `.trim();
}

function indexHtml(url: string, entries: Array<fs.Dirent>): string {
  return baseHtml(
    url,
    // TODO: esbuild new version is much nicer
    `
<h1>${escapeHtml(url)}</h1>
<ul>
${url === "/" ? "" : `<li><a href="..">..</a></li>`}
${join(
  entries.map(
    (entry) =>
      `<li><a href="${escapeHtml(entry.name)}">${escapeHtml(
        entry.name
      )}</a></li>`
  ),
  "\n"
)}
</ul>
  `
  );
}

function escapeHtml(string: string): string {
  return string.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        throw new Error(`Unexpected escapeHtml character: ${match}`);
    }
  });
}

function acceptHtmlPage(
  isHttps: boolean,
  request: http.IncomingMessage
): string {
  const { host, referer } = request.headers;
  return baseHtml(
    "Certificate",
    isHttps
      ? `<p>✅ Certificate accepted. You may now ${maybeLink(
          referer !== undefined && new URL(referer).host !== host
            ? referer
            : undefined,
          "return to your page"
        )}.</p>`
      : `<p>Did you mean to go to the ${maybeLink(
          host !== undefined && request.url !== undefined
            ? `https://${host}${request.url}`
            : undefined,
          "HTTPS version of this page"
        )} to accept elm-watch's self-signed certificate?</p>`
  );
}

function maybeLink(href: string | undefined, text: string): string {
  return href === undefined ? text : `<a href="${href}">${text}</a>`;
}

// Note: This function may throw file system errors.
function simpleStaticFileServer(
  elmWatchJsonPath: ElmWatchJsonPath
): http.RequestListener {
  return (request, response) => {
    switch (request.method) {
      // TODO: Don’t send body for HEAD.
      case "HEAD":
      case "GET": {
        // In my testing:
        // - `request.url` always starts with a `/`.
        // - Never contains `../` or `./` – those have already been resolved somewhere.
        // - Mixing backslash and forward slash works fine on Windows.
        const { url = "/" } = request;
        const fsPath =
          absoluteDirname(elmWatchJsonPath.theElmWatchJsonPath).absolutePath +
          url;

        switch (statSync(fsPath)) {
          case "NotFound":
            // TODO: Add HTML to response.
            response.writeHead(404);
            response.end();
            break;

          case "File":
            serveFile(fsPath)(request, response);
            break;

          case "Directory":
            if (url.endsWith("/")) {
              const indexFile = `${fsPath}index.html`;
              switch (statSync(indexFile)) {
                case "File":
                  serveFile(indexFile)(request, response);
                  break;

                case "Directory":
                case "Other":
                case "NotFound": {
                  const entries = fs.readdirSync(fsPath, {
                    withFileTypes: true,
                  });
                  response.writeHead(200, { "Content-Type": "text/html" });
                  response.end(indexHtml(url, entries));
                  break;
                }
              }
            } else {
              response.writeHead(302, { Location: `${url}/` });
              response.end();
            }
            break;

          case "Other":
            // TODO: Add HTML to response.
            response.writeHead(404);
            response.end();
        }
        break;
      }

      default:
        // TODO: Add HTML to response.
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        break;
    }
  };
}

function statSync(fsPath: string): "Directory" | "File" | "NotFound" | "Other" {
  try {
    const stats = fs.statSync(fsPath);
    return stats.isFile()
      ? "File"
      : stats.isDirectory()
      ? "Directory"
      : "Other";
  } catch (unknownError) {
    const error = toError(unknownError);
    if (error.code === "ENOENT") {
      return "NotFound";
    }
    throw error;
  }
}

// Copied from: https://github.com/evanw/esbuild/blob/52110fd09322af7c8ac22e011f64093e53765004/internal/helpers/mime.go#L5-L39
const MIME_TYPES: Record<string, string> = {
  // Text
  ".css": "text/css; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".xhtml": "application/xhtml+xml; charset=utf-8",
  ".xml": "text/xml; charset=utf-8",

  // Images
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",

  // Fonts
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "font/otf",
  ".sfnt": "font/sfnt",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",

  // Other
  ".pdf": "application/pdf",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

function serveFile(fsPath: string): http.RequestListener {
  return (_request, response) => {
    const readStream = fs.createReadStream(fsPath);
    readStream.on("error", (error) => {
      response.writeHead(500);
      response.end(error.message);
    });
    readStream.on("open", () => {
      response.writeHead(200, {
        "Content-Type":
          MIME_TYPES[path.extname(fsPath).toLowerCase()] ??
          "application/octet-stream",
      });
    });
    readStream.pipe(response, { end: true });
  };
}
