// @ts-check
import * as http from "node:http";
import { parseArgs } from "node:util";
import { elmWatch } from "elm-watch";

// Usage:
//
//     node --watch elm-watch.mjs hot
//     node elm-watch.mjs make --optimize
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    debug: { type: "boolean", default: false },
    optimize: { type: "boolean", default: false },
  },
});

const [runMode = "hot"] = positionals;

if (runMode !== "hot" && runMode !== "make") {
  console.error(`Expected "hot" or "make", but got: ${runMode}`);
  process.exit(1);
}

// Where backend.js runs.
const BACKEND_PORT = 9000;

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode,
  compilationMode: values.optimize
    ? "optimize"
    : values.debug
      ? "debug"
      : "standard",
  // Serves `public/`. For URLs that aren’t files, `public/index.html` is
  // served, so that reloading the page works in `Browser.application`.
  staticFilesDir: "public",
  targets: [
    {
      type: "application",
      name: "Main",
      elmJson: "elm.json",
      inputs: ["src/Main.elm"],
      output: "public/build/main.js",
    },
  ],
  createServer: ({ onRequest, onUpgrade, isAllowedHost }) =>
    http
      .createServer((request, response) => {
        if (request.url?.startsWith("/api/") && isAllowedHost(request)) {
          proxy(request, response, BACKEND_PORT);
        } else {
          // Let elm-watch’s server do its thing for all other URLs.
          onRequest(request, response);
        }
      })
      .on("upgrade", onUpgrade),
});

/**
 * Forwards a request to a server on localhost, and pipes back the response.
 * This is all it takes to proxy, without any dependencies.
 *
 * @param {http.IncomingMessage} request
 * @param {http.ServerResponse} response
 * @param {number} port
 */
function proxy(request, response, port) {
  const proxyRequest = http.request(
    {
      hostname: "127.0.0.1",
      port,
      path: request.url,
      method: request.method,
      headers: request.headers,
    },
    (proxyResponse) => {
      response.writeHead(
        proxyResponse.statusCode ?? 502,
        proxyResponse.headers,
      );
      proxyResponse.pipe(response, { end: true });
    },
  );

  proxyRequest.on("error", (error) => {
    response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(
      `Failed to proxy to 127.0.0.1:${port}. Is the backend running?\n\n${error.stack}`,
    );
  });

  request.pipe(proxyRequest, { end: true });
}
