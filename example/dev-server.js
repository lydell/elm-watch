import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as net from "net";
import * as path from "path";
import { fileURLToPath } from "url";

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

if (process.argv.length !== 3) {
  console.error(
    "You must pass a valid port where `esbuild --serve=XXXX` runs."
  );
  process.exit(1);
}

const DEV_SERVER_PORT = 8000;
const ESBUILD_PORT = process.argv[2];

const servers = [
  {
    port: 8001,
    subdomain: "application",
    serve: (req, res, log) => {
      serveWithEsbuild(
        req,
        res,
        log,
        looksLikeFile(req.url) ? req.url : "/ApplicationMain.html"
      );
    },
  },
  {
    port: 8002,
    subdomain: "azimutt",
    serve: (req, res, log) => {
      serveWithEsbuild(
        req,
        res,
        log,
        looksLikeFile(req.url)
          ? `/submodules/azimutt/public${req.url}`
          : "/submodules/azimutt/public/index.html"
      );
    },
  },
  {
    port: 8003,
    subdomain: "concourse",
    serve: (req, res, log) => {
      if (req.url.startsWith("/api/")) {
        proxyToWeb(req, res, log, "ci.concourse-ci.org");
      } else {
        serveWithEsbuild(
          req,
          res,
          log,
          looksLikeFile(req.url)
            ? `/submodules/concourse/web${req.url}`
            : "/submodules/concourse/web/public/index.html"
        );
      }
    },
  },
  {
    port: 8004,
    subdomain: "elm-spa-example",
    serve: (req, res, log) => {
      serveWithEsbuild(
        req,
        res,
        log,
        looksLikeFile(req.url)
          ? `/submodules/elm-spa-example${req.url}`
          : "/submodules/elm-spa-example/index.html"
      );
    },
  },
  {
    port: 8005,
    subdomain: "kite",
    serve: (req, res, log) => {
      serveWithEsbuild(
        req,
        res,
        log,
        looksLikeFile(req.url)
          ? `/submodules/kite${req.url}`
          : "/submodules/kite/src/index.html"
      );
    },
  },
  {
    port: 8006,
    subdomain: "seeds",
    serve: (req, res, log) => {
      serveWithEsbuild(
        req,
        res,
        log,
        req.url.startsWith("/build/")
          ? req.url
          : req.url.startsWith("/esbuild/")
          ? `/build/public/submodules/seeds-game/src/${req.url.replace(
              "/esbuild/",
              ""
            )}`
          : looksLikeFile(req.url)
          ? `/submodules/seeds-game${req.url}`
          : "/submodules/seeds-game/src/index.html"
      );
    },
  },
  {
    port: 8007,
    subdomain: "unison.share",
    serve: (req, res, log) => {
      if (req.url.startsWith("/api/")) {
        proxyToWeb(req, res, log, "share.unison-lang.org");
      } else {
        serveWithEsbuild(
          req,
          res,
          log,
          req.url.startsWith("/build/")
            ? req.url
            : req.url.startsWith("/esbuild/")
            ? `/build/public/submodules/codebase-ui/src/${req.url.replace(
                "/esbuild/",
                ""
              )}`
            : looksLikeFile(req.url)
            ? `/submodules/codebase-ui${req.url}`
            : "/submodules/codebase-ui/src/unisonShare.html"
        );
      }
    },
  },
  {
    port: 8008,
    subdomain: "application-cached",
    serve: (req, res, log) => {
      res.setHeader("cache-control", "max-age=3600");
      serveWithEsbuild(
        req,
        res,
        log,
        looksLikeFile(req.url) ? req.url : "/ApplicationMain.html"
      );
    },
  },
];

function serveWithEsbuild(req, res, log, newUrl) {
  if (req.url === newUrl) {
    proxyToEsbuild(req, res, log);
  } else {
    req.url = newUrl;
    proxyToEsbuild(req, res, (...args) => log(`-> ${newUrl}`, ...args));
  }
}

function looksLikeFile(url) {
  return /\.\w+(\?.*)?$/.test(url);
}

function proxyToEsbuild(req, res, log) {
  const options = {
    // Using 127.0.0.1 rather than localhost because of:
    // https://github.com/nodejs/node/issues/40702#issuecomment-1103623246
    hostname: "127.0.0.1",
    port: ESBUILD_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const { statusCode } = proxyRes;
    log(`-> esbuild`, statusCode === 503 ? "ERROR" : statusCode);
    res.writeHead(statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (error) => {
    log(503);
    res.writeHead(503);
    res.end(
      `Failed to proxy to esbuild on port ${ESBUILD_PORT}. Is it not running?\n\n${error.stack}`
    );
  });

  req.pipe(proxyReq, { end: true });
}

function proxyToWeb(req, res, log, hostname) {
  const options = {
    hostname,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: hostname },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    const { statusCode } = proxyRes;
    log(`-> ${hostname}`, statusCode);
    res.writeHead(statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (error) => {
    log(503);
    res.writeHead(503);
    res.end(`Failed to proxy to ${hostname}. Is it down?\n\n${error.stack}`);
  });

  req.pipe(proxyReq, { end: true });
}

const LOOKS_LIKE_IP_ADDRESS = /^(\d+\.\d+\.\d+\.\d+):\d+$/;

function indexPage(host = "", userAgent = "", url = "/", isHttps = false) {
  // On mobile you go to http://192.168.x.x instead of http://localhost.
  // There, link to the different ports since subdomains cannot be used
  // with IP addresses.
  // Also do that in Safari because it does not support subdomains on localhost:
  // https://bugs.webkit.org/show_bug.cgi?id=160504
  const match = LOOKS_LIKE_IP_ADDRESS.exec(host);
  const isSafari =
    userAgent !== undefined &&
    userAgent.includes("Safari") &&
    !userAgent.includes("Chrome");
  const boringHost =
    match !== null ? match[1] : isSafari ? "localhost" : undefined;
  const protocol = isHttps ? "https" : "http";

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Index</title>
    <style>
      html {
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <p>ℹ️ Nothing is served directly on: <code>${escapeHtml(host)}</code></p>
    <p>💡 Try one of these:</p>
    <ul>
      ${servers
        .map((serverConfig) => {
          const [href, title] =
            boringHost === undefined
              ? [
                  `${protocol}://${
                    serverConfig.subdomain
                  }.localhost:${DEV_SERVER_PORT}${escapeHtml(url)}`,
                  `${serverConfig.subdomain}.localhost:${DEV_SERVER_PORT}`,
                ]
              : [
                  `${protocol}://${boringHost}:${serverConfig.port}${escapeHtml(
                    url
                  )}`,
                  `${serverConfig.subdomain}: ${boringHost}:${serverConfig.port}`,
                ];
          return `
            <li>
              <a href="${href}">${title}</a>
            </li>
          `.trim();
        })
        .join("\n")}
    </ul>
  </body>
</html>
  `.trim();
}

function escapeHtml(string) {
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

function makeLog(req) {
  const startTime = new Date();
  const originalRequest = `${req.method} ${req.headers.host} ${req.url}`;
  return (...args) => {
    console.info(
      formatTime(startTime),
      originalRequest,
      ...args,
      "|",
      Date.now() - startTime.getTime(),
      "ms"
    );
  };
}

function formatTime(date) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((number) => number.toString().padStart(2, "0"))
    .join(":");
}

const CERTIFICATE = {
  key: fs.readFileSync(path.join(DIRNAME, "certificate", "dev.key")),
  cert: fs.readFileSync(path.join(DIRNAME, "certificate", "dev.crt")),
};

// This serves both on HTTP and HTTPS for testing.
// In a real project, I recommend using `http.createServer` instead of this function.
// Inspired by: https://stackoverflow.com/a/42019773
function createServer(handler) {
  const netServer = net.createServer();
  const httpServer = http.createServer(handler);
  const httpsServer = https.createServer(CERTIFICATE, handler);

  netServer.on("connection", (socket) => {
    socket.once("data", (buffer) => {
      socket.pause();
      const server = buffer[0] === 22 ? httpsServer : httpServer;
      socket.unshift(buffer);
      server.emit("connection", socket);
      server.on("close", () => {
        socket.destroy();
      });
      process.nextTick(() => socket.resume());
    });
  });

  return netServer;
}

// These servers are needed when testing on mobile: You can’t use localhost
// there, so you need to type in your IP address. Then it’s not possible to
// have subdomains, so we need servers on different ports.
for (const serverConfig of servers) {
  const server = createServer((req, res) => {
    serverConfig.serve(req, res, makeLog(req));
  });
  server.listen(serverConfig.port);
}

// This server lets you access all apps from one place.
const convenienceServer = createServer((req, res) => {
  const { host } = req.headers;
  const log = makeLog(req);

  const serverConfig = servers.find(
    (serverConfig) =>
      host === `${serverConfig.subdomain}.localhost:${DEV_SERVER_PORT}`
  );
  if (serverConfig === undefined) {
    log(404);
    res.writeHead(404);
    res.end(
      indexPage(host, req.headers["user-agent"], req.url, req.socket.encrypted)
    );
  } else {
    serverConfig.serve(req, res, log);
  }
});

convenienceServer.listen(DEV_SERVER_PORT, () => {
  console.log("Server ready at:");
  console.log(`http://localhost:${DEV_SERVER_PORT}`);
  console.log(`https://localhost:${DEV_SERVER_PORT}`);
});
