import * as fs from "fs";
import type * as http from "http";
import * as path from "path";

import { ALLOWED_HOSTS_DOCS_LINK, type RejectedHost } from "./AllowedHosts.ts";
import type { ConfigSource } from "./Config.ts";
import { ELM_WATCH_ALLOWED_HOSTS } from "./Env.ts";
import { escapeHtml, toError } from "./Helpers.ts";
import {
  type AbsolutePath,
  markAsAbsolutePath,
  type StaticFilesDir,
} from "./Types.ts";

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
  private escapedHtml: string;

  constructor(escapedHtml: string) {
    this.escapedHtml = escapedHtml;
  }

  toString(): string {
    return this.escapedHtml;
  }
}

function html(
  strings: ReadonlyArray<string>,
  ...values: Array<Html | string>
): Html {
  return new Html(
    strings
      .flatMap((string, index) => {
        const value = values[index] ?? "";
        return [
          string,
          value instanceof Html ? value.toString() : escapeHtml(value),
        ];
      })
      .join(""),
  );
}

function configuredIn(configSource: ConfigSource): string {
  switch (configSource.tag) {
    case "ElmWatchJson":
      return "in elm-watch.json";
    case "Options":
      return "in the elm-watch options";
  }
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
            font-family:
              ui-monospace,
              SFMono-Regular,
              SF Mono,
              Menlo,
              Consolas,
              Liberation Mono,
              monospace;
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
        <main>${body}</main>
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
  statsTag: NotFileStat | "FileWithTrailingSlash",
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
          <pre>${fsPath.theFsPath}</pre>
        `,
      );

    case "NotFound":
      return baseHtml(
        "❓",
        "Not Found",
        html`
          <h1>404 – Not Found</h1>
          <p>The URL you requested does not point to any existing file.</p>
          ${
            getContentType(fsPath) === undefined
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
                `
          }
          <p>This is the absolute file path the URL resolves to:</p>
          <pre>${fsPath.theFsPath}</pre>
        `,
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
          <pre>${fsPath.theFsPath}</pre>
        `,
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
          <pre>${fsPath.theFsPath}</pre>
        `,
      );
  }
}

function staticDirNotFoundHtml(
  configSource: ConfigSource,
  staticFilesDir: StaticFilesDir,
  statsTag: "File" | "NotFound" | "Other",
): Html {
  return baseHtml(
    "🚨",
    "Static files directory not found",
    html`
      <h1>Static files directory not found</h1>
      <p>
        You have configured a static files directory
        ${configuredIn(configSource)} which resolves to:
      </p>
      <pre>${staticFilesDir}</pre>
      <p>${staticFilesDirDescription(statsTag)}</p>
    `,
  );
}

function staticFilesDirDescription(
  statsTag: "File" | "NotFound" | "Other",
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
  configSource: ConfigSource,
  staticFilesDir: StaticFilesDir,
  forbiddenPath: AbsolutePath,
): Html {
  return baseHtml(
    "⛔️",
    "Forbidden",
    html`
      <h1>Forbidden</h1>
      <p>
        You have configured a static files directory
        ${configuredIn(configSource)} which resolves to:
      </p>
      <pre>${staticFilesDir}</pre>
      <p>
        However, the URL you requested points to a file outside of that
        directory:
      </p>
      <pre>${forbiddenPath}</pre>
    `,
  );
}

function indexHtmlInfo(
  fsPath: FsPath,
  indexFsPath: IndexFsPath,
  statsTag: NotFileStat,
): {
  headers: Record<string, string>;
  comment: string;
} {
  return {
    headers: {
      "elm-watch-404": fsPath.theFsPath,
      "elm-watch-index-html": indexFsPath.theIndexFsPath,
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
  statsTag: NotFileStat,
): string {
  switch (statsTag) {
    case "Directory":
      return `
The URL you requested points to a directory. elm-watch only serves files.

The closest index.html file was served instead:
${indexFsPath.theIndexFsPath}

This is the directory:
${fsPath.theFsPath}
`.trim();

    case "NotFound":
      return `
This response could have been served as a 404 (Not Found),
but was served as 200 (OK) instead, because an index.html file was found.
This is for supporting Browser.application programs.

If you expected a file to served rather than this HTML,
make sure the URL is correct or that this file exists:
${fsPath.theFsPath}

This is the closest index.html file, which was served instead:
${indexFsPath.theIndexFsPath}
`.trim();

    case "Other":
      return `
The URL you requested points to a something that is neither or file
nor a directory. elm-watch only serves files.

This is the absolute file path the URL resolves to:
${fsPath.theFsPath}

This is the closest index.html file, which was served instead:
${indexFsPath.theIndexFsPath}
`.trim();
  }
}

export function hostNotAllowedHtml(
  configSource: ConfigSource,
  rejectedHost: RejectedHost,
): Html {
  switch (rejectedHost.tag) {
    case "NotAllowed":
      return baseHtml(
        "⛔️",
        "Host not allowed",
        html`
          <h1>Host not allowed</h1>
          <p>
            To protect against
            <a href="https://en.wikipedia.org/wiki/DNS_rebinding"
              >DNS rebinding</a
            >
            attacks, elm-watch only accepts requests for certain hosts. This
            request was for:
          </p>
          <pre>${rejectedHost.hostname}</pre>
          <p>
            localhost, *.localhost, *.local and IP addresses are always allowed.
            To allow this host too, add it to
            ${configSourceStrong(configSource)}:
          </p>
          <pre><code>${
            configSource.tag === "ElmWatchJson"
              ? html`"allowedHosts": ["${rejectedHost.hostname}"]`
              : html`allowedHosts: ["${rejectedHost.hostname}"],`
          }</code></pre>
          ${
            configSource.tag === "ElmWatchJson"
              ? html`
                  <p>
                    Or set an environment variable (useful if the host changes):
                  </p>
                  <pre><code>${ELM_WATCH_ALLOWED_HOSTS}=${rejectedHost.hostname}</code></pre>
                `
              : ""
          }
          <p>
            👉
            <a href="${ALLOWED_HOSTS_DOCS_LINK}"
              >Learn more about allowed hosts</a
            >
          </p>
        `,
      );

    case "Invalid":
      return baseHtml(
        "⛔️",
        "Invalid Host header",
        html`
          <h1>Invalid Host header</h1>
          <p>The request had an invalid or missing Host header:</p>
          <pre>${rejectedHost.value ?? "(missing)"}</pre>
        `,
      );
  }
}

export function staticFileNotEnabledHtml(configSource: ConfigSource): Html {
  return baseHtml(
    "ℹ️",
    "Enable static file server?",
    html`
      <h1>Enable elm-watch static file server?</h1>
      <p>
        If you want, you can enable a simple static file server for your
        project.
      </p>
      <p>Add the following to ${configSourceStrong(configSource)}:</p>
      <pre><code>${
        configSource.tag === "ElmWatchJson"
          ? html`"serve": "./folder/to/serve/"`
          : html`staticFilesDir: "./folder/to/serve/",`
      }</code></pre>
    `,
  );
}

function configSourceStrong(configSource: ConfigSource): Html {
  switch (configSource.tag) {
    case "ElmWatchJson":
      return html`your <strong>elm-watch.json</strong> file`;
    case "Options":
      return html`your <strong>elmWatch()</strong> options`;
  }
}

export function errorHtml(errorMessage: string): Html {
  if (errorMessage.includes("\n")) {
    const firstRow = errorMessage.split("\n").slice(0, 1).join("");
    return baseHtml(
      "🚨",
      firstRow,
      html`<h1>${firstRow}</h1>
        <pre>${errorMessage}</pre>`,
    );
  } else {
    return baseHtml("🚨", errorMessage, html`<h1>${errorMessage}</h1>`);
  }
}

export function respondHtml(
  response: http.ServerResponse,
  statusCode: number,
  htmlValue: Html,
): void {
  const htmlString = htmlValue.toString().trim();
  const contentLength = Buffer.byteLength(htmlString);
  if (!response.headersSent) {
    writeHead(response, statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": contentLength,
    });
    response.end(htmlString);
  } else {
    // This can happen:
    // 1. We write the headers for responding.
    // 2. Something throws an error, so we never send the intended content.
    // 3. We catch that error, and want to respond with a 500 page.
    //    But the headers (and status code) are already sent, so we can’t
    //    change them now. Instead, try send the response using the already
    //    sent headers.
    const previousContentLength = response.getHeader("Content-Length");
    if (typeof previousContentLength === "number") {
      const newHtmlString =
        previousContentLength >= contentLength
          ? htmlString
          : // Previously set content was shorter – try to extract the main info.
            // All HTML we produce has a <main> element, so the fallback is never used.
            (/<main>([^]*)<\/main>/.exec(htmlString)?.[1] ?? htmlString);
      const newContentLength = Buffer.byteLength(newHtmlString);
      response.end(
        newHtmlString +
          // Pad the content to the previously set content if needed.
          " ".repeat(Math.max(0, previousContentLength - newContentLength)),
      );
    } else {
      // Content-Length not set previously, just try sending the whole thing.
      response.end(htmlString);
    }
  }
}

function writeHead(
  response: http.ServerResponse,
  statusCode: number,
  headers: Record<string, string | number>,
): void {
  // Use `.setHeader` rather than passing headers directly to `.writeHead`
  // so that they can be read later via `.getHeader`.
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.writeHead(statusCode);
}

// Note: This function may throw file system errors.
export function serveStatic(
  configSource: ConfigSource,
  staticFilesDir: StaticFilesDir,
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
            forbiddenHtml(configSource, staticFilesDir, fsPath.forbiddenPath),
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
                notFoundHtml(fsPath, "FileWithTrailingSlash"),
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
                      value.replace(HEADER_CHAR_REGEX, "?"),
                    );
                  }
                  serveFile(
                    indexFsPath,
                    indexStats.size,
                    request,
                    response,
                    info.comment,
                  );
                  return;
                }

                case "Directory":
                case "Other":
                case "NotFound":
                  break;
              }
            }

            const staticFilesDirStats = statSync(staticFilesDir);
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
                  staticDirNotFoundHtml(
                    configSource,
                    staticFilesDir,
                    staticFilesDirStats.tag,
                  ),
                );
                return;
            }
          }
        }
      }

      default: {
        // `request.method` is always a string here, but the types say it can be undefined.
        const { method = "(none)" } = request;
        response.setHeader("Allow", "GET, HEAD");
        respondHtml(
          response,
          405,
          errorHtml(
            `Unsupported method

Only GET and HEAD requests are supported. Got: ${method}`,
          ),
        );
        return;
      }
    }
  };
}

// The file system path that `serveStatic` would serve a file from, if the
// request is for a file. Used to find out if the request is for an output.
export function requestedFilePath(
  staticFilesDir: StaticFilesDir,
  request: http.IncomingMessage,
): AbsolutePath | undefined {
  switch (request.method) {
    case "HEAD":
    case "GET": {
      const { url = "/" } = request;
      const fsPath = toFsPath(staticFilesDir, url);
      return fsPath.tag === "FsPath" && !fsPath.hadTrailingSlash
        ? fsPath.theFsPath
        : undefined;
    }
    default:
      return undefined;
  }
}

export function respondJavaScript(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  code: string,
): void {
  writeHead(response, 200, {
    "Content-Type": "text/javascript; charset=utf-8",
    "Content-Length": Buffer.byteLength(code),
  });
  response.end(request.method === "HEAD" ? undefined : code);
}

function getContentType(fsPath: FsPath | IndexFsPath): string | undefined {
  return MIME_TYPES[path.extname(toAbsolutePath(fsPath)).toLowerCase()];
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
  extraContent?: string,
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
      writeHead(response, 200, contentTypeHeader);
      response.end();
      return;

    default: {
      const rangeHeader = request.headers.range;
      const range =
        // Ignore the Range header when adding extra content, since ranges
        // apply to the file only and would be off.
        rangeHeader === undefined || extraContent !== undefined
          ? undefined
          : parseRangeHeader(rangeHeader, fsSize);
      if (range?.tag === "Unsatisfiable") {
        response.setHeader("Content-Range", `bytes */${fsSize}`);
        respondHtml(
          response,
          416,
          errorHtml(
            `Range Not Satisfiable

Requested range: ${range.rangeHeader}
File size: ${fsSize} bytes`,
          ),
        );
        return;
      }
      const readStream = fs.createReadStream(toAbsolutePath(fsPath), range);
      readStream.on("error", (error) => {
        respondHtml(
          response,
          500,
          errorHtml(`Failed to read file\n\n${error.message}`),
        );
      });
      readStream.on("open", () => {
        if (range === undefined) {
          writeHead(response, 200, {
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
          writeHead(response, 206, {
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
  absolutePath: AbsolutePath,
): { tag: "File"; size: number } | { tag: NotFileStat } {
  try {
    const stats = fs.statSync(absolutePath);
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

// Returning `undefined` means ignoring the Range header and serving the whole
// file, which is allowed for unsupported or invalid Range headers.
// See: https://www.rfc-editor.org/rfc/rfc9110#section-14.2
function parseRangeHeader(
  rangeHeader: string,
  fsSize: number,
):
  | { tag: "Range"; start: number; end: number }
  | { tag: "Unsatisfiable"; rangeHeader: string }
  | undefined {
  const match = RANGE_REGEX.exec(rangeHeader);
  if (match === null) {
    return undefined;
  }
  const [, startString = "0", endString = "Infinity"] = match;
  // Very long digit strings become `Infinity` or imprecise numbers, which is
  // fine: They are compared and clamped below.
  const start = Number(startString);
  const end = Number(endString);
  if (start > end) {
    return undefined;
  }
  if (start >= fsSize) {
    return { tag: "Unsatisfiable", rangeHeader };
  }
  return { tag: "Range", start, end: Math.min(end, fsSize - 1) };
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
  url: string,
): FsPath | { tag: "Forbidden"; forbiddenPath: AbsolutePath } {
  const urlWithoutQuery = decodePercentageEscapes(removeQuery(url));

  // Not using `absolutePathFromString` here since it uses `path.resolve`
  // but we need `path.join` (otherwise all URLs would resolve to the root of the file system).
  const fsPathStringRaw = path.join(staticFilesDir, urlWithoutQuery);

  const hadTrailingSlash = fsPathStringRaw.endsWith(path.sep);

  const fsPathString = hadTrailingSlash
    ? fsPathStringRaw.slice(0, -path.sep.length)
    : fsPathStringRaw;

  const absoluteFsPath = markAsAbsolutePath(fsPathString);

  const prefix = staticFilesDir + path.sep;

  // Protect against reading files outside the static files dir.
  // For example: curl http://localhost:8000/%2e%2e/secret.txt
  // Symlinks are followed on purpose, though: If you put a symlink in the
  // static files dir, you probably want it to be served.
  return fsPathString === staticFilesDir
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
  numSegments: number,
): IndexFsPath {
  return {
    tag: "IndexFsPath",
    theIndexFsPath: markAsAbsolutePath(
      path.join(
        staticFilesDir,
        ...fsPath.segments.slice(0, numSegments),
        "index.html",
      ),
    ),
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
