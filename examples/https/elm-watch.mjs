// @ts-check
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
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
      output: "public/build/main.js",
    },
  ],
  // Use an HTTPS server instead of elm-watch’s default HTTP server. elm-watch
  // only calls this in hot mode. Since the page is served on `https://`,
  // elm-watch’s WebSocket uses `wss://`, which goes to this same server.
  createServer: ({ onRequest, onUpgrade }) =>
    https.createServer(getCertificate(), onRequest).on("upgrade", onUpgrade),
});

/**
 * Reads the certificate in `certificate/`, creating a self-signed one with
 * `openssl` if there isn’t one already. To use a certificate that browsers
 * trust instead, put it in `certificate/` (see the README).
 *
 * @returns {{ key: Buffer, cert: Buffer }}
 */
function getCertificate() {
  const dir = path.join(import.meta.dirname, "certificate");
  const keyFile = path.join(dir, "dev.key");
  const certFile = path.join(dir, "dev.crt");

  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "3650",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
        "-keyout",
        keyFile,
        "-out",
        certFile,
      ],
      { stdio: "ignore" },
    );
  }

  return {
    key: fs.readFileSync(keyFile),
    cert: fs.readFileSync(certFile),
  };
}
