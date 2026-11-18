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

// Other devices, like your phone, can’t resolve admin.localhost, and subdomains
// don’t work with IP addresses. So for testing on other devices
// (ELM_WATCH_HOST=0.0.0.0), the admin site is also served on its own port. The
// main site is the default on elm-watch’s port.
const ADMIN_PORT = 8001;

// Listen on the same host as elm-watch.
const host = process.env["ELM_WATCH_HOST"] || "127.0.0.1";

/** @type {http.Server | undefined} */
let adminServer;

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode,
  compilationMode: values.optimize
    ? "optimize"
    : values.debug
      ? "debug"
      : "standard",
  serve: "public",
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
  createServer: ({ onRequest, onUpgrade }) => {
    adminServer = http
      .createServer((request, response) => {
        request.url = `/admin${request.url}`;
        onRequest(request, response);
      })
      .listen(ADMIN_PORT, host);

    return http
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
      .on("upgrade", onUpgrade);
  },
  // Print links to both sites: Via subdomains on your computer, and via ports
  // on the network.
  serverLinks: ({ local, network }) => {
    const admin = new URL(local);
    admin.hostname = `admin.${local.hostname}`;
    return [
      local,
      admin,
      ...network.flatMap((url) => {
        const networkAdmin = new URL(url);
        networkAdmin.port = String(ADMIN_PORT);
        return [url, networkAdmin];
      }),
    ];
  },
});

adminServer?.close();
