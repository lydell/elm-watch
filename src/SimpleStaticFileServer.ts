import * as fs from "fs";
import * as http from "http";
import * as path from "path";

import { escapeHtml, join, toError } from "./Helpers";
import { AbsolutePath, StaticFilesDir } from "./Types";

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

const DOCS_LINK = "https://lydell.github.io/elm-watch/server/";
const DOCS_LINK_INDEX_HTML = `${DOCS_LINK}#indexhtml`;

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
            width: max-content;
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
            >ℹ️ This is the <a href="${DOCS_LINK}">elm-watch server</a>.</small
          >
        </p>
      </body>
    </html>
  `;
}

function notFoundHtml(
  fsPath: FsPath,
  statsTag: NotFileStat | "FileWithTrailingSlash"
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
            <a href="${DOCS_LINK_INDEX_HTML}">How index.html files work</a>
          </p>
          <p>This is the absolute file path the URL resolves to:</p>
          <pre>${fsPath.theFsPath.absolutePath}</pre>
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
                  <a href="${DOCS_LINK_INDEX_HTML}"
                    >How index.html files work</a
                  >
                  (for <code>Browser.application</code> programs)
                </p>
              `
            : html`
                <p>
                  👉
                  <a href="${DOCS_LINK_INDEX_HTML}"
                    >File not found troubleshooting</a
                  >
                </p>
              `}
          <p>This is the absolute file path the URL resolves to:</p>
          <pre>${fsPath.theFsPath.absolutePath}</pre>
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
          <pre>${fsPath.theFsPath.absolutePath}</pre>
        `
      );

    case "FileWithTrailingSlash":
      return baseHtml(
        "🚯",
        "Trailing slash",
        html`
          <h1>File with trailing slash</h1>
          <p>
            The URL you requested points to a file, but the URL has a trailing
            slash.
          </p>
          <p>Servers typically don't allow trailing slashes on files.</p>
          <p>Suggestion: Remove the trailing slash from the URL.</p>
          <p>This is the absolute file path the URL resolves to:</p>
          <pre>${fsPath.theFsPath.absolutePath}</pre>
        `
      );
  }
}

function staticDirNotFoundHtml(
  staticFilesDir: StaticFilesDir,
  statsTag: "File" | "NotFound" | "Other"
): Html {
  return baseHtml(
    "🚨",
    "Static files directory not found",
    html`
      <h1>Static files directory not found</h1>
      <p>
        You have configured a static files directory in elm-watch.json which
        resolves to:
      </p>
      <pre>${staticFilesDir.theStaticFilesDir.absolutePath}</pre>
      <p>${staticFilesDirDescription(statsTag)}</p>
    `
  );
}

function staticFilesDirDescription(
  statsTag: "File" | "NotFound" | "Other"
): string {
  switch (statsTag) {
    case "File":
      return "However, that is a file, not a directory!";
    case "NotFound":
      return "However, that directory does not exist.";
    case "Other":
      return "However, that is neither a file nor a directory.";
  }
}

function forbiddenHtml(
  staticFilesDir: StaticFilesDir,
  forbiddenPath: AbsolutePath
): Html {
  return baseHtml(
    "⛔️",
    "Forbidden",
    html`
      <h1>Forbidden</h1>
      <p>
        You have configured a static files directory in elm-watch.json which
        resolves to:
      </p>
      <pre>${staticFilesDir.theStaticFilesDir.absolutePath}</pre>
      <p>
        However, the URL you requested points to a file outside of that
        directory:
      </p>
      <pre>${forbiddenPath.absolutePath}</pre>
    `
  );
}

function indexHtmlInfo(
  fsPath: FsPath,
  indexFsPath: IndexFsPath,
  statsTag: NotFileStat
): {
  headers: Record<string, string>;
  comment: string;
} {
  return {
    headers: {
      "elm-watch-404": fsPath.theFsPath.absolutePath,
      "elm-watch-index-html": indexFsPath.theIndexFsPath.absolutePath,
      "elm-watch-learn-more": DOCS_LINK_INDEX_HTML,
    },
    // If you change the first line, also update the code in client.ts that removes this comment.
    comment: `<!-- elm-watch debug information:

hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

${indexHtmlDescription(fsPath, indexFsPath, statsTag)}

Learn more:
${DOCS_LINK_INDEX_HTML}

-->
`,
  };
}

function indexHtmlDescription(
  fsPath: FsPath,
  indexFsPath: IndexFsPath,
  statsTag: NotFileStat
): string {
  switch (statsTag) {
    case "Directory":
      return `
The URL you requested points to a directory. elm-watch only serves files.

The closest index.html file was served instead:
${indexFsPath.theIndexFsPath.absolutePath}

This is the directory:
${fsPath.theFsPath.absolutePath}
`.trim();

    case "NotFound":
      return `
This response could have been served as a 404 (Not Found),
but was served as 200 (OK) instead, because an index.html file was found.
This is for supporting Browser.application programs.

If you expected a file to served rather than this HTML,
make sure the URL is correct or that this file exists:
${fsPath.theFsPath.absolutePath}

This is the closest index.html file, which was served instead:
${indexFsPath.theIndexFsPath.absolutePath}
`.trim();

    case "Other":
      return `
The URL you requested points to a something that is neither or file
nor a directory. elm-watch only serves files.

This is the absolute file path the URL resolves to:
${fsPath.theFsPath.absolutePath}

This is the closest index.html file, which was served instead:
${indexFsPath.theIndexFsPath.absolutePath}
`.trim();
  }
}

export function staticFileNotEnabledHtml(): Html {
  return baseHtml(
    "ℹ️",
    "Enable static file server?",
    html`
      <h1>Enable elm-watch static file server?</h1>
      <p>
        If you want, you can enable a simple static file server for your
        project.
      </p>
      <p>Add the following to your <strong>elm-watch.json</strong> file:</p>
      <pre><code>"serve": "./folder/to/serve/"</code></pre>
    `
  );
}

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
        const { url = "/" } = request;
        const fsPath = toFsPath(staticFilesDir, url);

        if (fsPath.tag === "Forbidden") {
          respondHtml(
            response,
            403,
            forbiddenHtml(staticFilesDir, fsPath.forbiddenPath)
          );
          return;
        }

        const stats = statSync(fsPath.theFsPath);

        switch (stats.tag) {
          case "File":
            if (fsPath.hadTrailingSlash) {
              respondHtml(
                response,
                404,
                notFoundHtml(fsPath, "FileWithTrailingSlash")
              );
            } else {
              serveFile(fsPath, stats.size, request, response);
            }
            return;

          case "NotFound":
          case "Other":
          case "Directory": {
            for (let i = fsPath.segments.length; i >= 0; i--) {
              const indexFsPath = toIndexFsPath(staticFilesDir, fsPath, i);
              const indexStats = statSync(indexFsPath.theIndexFsPath);
              switch (indexStats.tag) {
                case "File": {
                  const info = indexHtmlInfo(fsPath, indexFsPath, stats.tag);
                  for (const [name, value] of Object.entries(info.headers)) {
                    response.setHeader(
                      name,
                      value.replace(HEADER_CHAR_REGEX, "?")
                    );
                  }
                  serveFile(
                    indexFsPath,
                    indexStats.size,
                    request,
                    response,
                    info.comment
                  );
                  return;
                }

                case "Directory":
                case "Other":
                case "NotFound":
                  break;
              }
            }

            const staticFilesDirStats = statSync(
              staticFilesDir.theStaticFilesDir
            );
            switch (staticFilesDirStats.tag) {
              case "Directory":
                respondHtml(response, 404, notFoundHtml(fsPath, stats.tag));
                return;

              case "File":
              case "NotFound":
              case "Other":
                respondHtml(
                  response,
                  404,
                  staticDirNotFoundHtml(staticFilesDir, staticFilesDirStats.tag)
                );
                return;
            }
          }
        }
      }

      default:
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end(
          errorHtml(
            `Unsupported method

Only GET and HEAD requests are supported. Got: ${request.method ?? "(none)"}`
          )
        );
        return;
    }
  };
}

function getContentType(fsPath: FsPath | IndexFsPath): string | undefined {
  return MIME_TYPES[
    path.extname(toAbsolutePath(fsPath).absolutePath).toLowerCase()
  ];
}

function toAbsolutePath(fsPath: FsPath | IndexFsPath): AbsolutePath {
  switch (fsPath.tag) {
    case "FsPath":
      return fsPath.theFsPath;
    case "IndexFsPath":
      return fsPath.theIndexFsPath;
  }
}

function serveFile(
  fsPath: FsPath | IndexFsPath,
  fsSize: number,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  extraContent?: string
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
      const readStream = fs.createReadStream(
        toAbsolutePath(fsPath).absolutePath,
        range
      );
      readStream.on("error", (error) => {
        respondHtml(
          response,
          500,
          errorHtml(`Failed to read file\n\n${error.message}`)
        );
      });
      readStream.on("open", () => {
        if (range === undefined) {
          response.writeHead(200, {
            ...contentTypeHeader,
            "Content-Length":
              fsSize +
              (extraContent === undefined
                ? 0
                : Buffer.byteLength(extraContent)),
          });
          if (extraContent !== undefined) {
            response.write(extraContent);
          }
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

type NotFileStat = "Directory" | "NotFound" | "Other";

function statSync(
  absolutePath: AbsolutePath
): { tag: "File"; size: number } | { tag: NotFileStat } {
  try {
    const stats = fs.statSync(absolutePath.absolutePath);
    return stats.isFile()
      ? { tag: "File", size: stats.size }
      : stats.isDirectory()
      ? { tag: "Directory" }
      : { tag: "Other" };
  } catch (unknownError) {
    const error = toError(unknownError);
    if (
      error.code === "ENOENT" || // No such file or (parent) directory
      error.code === "ENOTDIR" || // Some parent is not a directory
      error.code === "ENAMETOOLONG" // Some part of the path is >255 characters
    ) {
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

type FsPath = {
  tag: "FsPath";
  theFsPath: AbsolutePath;
  hadTrailingSlash: boolean;
  segments: Array<string>;
};

type IndexFsPath = {
  tag: "IndexFsPath";
  theIndexFsPath: AbsolutePath;
};

function toFsPath(
  staticFilesDir: StaticFilesDir,
  url: string
): FsPath | { tag: "Forbidden"; forbiddenPath: AbsolutePath } {
  const urlWithoutQuery = decodePercentageEscapes(removeQuery(url));

  // Not using `absolutePathFromString` here since it uses `path.resolve`
  // but we need `path.join` (otherwise all URLs would resolve to the root of the file system).
  const fsPathStringRaw = path.join(
    staticFilesDir.theStaticFilesDir.absolutePath,
    urlWithoutQuery
  );

  const hadTrailingSlash = fsPathStringRaw.endsWith(path.sep);

  const fsPathString = hadTrailingSlash
    ? fsPathStringRaw.slice(0, -path.sep.length)
    : fsPathStringRaw;

  const absoluteFsPath: AbsolutePath = {
    tag: "AbsolutePath",
    absolutePath: fsPathString,
  };

  const prefix = staticFilesDir.theStaticFilesDir.absolutePath + path.sep;

  // Protect against reading files outside the static files dir.
  // For example: curl http://localhost:8000/%2e%2e/secret.txt
  return fsPathString === staticFilesDir.theStaticFilesDir.absolutePath
    ? {
        tag: "FsPath",
        theFsPath: absoluteFsPath,
        hadTrailingSlash,
        segments: [],
      }
    : fsPathString.startsWith(prefix)
    ? {
        tag: "FsPath",
        theFsPath: absoluteFsPath,
        hadTrailingSlash,
        segments: fsPathString.slice(prefix.length).split(path.sep),
      }
    : {
        tag: "Forbidden",
        forbiddenPath: absoluteFsPath,
      };
}

function toIndexFsPath(
  staticFilesDir: StaticFilesDir,
  fsPath: FsPath,
  numSegments: number
): IndexFsPath {
  return {
    tag: "IndexFsPath",
    theIndexFsPath: {
      tag: "AbsolutePath",
      absolutePath: path.join(
        staticFilesDir.theStaticFilesDir.absolutePath,
        ...fsPath.segments.slice(0, numSegments),
        "index.html"
      ),
    },
  };
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
