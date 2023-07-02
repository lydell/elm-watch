import * as fs from "fs";
import * as http from "http";
import * as path from "path";

import { join, toError } from "./Helpers";
import { AbsolutePath } from "./Types";

let lastHtmlFileUrlState: string | undefined = undefined;

const HTML_FILE_COOKIE = "__elm-watch-html-file";
const HTML_FILE_COOKIE_MAX_AGE = 31536000; // 1 year in seconds
const ACCEPTABLE_HTML_FILE_URL = /^\/(?:[^.?]|\.(?!\.))+\.html?$/i;

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
      input:not([checked]):not(:checked) ~ a,
      input[checked]:checked ~ a { display: none; }
    </style>
  </head>
  <body>
    ${body.trim()}
    <p style="margin-top: 2em"><small>ℹ️ This is the elm-watch WebSocket and simple HTTP server.</small></p>
  </body>
</html>
  `.trim();
}

function indexHtml(
  urlWithoutQuery: string,
  htmlFileUrlFromCookie: string | undefined,
  entries: Array<fs.Dirent>
): string {
  return baseHtml(
    urlWithoutQuery,
    `
<h1>${indexTitle(urlWithoutQuery)}</h1>
${
  htmlFileUrlFromCookie === undefined
    ? ""
    : checkboxHtml(
        urlWithoutQuery,
        htmlFileUrlFromCookie,
        true,
        `Serve on 404: <a href="${escapeHtml(
          htmlFileUrlFromCookie
        )}">${escapeHtml(htmlFileUrlFromCookie)}</a>`
      )
}
<ul>
${
  urlWithoutQuery === "/"
    ? ""
    : `<li data-marker="📁"><a href="../?">../</a></li>`
}
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
            )}/?">${escapeHtml(entry.name)}/</a></li>`,
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

function notFoundHtml(
  staticDir: AbsolutePath,
  urlWithoutQuery: string,
  htmlFileUrlFromCookie: string | undefined
): string {
  return baseHtml(
    "Not Found",
    `
<h1>${notFoundTitle(staticDir, urlWithoutQuery)}</h1>
<h2>404 – Not Found</h2>
${notFoundHtmlFileWithCheckboxHtml(urlWithoutQuery, htmlFileUrlFromCookie)}
    `
  );
}

function notFoundHtmlFileWithCheckboxHtml(
  urlWithoutQuery: string,
  htmlFileUrlFromCookie: string | undefined
): string {
  return htmlFileUrlFromCookie === undefined
    ? lastHtmlFileUrlState === undefined
      ? ""
      : `
        <p>👉 Most recently served HTML file: <a href="${escapeHtml(
          lastHtmlFileUrlState
        )}">${escapeHtml(lastHtmlFileUrlState)}</a></p>
        ${checkboxHtml(
          urlWithoutQuery,
          lastHtmlFileUrlState,
          false,
          "Always serve that file on 404"
        )}
      `
    : checkboxHtml(
        urlWithoutQuery,
        htmlFileUrlFromCookie,
        true,
        `Serve on 404: <a href="${escapeHtml(
          htmlFileUrlFromCookie
        )}">${escapeHtml(htmlFileUrlFromCookie)}</a>`
      );
}

function checkboxHtml(
  urlWithoutQuery: string,
  htmlFileUrl: string,
  checked: boolean,
  label: string
): string {
  return `
  <div style="display: grid; grid-template-columns: min-content auto; gap: 0.125em 0.25em">
    <input type="checkbox" id="htmlFileUrl" ${
      checked ? "checked" : ""
    } onchange='document.cookie = this.checked ? ${JSON.stringify(
    htmlFileCookieString(htmlFileUrl, HTML_FILE_COOKIE_MAX_AGE)
  )} : ${JSON.stringify(htmlFileCookieString("x", 0))}' />
    <label for="htmlFileUrl">${label}</label>
    <small style="grid-column: 2">(except if URL ends with /?, saved in a cookie)</small>
    <a href="${urlWithoutQuery.replace(
      /\/\?$/,
      ""
    )}" style="grid-column: 2"><strong>Refresh</strong></a>
  </div>
  `;
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

function indexTitle(urlWithoutQuery: string): string {
  const segments = urlWithoutQuery.split("/").slice(0, -1);
  const lastIndex = segments.length - 1;
  return join(
    segments.map((segment, index) =>
      index === lastIndex
        ? `${escapeHtml(segment)}/`
        : `<a href="${escapeHtml(
            join(segments.slice(0, index + 1), "/")
          )}/?">${escapeHtml(segment)}/</a>`
    ),
    ""
  );
}

function notFoundTitle(
  staticDir: AbsolutePath,
  urlWithoutQuery: string
): string {
  const segments = urlWithoutQuery.split("/");
  const lastIndex = segments.length - 1;
  let html = "";

  for (const [index, segment] of segments.entries()) {
    const fsPath =
      staticDir.absolutePath + join(segments.slice(0, index + 1), "/");

    let stats;
    try {
      stats = statSync(fsPath);
    } catch {
      html += `<del>${join(segments.slice(index), "/")}</del>`;
      return html;
    }

    switch (stats.tag) {
      case "File":
        html += `<a href="${escapeHtml(
          join(segments.slice(0, index + 1), "/")
        )}">${escapeHtml(segment)}</a>`;
        if (index < lastIndex) {
          html += `<del>/${join(segments.slice(index + 1), "/")}</del>`;
        }
        return html;

      case "Directory":
        html += `<a href="${escapeHtml(
          join(segments.slice(0, index + 1), "/")
        )}/?">${escapeHtml(segment)}/</a>`;
        break;

      case "Other":
      case "NotFound":
        html += `<del>${join(segments.slice(index), "/")}</del>`;
        return html;
    }
  }

  return html;
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

// Note: This function may throw file system errors.
export function serveStatic(staticDir: AbsolutePath): http.RequestListener {
  return (request, response) => {
    switch (request.method) {
      case "HEAD":
      case "GET": {
        // In my testing:
        // - `request.url` always starts with a `/`.
        // - Never contains `../` or `./` – those have already been resolved somewhere.
        // - Mixing backslash and forward slash works fine on Windows.
        const { url = "/" } = request;
        const urlWithoutQuery = removeQuery(url);
        const fsPath = staticDir.absolutePath + urlWithoutQuery;
        const stats = statSync(fsPath);
        const htmlFileUrlFromCookieRaw =
          request.headers.cookie === undefined
            ? undefined
            : getHtmlFileUrl(request.headers.cookie);

        let htmlFileUrlFromCookie = undefined;
        if (
          htmlFileUrlFromCookieRaw !== undefined &&
          ACCEPTABLE_HTML_FILE_URL.test(htmlFileUrlFromCookieRaw)
        ) {
          htmlFileUrlFromCookie = htmlFileUrlFromCookieRaw;
        } else {
          deleteHtmlFileCookie(response);
        }

        // Serve the saved HTML file for non-file requests.
        if (
          htmlFileUrlFromCookie !== undefined &&
          request.method === "GET" &&
          stats.tag !== "File" &&
          !url.endsWith("/?") // Still allow index pages.
        ) {
          const htmlFsPath = staticDir.absolutePath + htmlFileUrlFromCookie;
          const htmlStats = statSync(htmlFsPath);
          switch (htmlStats.tag) {
            case "File":
              // Bump the cookie expiration.
              setHtmlFileCookie(
                response,
                htmlFileUrlFromCookie,
                HTML_FILE_COOKIE_MAX_AGE
              );
              serveFile(
                htmlFsPath,
                htmlStats.size,
                htmlFileUrlFromCookie,
                request,
                response
              );
              return;

            case "Directory":
            case "Other":
            case "NotFound":
              deleteHtmlFileCookie(response);
          }
        }

        switch (stats.tag) {
          case "NotFound":
          case "Other":
            respondHtml(
              response,
              404,
              notFoundHtml(staticDir, urlWithoutQuery, htmlFileUrlFromCookie)
            );
            return;

          case "File":
            serveFile(fsPath, stats.size, urlWithoutQuery, request, response);
            return;

          case "Directory":
            if (url.endsWith("/")) {
              const indexFsPath = `${fsPath}index.html`;
              const indexStats = statSync(indexFsPath);
              switch (indexStats.tag) {
                case "File":
                  serveFile(
                    indexFsPath,
                    indexStats.size,
                    `${urlWithoutQuery}index.html`,
                    request,
                    response
                  );
                  break;

                case "Directory":
                case "Other":
                case "NotFound":
                  response.writeHead(302, { Location: `${urlWithoutQuery}?` });
                  response.end();
                  break;
              }
            } else if (url.endsWith("/?")) {
              const entries = fs.readdirSync(fsPath, {
                withFileTypes: true,
              });
              respondHtml(
                response,
                200,
                request.method === "HEAD"
                  ? ""
                  : indexHtml(urlWithoutQuery, htmlFileUrlFromCookie, entries)
              );
            } else {
              response.writeHead(302, { Location: `${urlWithoutQuery}/?` });
              response.end();
            }
            return;
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

function serveFile(
  fsPath: string,
  fsSize: number,
  actualUrl: string,
  request: http.IncomingMessage,
  response: http.ServerResponse
): void {
  const contentType =
    MIME_TYPES[path.extname(fsPath).toLowerCase()] ??
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
      if (contentType.startsWith("text/html;")) {
        lastHtmlFileUrlState = actualUrl;
      }

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

function getHtmlFileUrl(cookieHeader: string): string | undefined {
  const prefix = `${HTML_FILE_COOKIE}=`;
  const value = cookieHeader
    .split("; ")
    .find((part) => part.startsWith(prefix));
  return value === undefined
    ? undefined
    : decodeCookieValue(value.slice(prefix.length));
}

function htmlFileCookieString(value: string, maxAge: number): string {
  return `${HTML_FILE_COOKIE}=${encodeCookieValue(
    value
  )}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function setHtmlFileCookie(
  response: http.ServerResponse,
  value: string,
  maxAge: number
): void {
  response.setHeader("Set-Cookie", htmlFileCookieString(value, maxAge));
}

function deleteHtmlFileCookie(response: http.ServerResponse): void {
  setHtmlFileCookie(response, "x", 0);
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeCookieValue(value: string): string {
  // Slashes are allowed unescaped, and makes it much easier to read the value as a human.
  // See: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#attributes
  return encodeURIComponent(value).replace(/%2F/g, "/");
}

const QUERY_REGEX = /\?[^]*$/;

function removeQuery(url: string): string {
  return url.replace(QUERY_REGEX, "");
}
