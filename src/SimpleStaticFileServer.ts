import * as fs from "fs";
import * as http from "http";
import * as path from "path";

import { join, toError } from "./Helpers";
import { absoluteDirname } from "./PathHelpers";
import { ElmWatchJsonPath } from "./Types";

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

function baseHtml(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)} – elm-watch</title>
    <style>
      html { font-family: system-ui, sans-serif; padding: clamp(0.5rem, 3vw, 2rem); }
      h1 { margin-top: 0; }
      ul { padding-left: 0; }
      li { list-style: none; }
      li::before { content: attr(data-marker) " "; }
      a:not(:hover) { text-decoration: none; }
      a { color: #0000ff; }
      a:visited { color: #0070c1; }
      @media (prefers-color-scheme: dark) {
        html { color: #c8c8c8; background: #1e1e1e; }
        a { color: #4fc1ff; }
        a:visited { color: #569cd6; }
      }
    </style>
  </head>
  <body>
    ${body.trim()}
    <p><small>ℹ️ This is the elm-watch WebSocket and simple HTTP server.</small></p>
  </body>
</html>
  `.trim();
}

function indexHtml(url: string, entries: Array<fs.Dirent>): string {
  const segments = url.split("/").slice(0, -1);
  const lastIndex = segments.length - 1;
  const title = join(
    segments.map((segment, index) =>
      index === lastIndex
        ? `${escapeHtml(segment)}/`
        : `<a href="${escapeHtml(
            join(segments.slice(0, index + 1), "/")
          )}/">${escapeHtml(segment)}/</a>`
    ),
    ""
  );
  return baseHtml(
    url,
    `
<h1>${title}</h1>
<ul>
${url === "/" ? "" : `<li data-marker="📁"><a href="..">../</a></li>`}
${join(
  entries
    .flatMap((entry) =>
      entry.isFile()
        ? [
            `<li data-marker="📄"><a href="${escapeHtml(
              entry.name
            )}">${escapeHtml(entry.name)}</a></li>`,
          ]
        : entry.isDirectory()
        ? [
            `<li data-marker="📁"><a href="${escapeHtml(
              entry.name
            )}">${escapeHtml(entry.name)}/</a></li>`,
          ]
        : []
    )
    .sort(),
  "\n"
)}
</ul>
  `
  );
}

export function acceptHtml(
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
        )} to accept elm-watch’s self-signed certificate?</p>`
  );
}

export function errorHtml(errorMessage: string): string {
  if (errorMessage.includes("\n")) {
    const firstRow = join(errorMessage.split("\n").slice(0, 1), "");
    return baseHtml(
      firstRow,
      `<h1>${escapeHtml(firstRow)}</h1><pre>${escapeHtml(errorMessage)}</pre>`
    );
  } else {
    return baseHtml(errorMessage, `<h1>${escapeHtml(errorMessage)}</h1>`);
  }
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

function maybeLink(href: string | undefined, text: string): string {
  return href === undefined ? text : `<a href="${href}">${text}</a>`;
}

export function respondHtml(
  response: http.ServerResponse,
  statusCode: number,
  html: string
): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  response.end(html);
}

function respondNotFound(response: http.ServerResponse): void {
  respondHtml(response, 404, errorHtml("404 - Not found"));
}

// Note: This function may throw file system errors.
export function serveStatic(
  elmWatchJsonPath: ElmWatchJsonPath
): http.RequestListener {
  return (request, response) => {
    switch (request.method) {
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

        const stats = statSync(fsPath);
        switch (stats.tag) {
          case "NotFound":
            respondNotFound(response);
            break;

          case "File":
            serveFile(fsPath, stats.size, request, response);
            break;

          case "Directory":
            if (url.endsWith("/")) {
              const indexFile = `${fsPath}index.html`;
              const indexStats = statSync(indexFile);
              switch (indexStats.tag) {
                case "File":
                  serveFile(indexFile, indexStats.size, request, response);
                  break;

                case "Directory":
                case "Other":
                case "NotFound": {
                  const entries = fs.readdirSync(fsPath, {
                    withFileTypes: true,
                  });
                  respondHtml(
                    response,
                    200,
                    request.method === "HEAD" ? "" : indexHtml(url, entries)
                  );
                  break;
                }
              }
            } else {
              response.writeHead(302, { Location: `${url}/` });
              response.end();
            }
            break;

          case "Other":
            respondNotFound(response);
        }
        break;
      }

      default:
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end(
          errorHtml(
            `Only GET and HEAD requests are supported. Got: ${
              request.method ?? "(none)"
            }`
          )
        );
        break;
    }
  };
}

function serveFile(
  fsPath: string,
  fsSize: number,
  request: http.IncomingMessage,
  response: http.ServerResponse
): void {
  const contentType = {
    "Content-Type":
      MIME_TYPES[path.extname(fsPath).toLowerCase()] ??
      "application/octet-stream",
  };

  switch (request.method) {
    case "HEAD":
      response.writeHead(200, contentType);
      response.end();
      break;

    default: {
      const rangeHeader = request.headers.range;
      const range =
        rangeHeader === undefined ? undefined : parseRangeHeader(rangeHeader);
      const readStream = fs.createReadStream(fsPath, range);
      readStream.on("error", (error) => {
        respondHtml(response, 500, errorHtml(error.message));
      });
      readStream.on("open", () => {
        if (range === undefined) {
          response.writeHead(200, {
            ...contentType,
            "Content-Length": fsSize,
          });
        } else {
          response.writeHead(206, {
            ...contentType,
            "Content-Range": `bytes ${range.start}-${range.end}/${fsSize}`,
            "Content-Length": range.end - range.start + 1,
          });
        }
      });
      readStream.pipe(response, { end: true });
      break;
    }
  }
}

function statSync(
  fsPath: string
):
  | { tag: "Directory" }
  | { tag: "File"; size: number }
  | { tag: "NotFound" }
  | { tag: "Other" } {
  try {
    const stats = fs.statSync(fsPath);
    return stats.isFile()
      ? { tag: "File", size: stats.size }
      : stats.isDirectory()
      ? { tag: "Directory" }
      : { tag: "Other" };
  } catch (unknownError) {
    const error = toError(unknownError);
    if (error.code === "ENOENT") {
      return { tag: "NotFound" };
    }
    throw error;
  }
}

// This only supports what Safari sends when using the `<video>` element.
// See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests
const RANGE_REGEX = /^bytes=(\d+)-(\d+)$/;

function parseRangeHeader(
  rangeHeader: string
): { start: number; end: number } | undefined {
  const match = RANGE_REGEX.exec(rangeHeader);
  if (match === null) {
    return undefined;
  }
  const [, start = "0", end = "Infinity"] = match;
  return { start: Number(start), end: Number(end) };
}
