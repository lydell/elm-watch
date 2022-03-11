import * as http from "http";
import * as https from "https";

if (process.argv.length !== 3) {
  console.error(
    "You must pass a valid port where `esbuild --serve=XXXX` runs."
  );
  process.exit(1);
}

const PROXY_PORT = 8000;
const ESBUILD_PORT = process.argv[2];

const servers = [
  {
    port: 8001,
    subdomain: "application",
    handler: (req, res, log) => {
      serveWithEsbuild(req, res, log, "/ApplicationMain.html");
    },
  },
  {
    port: 8002,
    subdomain: "elm-spa-example",
    handler: (req, res, log) => {
      serveWithEsbuild(req, res, log, "/submodules/elm-spa-example/index.html");
    },
  },
  {
    port: 8003,
    subdomain: "concourse",
    handler: (req, res, log) => {
      if (req.url.startsWith("/api/")) {
        proxyToWeb(req, res, log, "ci.concourse-ci.org");
      } else {
        serveWithEsbuild(
          req,
          res,
          log,
          "/submodules/concourse/web/public/index.html"
        );
      }
    },
  },
  {
    port: 8004,
    subdomain: "unison.share",
    handler: (req, res, log) => {
      if (req.url.startsWith("/api/")) {
        proxyToWeb(req, res, log, "share.unison-lang.org");
      } else {
        serveWithEsbuild(
          req,
          res,
          log,
          "/submodules/codebase-ui/src/unisonShare.html"
        );
      }
    },
  },
];

function serveWithEsbuild(req, res, log, newUrl) {
  req.url = newUrl;
  proxyToEsbuild(req, res, (...args) => log(`-> ${newUrl}`, ...args));
}

function shouldProxyToEsbuild(req) {
  return /\.\w+$/.test(req.url);
}

function proxyToEsbuild(req, res, log) {
  const options = {
    hostname: "localhost",
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

  req.pipe(proxyReq, { end: true });
}

const LOOKS_LIKE_IP_ADDRESS = /^(\d+\.\d+\.\d+\.\d+):\d+$/;

function indexPage(host = "", url = "/") {
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
          const match = LOOKS_LIKE_IP_ADDRESS.exec(host);
          const [href, title] =
            match === null
              ? [
                  `http://${
                    serverConfig.subdomain
                  }.localhost:${PROXY_PORT}${escapeHtml(url)}`,
                  `${serverConfig.subdomain}.localhost:${PROXY_PORT}`,
                ]
              : [
                  `http://${match[1]}:${serverConfig.port}${escapeHtml(url)}`,
                  `${serverConfig.subdomain}: ${match[1]}:${serverConfig.port}`,
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
  const originalRequest = `${req.method} ${req.url}`;
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

for (const serverConfig of servers) {
  const server = http.createServer((req, res) => {
    const log = makeLog(req);
    if (shouldProxyToEsbuild(req)) {
      proxyToEsbuild(req, res, log);
    } else {
      serverConfig.handler(req, res, log);
    }
  });
  server.listen(serverConfig.port);
}

const proxyServer = http.createServer((req, res) => {
  const { host } = req.headers;
  const log = makeLog(req);

  if (shouldProxyToEsbuild(req)) {
    proxyToEsbuild(req, res, log);
  } else {
    const serverConfig = servers.find(
      (serverConfig) =>
        host === `${serverConfig.subdomain}.localhost:${PROXY_PORT}`
    );
    if (serverConfig === undefined) {
      log(404);
      res.writeHead(404);
      res.end(indexPage(host, req.url));
    } else {
      serverConfig.handler(req, res, log);
    }
  }
});

proxyServer.listen(PROXY_PORT, () => {
  console.log("esbuild should be on:", `http://localhost:${ESBUILD_PORT}`);
  for (const serverConfig of servers) {
    console.log(
      `${serverConfig.subdomain}:`,
      `http://localhost:${serverConfig.port}`
    );
  }
  console.log(
    `Convenience proxy for the above:`,
    `http://localhost:${PROXY_PORT}`
  );
});
