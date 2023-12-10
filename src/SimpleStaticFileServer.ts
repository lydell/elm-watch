import * as fs from "fs";
import * as http from "http";
import * as path from "path";

import { escapeHtml, join, toError } from "./Helpers";
import { StaticFilesDir } from "./Types";

// Copied from: https://github.com/evanw/esbuild/blob/52110fd09322af7c8ac22e011f64093e53765004/internal/helpers/mime.go#L5-L39
// Removed markdown – otherwise that causes downloads in Firefox instead of
// opening in the browser as plain text.
const MIME_TYPES: Record<string, string> = {
  // Text
  ".css": "text/css; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

// Copied from Node.js’ validation code for `setHeader`:
// https://github.com/nodejs/node/blob/f801b58e7753dd5abd492ad2076686f5ec63d897/lib/_http_common.js#L216C1-L216C51
const HEADER_CHAR_REGEX = /[^\t\x20-\x7e\x80-\xff]/g;

class Html {
  constructor(private escapedHtml: string) {}

  toString(): string {
    return this.escapedHtml;
  }
}

function html(
  strings: ReadonlyArray<string>,
  ...values: Array<Html | string>
): Html {
  return new Html(
    join(
      strings.flatMap((string, index) => {
        const value = values[index] ?? "";
        return [
          string,
          value instanceof Html ? value.toString() : escapeHtml(value),
        ];
      }),
      ""
    )
  );
}

function baseHtml(faviconEmoji: string, title: string, body: Html): Html {
  return html`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${title} – elm-watch</title>
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 16 16'><text x='0' y='14'>${faviconEmoji}</text></svg>"
        />
        <style>
          html {
            font-family: system-ui, sans-serif;
            padding: clamp(0.5rem, 3vw, 2rem);
          }
          h1 {
            margin-top: 0;
          }
          main p {
            max-width: 60ch;
          }
          a:not(:hover) {
            text-decoration: none;
          }
          a {
            color: #0000ff;
          }
          a:visited {
            color: #0070c1;
          }
          pre {
            padding: 1em;
            background-color: #00000020;
            overflow-x: auto;
            display: inline-block;
          }
          pre,
          code {
            font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas,
              Liberation Mono, monospace;
          }
          @media (prefers-color-scheme: dark) {
            html {
              color: #c8c8c8;
              background: #1e1e1e;
            }
            a {
              color: #4fc1ff;
            }
            a:visited {
              color: #569cd6;
            }
            pre {
              background-color: #c8c8c820;
            }
          }
        </style>
      </head>
      <body>
        ${body}
        <p style="margin-top: 2em">
          <small
            >ℹ️ This is the
            <a href="https://lydell.github.io/elm-watch/server/"
              >elm-watch server</a
            >.</small
          >
        </p>
      </body>
    </html>
  `;
}

function notFoundHtml(
  fsPath: string,
  statsTag: "Directory" | "NotFound" | "Other"
): Html {
  switch (statsTag) {
    case "Directory":
      return baseHtml(
        "📁",
        "Directory",
        html`
          <h1>Directory</h1>
          <p>
            The URL you requested points to a directory. elm-watch only serves
            files.
          </p>
          <p>Suggestion: Create an <code>index.html</code> file.</p>
          <p>
            👉
            <a href="https://lydell.github.io/elm-watch/server/#TODO"
              >How index.html files work</a
            >
          </p>
          <p>This is the absolute file path the URL resolves to:</p>
          <pre>${fsPath}</pre>
        `
      );

    case "NotFound":
      return baseHtml(
        "❓",
        "Not Found",
        html`
          <h1>404 – Not Found</h1>
          <p>The URL you requested does not point to any existing file.</p>
          ${getContentType(fsPath) === undefined
            ? html`
                <p>
                  👉
                  <a href="https://lydell.github.io/elm-watch/server/#TODO"
                    >How index.html files work</a
                  >
                  (for <code>Browser.application</code> programs)
                </p>
              `
            : ""}
          <p>
            👉
            <a href="https://lydell.github.io/elm-watch/server/#TODO"
              >File not found troubleshooting</a
            >
          </p>
          <p>This is the absolute file path the URL resolves to:</p>
          <pre>${fsPath}</pre>
        `
      );

    case "Other":
      return baseHtml(
        "🚨",
        "Unsupported",
        html`
          <h1>Unsupported file system object</h1>
          <p>
            The URL you requested points to a something that is neither or file
            nor a directory. elm-watch only serves files.
          </p>
          <p>This is the absolute file path the URL resolves to:</p>
          <pre>${fsPath}</pre>
        `
      );
  }
}

export function acceptHtml(
  isHttps: boolean,
  request: http.IncomingMessage
): Html {
  const { host, referer } = request.headers;
  return baseHtml(
    isHttps ? "✅" : "👉",
    "Certificate",
    isHttps
      ? html`<p>
          ✅ Certificate accepted. You may now
          ${maybeLink(
            referer !== undefined && new URL(referer).host !== host
              ? referer
              : undefined,
            "return to your page"
          )}.
        </p>`
      : html`<p>
          👉 Did you mean to go to the
          ${maybeLink(
            host !== undefined && request.url !== undefined
              ? `https://${host}${request.url}`
              : undefined,
            "HTTPS version of this page"
          )}
          to accept elm-watch’s self-signed certificate?
        </p>`
  );
}

export function staticFileNotEnabledHtml(): Html {
  return baseHtml(
    "ℹ️",
    "Enable static file server?",
    html`
      <main>
        <h1>Enable static file server?</h1>
        <p>
          elm-watch needs an HTTP server for its WebSockets. WebSockets connect
          via HTTP and then switch over to the WebSocket protocol. But other
          than that the HTTP server doesn’t really do anything.
        </p>
        <p>
          If you want, you can enable a simple static file server for your
          project, by adding the following to your
          <strong>elm-watch.json</strong> file:
        </p>
        <pre><code>"serve": "./folder/you/want/to/serve/"</code></pre>
        <p>Then create <code>./folder/you/want/to/serve/index.html</code>:</p>
        <pre><code>${exampleHtml}</code></pre>
        <p style="margin-top: 4em">
          ℹ️ The simple HTTP server is just for convenience. elm-watch needs to
          run an HTTP server anyway, and you need one for
          <code>Browser.application</code> programs (which do no support the
          <code>file://</code> protocol). If you need anything more advanced,
          use
          <a href="https://lydell.github.io/elm-watch/server/"
            >your own HTTP server</a
          >.
        </p>
        <p>
          ❗️ By default, the HTTP server is exposed on the local network (so
          you can test on your phone on the same Wi-Fi for example). If you are
          on a public Wi-Fi, you can restrict the server to just your computer
          by setting an environment variable:
          <code>ELM_WATCH_HOST=127.0.0.1</code>
        </p>
      </main>
    `
  );
}

const exampleHtml = `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Elm App</title>
  </head>
  <body>
    <!-- Absolute URL to the built JS. -->
    <script src="/build/main.js"></script>
    <div id="root"></div>
    <script>
      var app = Elm.Main.init({ node: document.getElementById("root") });
      // If you're using Browser.document or Browser.application:
      // var app = Elm.Main.init();
    </script>
  </body>
</html>
`.trim();

export function errorHtml(errorMessage: string): Html {
  if (errorMessage.includes("\n")) {
    const firstRow = join(errorMessage.split("\n").slice(0, 1), "");
    return baseHtml(
      "🚨",
      firstRow,
      html`<h1>${firstRow}</h1>
        <pre>${errorMessage}</pre>`
    );
  } else {
    return baseHtml("🚨", errorMessage, html`<h1>${errorMessage}</h1>`);
  }
}

function maybeLink(href: string | undefined, text: string): Html {
  return href === undefined
    ? html`${text}`
    : html`<a href="${href}">${text}</a>`;
}

export function respondHtml(
  response: http.ServerResponse,
  statusCode: number,
  htmlValue: Html
): void {
  const htmlString = htmlValue.toString().trim();
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(htmlString),
  });
  response.end(htmlString);
}

// Note: This function may throw file system errors.
export function serveStatic(
  staticFilesDir: StaticFilesDir
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
        const urlWithoutQuery = decodePercentageEscapes(removeQuery(url));
        const fsPath =
          staticFilesDir.theStaticFilesDir.absolutePath + urlWithoutQuery;
        const stats = statSync(fsPath);

        switch (stats.tag) {
          case "File":
            serveFile(fsPath, stats.size, request, response);
            return;

          case "NotFound":
          case "Other":
          case "Directory": {
            const segments = (
              urlWithoutQuery.endsWith("/")
                ? urlWithoutQuery
                : `${urlWithoutQuery}/`
            )
              .split("/")
              // The array always starts and ends with an empty string since the
              // string we’re splitting always starts and ends with a slash.
              .slice(1, -1);

            for (let i = segments.length; i >= 0; i--) {
              const indexFsPath = join(
                [
                  staticFilesDir.theStaticFilesDir.absolutePath,
                  ...segments.slice(0, i),
                  "index.html",
                ],
                "/"
              );
              const indexStats = statSync(indexFsPath);
              switch (indexStats.tag) {
                case "File":
                  response.setHeader(
                    "elm-watch-404",
                    fsPath.replace(HEADER_CHAR_REGEX, "?")
                  );
                  response.setHeader(
                    "elm-watch-index-html",
                    indexFsPath.replace(HEADER_CHAR_REGEX, "?")
                  );
                  serveFile(indexFsPath, indexStats.size, request, response);
                  return;

                case "Directory":
                case "Other":
                case "NotFound":
                  break;
              }
            }

            respondHtml(response, 404, notFoundHtml(fsPath, stats.tag));
            return;
          }
        }
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
        return;
    }
  };
}

function getContentType(fsPath: string): string | undefined {
  return MIME_TYPES[path.extname(fsPath).toLowerCase()];
}

function serveFile(
  fsPath: string,
  fsSize: number,
  request: http.IncomingMessage,
  response: http.ServerResponse
): void {
  const contentType =
    getContentType(fsPath) ??
    // esbuild defaults to `application/octet-stream`, but if you click a link
    // to such a file, it causes a download which clutters your Downloads
    // folder. This allows viewing the file instead, and it’s more likely to
    // have plain text files than binary files in development repos.
    "text/plain; charset=utf-8";
  const contentTypeHeader = {
    "Content-Type": contentType,
  };

  switch (request.method) {
    case "HEAD":
      response.writeHead(200, contentTypeHeader);
      response.end();
      return;

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
            ...contentTypeHeader,
            "Content-Length": fsSize,
          });
        } else {
          response.writeHead(206, {
            ...contentTypeHeader,
            "Content-Range": `bytes ${range.start}-${range.end}/${fsSize}`,
            "Content-Length": range.end - range.start + 1,
          });
        }
      });
      readStream.pipe(response, { end: true });
      return;
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
    if (error.code === "ENOENT" || error.code === "ENOTDIR") {
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

const QUERY_REGEX = /\?[^]*$/;

function removeQuery(url: string): string {
  return url.replace(QUERY_REGEX, "");
}

function decodePercentageEscapes(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}
