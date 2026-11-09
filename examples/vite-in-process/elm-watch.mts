// Node.js runs this TypeScript file directly, by stripping the types.
import * as http from "node:http";
import { parseArgs } from "node:util";
import { elmWatch, type Postprocess } from "elm-watch";
import { minify } from "rolldown/utils";
import * as vite from "vite";

// Usage:
//
//     node --watch elm-watch.mts hot
//     node elm-watch.mts make --optimize
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

const viteConfig: vite.InlineConfig = {
  root: import.meta.dirname,
  // No vite.config.ts – everything is in this file.
  configFile: false,
  // Vite’s `publicDir` is `public/` by default. That’s also where elm-watch
  // writes the compiled Elm code. Vite copies `public/` as-is to `dist/` when
  // building for production.
  publicDir: "public",
};

// Vite and elm-watch share this server.
const httpServer = http.createServer();

// In hot mode, run Vite’s dev server in middleware mode: Instead of starting
// its own server, it gives us a request handler that we use for all requests
// that aren’t for elm-watch.
const viteDevServer =
  runMode === "hot"
    ? await vite.createServer({
        ...viteConfig,
        appType: "spa",
        // elm-watch owns the terminal: It clears the screen and moves the
        // cursor around to update its output. If Vite printed to the terminal
        // too, the two would mess each other up. So Vite is silent. Vite shows
        // errors in the browser anyway.
        logLevel: "silent",
        server: {
          middlewareMode: true,
          // Vite’s hot reloading WebSocket uses the same server, too.
          hmr: { server: httpServer },
          // elm-watch hot reloads the Elm code. Vite should not react to it.
          watch: { ignored: ["**/public/build/**"] },
        },
      })
    : undefined;

// Minify the Elm code in optimize mode. Vite uses rolldown for bundling, and
// it comes with a minifier.
const postprocess: Postprocess = async (code, { compilationMode }) =>
  compilationMode === "optimize" ? (await minify("main.js", code)).code : code;

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode,
  compilationMode: values.optimize
    ? "optimize"
    : values.debug
      ? "debug"
      : "standard",
  // Lets elm-watch serve the compiled Elm code (see below).
  staticFilesDir: "public",
  targets: [
    {
      type: "application",
      name: "Main",
      elmJson: "elm.json",
      inputs: ["src/Main.elm"],
      output: "public/build/main.js",
      postprocess,
    },
  ],
  createServer: ({ onRequest, onUpgrade, isAllowedHost }) =>
    httpServer
      .on("request", (request, response) => {
        if (
          viteDevServer === undefined ||
          request.url?.startsWith("/build/") === true ||
          !isAllowedHost(request)
        ) {
          // elm-watch serves the compiled Elm code exactly as is (Vite would
          // inject code into it), and waits for compilation to finish if
          // needed. It also responds with an error page for hosts that aren’t
          // allowed.
          onRequest(request, response);
        } else {
          // Vite serves everything else: index.html, TypeScript, CSS, etc.
          viteDevServer.middlewares(request, response);
        }
      })
      .on("upgrade", (request, socket, head) => {
        // Vite handles its own WebSocket connections (via `hmr.server` above).
        if (request.url?.startsWith("/elm-watch?") === true) {
          onUpgrade(request, socket, head);
        }
      }),
});

await viteDevServer?.close();

// In make mode, let Vite build for production after elm-watch is done. Then
// nobody else is using the terminal, so Vite can print to it as usual.
if (runMode === "make" && process.exitCode === 0) {
  await vite.build(viteConfig);
}
