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

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode,
  compilationMode: values.optimize
    ? "optimize"
    : values.debug
      ? "debug"
      : "standard",
  staticFilesDir: "public",
  targets: [
    {
      type: "application",
      name: "Main",
      elmJson: "elm.json",
      inputs: ["src/Main.elm"],
      output: "public/main/build/main.js",
    },
    {
      type: "application",
      name: "Admin",
      elmJson: "elm.json",
      inputs: ["src/Admin.elm"],
      output: "public/admin/build/admin.js",
    },
  ],
  createServer: ({ onRequest, onUpgrade }) =>
    http
      .createServer((request, response) => {
        // Each site has its own folder in `public/`. Serve the folder for the
        // host of the request, by putting the folder name first in the URL:
        // http://admin.localhost:8000/users -> public/admin/users
        // http://localhost:8000/about -> public/main/about
        // For URLs that aren’t files, elm-watch’s server then serves the
        // closest index.html, which is the one in the site’s folder.
        const site = request.headers.host?.startsWith("admin.localhost:")
          ? "admin"
          : "main";
        request.url = `/${site}${request.url}`;
        onRequest(request, response);
      })
      .on("upgrade", onUpgrade),
});
