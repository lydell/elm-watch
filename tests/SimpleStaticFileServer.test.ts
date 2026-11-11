// @vitest-environment jsdom
import * as childProcess from "child_process";
import * as fs from "fs";
import * as http from "http";
import type { AddressInfo } from "net";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { describe, expect, test } from "vitest";

import type { ConfigSource } from "../src/Config.ts";
import { DevServer } from "../src/DevServer.ts";
import { markAsHost } from "../src/Host.ts";
import { errorHtml, respondHtml } from "../src/SimpleStaticFileServer.ts";
import {
  markAsAbsolutePath,
  markAsCwd,
  markAsElmWatchJsonPath,
  markAsStaticFilesDir,
  markAsWebSocketToken,
} from "../src/Types.ts";
import {
  httpGet,
  stringSnapshotSerializer,
  testExceptWindows,
} from "./Helpers.ts";
import { fixtureDir, run } from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

type Get = (urlPath: string, options?: http.RequestOptions) => Promise<string>;

function makeRawGet(port: number): Get {
  return (urlPath, options) =>
    // Passing the path separately avoids URL normalization (such as resolving
    // `/%2e%2e/` and percent-encoding non-ASCII), so we can test raw paths.
    httpGet(`http://127.0.0.1:${port}`, { ...options, path: urlPath });
}

function makeGet(port: number, tmpDir: string): Get {
  const rawGet = makeRawGet(port);
  return async (urlPath, options) =>
    (await rawGet(urlPath, options))
      // Only keep status, headers and the <main> content.
      .replace(/<!DOCTYPE[^]*<main>([^]*)<\/main>[^]*/, "$1")
      .split(tmpDir)
      .join("/tmp")
      .replace(/content-length: \d{3,}\n/, "");
}

// Runs the real `DevServer` (which handles Host headers and errors
// thrown by `serveStatic`), serving `staticFilesDir` (relative to a temporary
// directory). `setup` gets the path to a `public` directory in the temporary
// directory (which is the default `staticFilesDir`), to create files in.
async function withServer(
  setup: (dir: string) => void,
  f: (get: Get, port: number) => Promise<void>,
  {
    staticFilesDir = "public",
    configSource = {
      tag: "ElmWatchJson",
      elmWatchJsonPath: markAsElmWatchJsonPath(
        markAsAbsolutePath("/project/elm-watch.json"),
      ),
      cwd: markAsCwd(markAsAbsolutePath("/project")),
    },
  }: { staticFilesDir?: string | null; configSource?: ConfigSource } = {},
): Promise<void> {
  const tmpDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "elm-watch-serve-")),
  );
  const dir = path.join(tmpDir, "public");
  fs.mkdirSync(dir);
  try {
    setup(dir);
    const server = new DevServer({
      createServer: ({ onRequest, onUpgrade }) =>
        http.createServer(onRequest).on("upgrade", onUpgrade),
      getNow: () => new Date(),
      portChoice: { tag: "NoPort" },
      host: markAsHost("127.0.0.1"),
      staticFilesDirectory:
        staticFilesDir === null
          ? undefined
          : markAsStaticFilesDir(
              markAsAbsolutePath(path.join(tmpDir, staticFilesDir)),
            ),
      webSocketToken: markAsWebSocketToken("token"),
      allowedHosts: [],
      configSource,
    });
    try {
      await server.listening;
      await f(makeGet(server.port, tmpDir), server.port);
    } finally {
      await server.close();
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function withHandler(
  handler: http.RequestListener,
  f: (get: Get, rawGet: Get) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  try {
    await f(makeGet(port, "/(unused)"), makeRawGet(port));
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      // Don’t wait for keep-alive connections to time out.
      server.closeAllConnections();
    });
  }
}

function mkfifo(filePath: string): void {
  childProcess.execFileSync("mkfifo", [filePath]);
}

// Node.js’ HTTP client always sends a Host header, and Node.js’ HTTP server
// rejects HTTP/1.1 requests without one. HTTP/1.0 does not require it.
async function http10RequestWithoutHost(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.end("GET / HTTP/1.0\r\n\r\n");
    });
    const chunks: Array<Buffer> = [];
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    socket.on("end", () => {
      const response = Buffer.concat(chunks).toString();
      resolve(
        [
          response.split("\r\n", 1)[0],
          /<main>([^]*)<\/main>/.exec(response)?.[1] ?? response,
        ].join("\n"),
      );
    });
    socket.on("error", reject);
  });
}

describe("SimpleStaticFileServer", () => {
  test("WebSocket server HTTP HTML page", async () => {
    const fixture = "websocket-server-http-html";
    const dir = fixtureDir(fixture);
    const elmWatchJsonPath = path.join(dir, "elm-watch.json");
    const elmWatchJson: unknown = JSON.parse(
      fs.readFileSync(elmWatchJsonPath, "utf8"),
    );
    const portResult = Codec.fields({ port: Codec.number }).decoder(
      elmWatchJson,
    );
    if (portResult.tag === "DecoderError") {
      throw new Error(Codec.format(portResult.error));
    }
    const { port } = portResult.value;

    let mainHtml = "(not set)";

    await run({
      fixture,
      args: ["Main"],
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: async () => {
        mainHtml = await httpGet(`http://localhost:${port}`);
        return "Stop" as const;
      },
    });

    expect(mainHtml.replace(/<head>[^]*<\/head>/, "<head>…</head>"))
      .toMatchInlineSnapshot(`
        200
        content-type: text/html; charset=utf-8
        content-length: 2142
        <!DOCTYPE html>
            <html lang="en">
              <head>…</head>
              <body>
                <main>
              <h1>Enable elm-watch static file server?</h1>
              <p>
                If you want, you can enable a simple static file server for your
                project.
              </p>
              <p>Add the following to your <strong>elm-watch.json</strong> file:</p>
              <pre><code>"serve": "./folder/to/serve/"</code></pre>
            </main>
                <p style="margin-top: 2em">
                  <small
                    >ℹ️ This is the <a href="https://lydell.github.io/elm-watch/server/">elm-watch server</a>.</small
                  >
                </p>
              </body>
            </html>
      `);
  });

  describe("serveStatic", () => {
    test("files", async () => {
      await withServer(
        (dir) => {
          fs.writeFileSync(path.join(dir, "file.txt"), "text");
          fs.writeFileSync(path.join(dir, "style.CSS"), "a{}");
          fs.writeFileSync(path.join(dir, "with space.js"), "1");
          fs.writeFileSync(path.join(dir, "no-extension"), "?");
          fs.mkdirSync(path.join(dir, "sub"));
          fs.writeFileSync(path.join(dir, "sub", "data.json"), "{}");
        },
        async (get) => {
          expect(await get("/file.txt")).toMatchInlineSnapshot(`
            200
            content-type: text/plain; charset=utf-8
            content-length: 4
            text
          `);
          expect(await get("/style.CSS")).toMatchInlineSnapshot(`
            200
            content-type: text/css; charset=utf-8
            content-length: 3
            a{}
          `);
          expect(await get("/with%20space.js")).toMatchInlineSnapshot(`
            200
            content-type: text/javascript; charset=utf-8
            content-length: 1
            1
          `);
          expect(await get("/no-extension")).toMatchInlineSnapshot(`
            200
            content-type: text/plain; charset=utf-8
            content-length: 1
            ?
          `);
          expect(await get("/sub/data.json?query=1")).toMatchInlineSnapshot(`
            200
            content-type: application/json; charset=utf-8
            content-length: 2
            {}
          `);
          expect(await get("/file.txt", { method: "HEAD" }))
            .toMatchInlineSnapshot(`
            200
            content-type: text/plain; charset=utf-8
          `);
        },
      );
    });

    test("not found, without index.html", async () => {
      await withServer(
        (dir) => {
          fs.writeFileSync(path.join(dir, "file.txt"), "text");
          fs.mkdirSync(path.join(dir, "sub"));
        },
        async (get) => {
          expect(await get("/missing")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>404 – Not Found</h1>
                      <p>The URL you requested does not point to any existing file.</p>
                      
                              <p>
                                👉
                                <a href="https://lydell.github.io/elm-watch/server/#indexhtml"
                                  >How index.html files work</a
                                >
                                (for <code>Browser.application</code> programs)
                              </p>
                            
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/missing</pre>
          `);
          expect(await get("/missing.js")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>404 – Not Found</h1>
                      <p>The URL you requested does not point to any existing file.</p>
                      
                              <p>
                                👉
                                <a href="https://lydell.github.io/elm-watch/server/#indexhtml"
                                  >File not found troubleshooting</a
                                >
                              </p>
                            
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/missing.js</pre>
          `);
          expect(await get("/")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>Directory</h1>
                      <p>
                        The URL you requested points to a directory. elm-watch only serves
                        files.
                      </p>
                      <p>Suggestion: Create an <code>index.html</code> file.</p>
                      <p>
                        👉
                        <a href="https://lydell.github.io/elm-watch/server/#indexhtml">How index.html files work</a>
                      </p>
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public</pre>
          `);
          expect(await get("/sub/")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>Directory</h1>
                      <p>
                        The URL you requested points to a directory. elm-watch only serves
                        files.
                      </p>
                      <p>Suggestion: Create an <code>index.html</code> file.</p>
                      <p>
                        👉
                        <a href="https://lydell.github.io/elm-watch/server/#indexhtml">How index.html files work</a>
                      </p>
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/sub</pre>
          `);
          expect(await get("/file.txt/")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>File with trailing slash</h1>
                      <p>
                        The URL you requested points to a file, but the URL has a trailing
                        slash.
                      </p>
                      <p>Servers typically don't allow trailing slashes on files.</p>
                      <p>Suggestion: Remove the trailing slash from the URL.</p>
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/file.txt</pre>
          `);
          // ENOTDIR
          expect(await get("/file.txt/x")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>404 – Not Found</h1>
                      <p>The URL you requested does not point to any existing file.</p>
                      
                              <p>
                                👉
                                <a href="https://lydell.github.io/elm-watch/server/#indexhtml"
                                  >How index.html files work</a
                                >
                                (for <code>Browser.application</code> programs)
                              </p>
                            
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/file.txt/x</pre>
          `);
          // ENAMETOOLONG
          expect(await get(`/${"a".repeat(300)}`)).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>404 – Not Found</h1>
                      <p>The URL you requested does not point to any existing file.</p>
                      
                              <p>
                                👉
                                <a href="https://lydell.github.io/elm-watch/server/#indexhtml"
                                  >How index.html files work</a
                                >
                                (for <code>Browser.application</code> programs)
                              </p>
                            
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</pre>
          `);
          // Invalid percent escape: Used as-is.
          expect(await get("/%E0%A4%A")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>404 – Not Found</h1>
                      <p>The URL you requested does not point to any existing file.</p>
                      
                              <p>
                                👉
                                <a href="https://lydell.github.io/elm-watch/server/#indexhtml"
                                  >How index.html files work</a
                                >
                                (for <code>Browser.application</code> programs)
                              </p>
                            
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/%E0%A4%A</pre>
          `);
        },
      );
    });

    test("index.html", async () => {
      await withServer(
        (dir) => {
          fs.writeFileSync(path.join(dir, "index.html"), "<p>root</p>");
          fs.mkdirSync(path.join(dir, "a", "b"), { recursive: true });
          fs.writeFileSync(path.join(dir, "a", "index.html"), "<p>a</p>");
        },
        async (get) => {
          expect(await get("/")).toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public
            elm-watch-index-html: /tmp/public/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
            <!-- elm-watch debug information:

            hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

            The URL you requested points to a directory. elm-watch only serves files.

            The closest index.html file was served instead:
            /tmp/public/index.html

            This is the directory:
            /tmp/public

            Learn more:
            https://lydell.github.io/elm-watch/server/#indexhtml

            -->
            <p>root</p>
          `);
          expect(await get("/index.html")).toMatchInlineSnapshot(`
            200
            content-type: text/html; charset=utf-8
            content-length: 11
            <p>root</p>
          `);
          expect(await get("/a/b/c/d")).toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public/a/b/c/d
            elm-watch-index-html: /tmp/public/a/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
            <!-- elm-watch debug information:

            hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

            This response could have been served as a 404 (Not Found),
            but was served as 200 (OK) instead, because an index.html file was found.
            This is for supporting Browser.application programs.

            If you expected a file to served rather than this HTML,
            make sure the URL is correct or that this file exists:
            /tmp/public/a/b/c/d

            This is the closest index.html file, which was served instead:
            /tmp/public/a/index.html

            Learn more:
            https://lydell.github.io/elm-watch/server/#indexhtml

            -->
            <p>a</p>
          `);
          expect(await get("/a/b/")).toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public/a/b
            elm-watch-index-html: /tmp/public/a/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
            <!-- elm-watch debug information:

            hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

            The URL you requested points to a directory. elm-watch only serves files.

            The closest index.html file was served instead:
            /tmp/public/a/index.html

            This is the directory:
            /tmp/public/a/b

            Learn more:
            https://lydell.github.io/elm-watch/server/#indexhtml

            -->
            <p>a</p>
          `);
          // Characters not allowed in headers are replaced.
          expect(await get("/%E6%97%A5%E6%9C%AC")).toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public/??
            elm-watch-index-html: /tmp/public/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
            <!-- elm-watch debug information:

            hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

            This response could have been served as a 404 (Not Found),
            but was served as 200 (OK) instead, because an index.html file was found.
            This is for supporting Browser.application programs.

            If you expected a file to served rather than this HTML,
            make sure the URL is correct or that this file exists:
            /tmp/public/日本

            This is the closest index.html file, which was served instead:
            /tmp/public/index.html

            Learn more:
            https://lydell.github.io/elm-watch/server/#indexhtml

            -->
            <p>root</p>
          `);
          expect(await get("/a/missing", { method: "HEAD" }))
            .toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public/a/missing
            elm-watch-index-html: /tmp/public/a/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
          `);
        },
      );
    });

    test("favicon.ico", async () => {
      await withServer(
        (dir) => {
          fs.writeFileSync(path.join(dir, "index.html"), "<p>root</p>");
          fs.mkdirSync(path.join(dir, "a"));
        },
        async (get) => {
          // Empty response rather than index.html.
          expect(await get("/favicon.ico")).toMatchInlineSnapshot(`204`);
          expect(await get("/favicon.ico?v=1")).toMatchInlineSnapshot(`204`);
          // Only at the root.
          expect(await get("/a/favicon.ico")).toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public/a/favicon.ico
            elm-watch-index-html: /tmp/public/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
            <!-- elm-watch debug information:

            hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

            This response could have been served as a 404 (Not Found),
            but was served as 200 (OK) instead, because an index.html file was found.
            This is for supporting Browser.application programs.

            If you expected a file to served rather than this HTML,
            make sure the URL is correct or that this file exists:
            /tmp/public/a/favicon.ico

            This is the closest index.html file, which was served instead:
            /tmp/public/index.html

            Learn more:
            https://lydell.github.io/elm-watch/server/#indexhtml

            -->
            <p>root</p>
          `);
          expect(await get("/favicon.ico/")).toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public/favicon.ico
            elm-watch-index-html: /tmp/public/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
            <!-- elm-watch debug information:

            hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

            This response could have been served as a 404 (Not Found),
            but was served as 200 (OK) instead, because an index.html file was found.
            This is for supporting Browser.application programs.

            If you expected a file to served rather than this HTML,
            make sure the URL is correct or that this file exists:
            /tmp/public/favicon.ico

            This is the closest index.html file, which was served instead:
            /tmp/public/index.html

            Learn more:
            https://lydell.github.io/elm-watch/server/#indexhtml

            -->
            <p>root</p>
          `);
        },
      );

      await withServer(
        (dir) => {
          fs.writeFileSync(path.join(dir, "favicon.ico"), "icon");
        },
        async (get) => {
          // A real favicon.ico is served as usual.
          expect(await get("/favicon.ico")).toMatchInlineSnapshot(`
            200
            content-type: image/x-icon
            content-length: 4
            icon
          `);
        },
      );

      await withServer(
        () => {
          // No index.html.
        },
        async (get) => {
          // Empty response rather than a 404 page.
          expect(await get("/favicon.ico")).toMatchInlineSnapshot(`204`);
        },
      );
    });

    // FIFOs are neither files nor directories.
    testExceptWindows("index.html: skips directories and FIFOs", async () => {
      await withServer(
        (dir) => {
          fs.mkdirSync(path.join(dir, "a", "b"), { recursive: true });
          fs.mkdirSync(path.join(dir, "a", "index.html"));
          mkfifo(path.join(dir, "a", "b", "index.html"));
        },
        async (get) => {
          expect(await get("/a/b/c")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>404 – Not Found</h1>
                      <p>The URL you requested does not point to any existing file.</p>
                      
                              <p>
                                👉
                                <a href="https://lydell.github.io/elm-watch/server/#indexhtml"
                                  >How index.html files work</a
                                >
                                (for <code>Browser.application</code> programs)
                              </p>
                            
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/a/b/c</pre>
          `);
        },
      );
    });

    testExceptWindows("FIFO", async () => {
      await withServer(
        (dir) => {
          mkfifo(path.join(dir, "fifo"));
          fs.mkdirSync(path.join(dir, "sub"));
          fs.writeFileSync(path.join(dir, "sub", "index.html"), "<p>sub</p>");
          mkfifo(path.join(dir, "sub", "fifo"));
        },
        async (get) => {
          expect(await get("/fifo")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                      <h1>Unsupported file system object</h1>
                      <p>
                        The URL you requested points to a something that is neither or file
                        nor a directory. elm-watch only serves files.
                      </p>
                      <p>This is the absolute file path the URL resolves to:</p>
                      <pre>/tmp/public/fifo</pre>
          `);
          expect(await get("/sub/fifo")).toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public/sub/fifo
            elm-watch-index-html: /tmp/public/sub/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
            <!-- elm-watch debug information:

            hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

            The URL you requested points to a something that is neither or file
            nor a directory. elm-watch only serves files.

            This is the absolute file path the URL resolves to:
            /tmp/public/sub/fifo

            This is the closest index.html file, which was served instead:
            /tmp/public/sub/index.html

            Learn more:
            https://lydell.github.io/elm-watch/server/#indexhtml

            -->
            <p>sub</p>
          `);
        },
      );
    });

    test("forbidden", async () => {
      await withServer(
        (dir) => {
          fs.writeFileSync(path.join(dir, "..", "secret.txt"), "secret");
          fs.mkdirSync(path.join(dir, "..", "public2"));
          fs.writeFileSync(
            path.join(dir, "..", "public2", "secret.txt"),
            "secret",
          );
        },
        async (get) => {
          expect(await get("/%2e%2e/secret.txt")).toMatchInlineSnapshot(`
            403
            content-type: text/html; charset=utf-8

                  <h1>Forbidden</h1>
                  <p>
                    You have configured a static files directory
                    in elm-watch.json which resolves to:
                  </p>
                  <pre>/tmp/public</pre>
                  <p>
                    However, the URL you requested points to a file outside of that
                    directory:
                  </p>
                  <pre>/tmp/secret.txt</pre>
          `);
          expect(await get("/%2e%2e")).toMatchInlineSnapshot(`
            403
            content-type: text/html; charset=utf-8

                  <h1>Forbidden</h1>
                  <p>
                    You have configured a static files directory
                    in elm-watch.json which resolves to:
                  </p>
                  <pre>/tmp/public</pre>
                  <p>
                    However, the URL you requested points to a file outside of that
                    directory:
                  </p>
                  <pre>/tmp</pre>
          `);
          expect(await get("/%2e%2e/public2/secret.txt"))
            .toMatchInlineSnapshot(`
              403
              content-type: text/html; charset=utf-8

                    <h1>Forbidden</h1>
                    <p>
                      You have configured a static files directory
                      in elm-watch.json which resolves to:
                    </p>
                    <pre>/tmp/public</pre>
                    <p>
                      However, the URL you requested points to a file outside of that
                      directory:
                    </p>
                    <pre>/tmp/public2/secret.txt</pre>
            `);
        },
      );
    });

    describe("static files directory not found", () => {
      test("does not exist", async () => {
        await withServer(
          () => {
            // Nothing.
          },
          async (get) => {
            expect(await get("/")).toMatchInlineSnapshot(`
              404
              content-type: text/html; charset=utf-8

                    <h1>Static files directory not found</h1>
                    <p>
                      You have configured a static files directory
                      in elm-watch.json which resolves to:
                    </p>
                    <pre>/tmp/missing</pre>
                    <p>However, that directory does not exist.</p>
            `);
          },
          { staticFilesDir: "missing" },
        );
      });

      test("is a file", async () => {
        await withServer(
          (dir) => {
            fs.writeFileSync(path.join(dir, "file.txt"), "text");
          },
          async (get) => {
            expect(await get("/x")).toMatchInlineSnapshot(`
              404
              content-type: text/html; charset=utf-8

                    <h1>Static files directory not found</h1>
                    <p>
                      You have configured a static files directory
                      in elm-watch.json which resolves to:
                    </p>
                    <pre>/tmp/public/file.txt</pre>
                    <p>However, that is a file, not a directory!</p>
            `);
          },
          { staticFilesDir: "public/file.txt" },
        );
      });

      testExceptWindows("is a FIFO", async () => {
        await withServer(
          (dir) => {
            mkfifo(path.join(dir, "fifo"));
          },
          async (get) => {
            expect(await get("/x")).toMatchInlineSnapshot(`
              404
              content-type: text/html; charset=utf-8

                    <h1>Static files directory not found</h1>
                    <p>
                      You have configured a static files directory
                      in elm-watch.json which resolves to:
                    </p>
                    <pre>/tmp/public/fifo</pre>
                    <p>However, that is neither a file nor a directory.</p>
            `);
          },
          { staticFilesDir: "public/fifo" },
        );
      });
    });

    // chmod does not work like this on Windows.
    testExceptWindows("permission errors", async () => {
      let dir = "";
      await withServer(
        (theDir) => {
          dir = theDir;
          fs.writeFileSync(path.join(dir, "unreadable.txt"), "secret");
          fs.chmodSync(path.join(dir, "unreadable.txt"), 0o000);
          fs.mkdirSync(path.join(dir, "locked"));
          fs.chmodSync(path.join(dir, "locked"), 0o000);
        },
        async (get) => {
          try {
            // Reading the file fails.
            expect(await get("/unreadable.txt")).toMatchInlineSnapshot(`
              500
              content-type: text/html; charset=utf-8
              <h1>Failed to read file</h1>
                      <pre>Failed to read file

              EACCES: permission denied, open &apos;/tmp/public/unreadable.txt&apos;</pre>
            `);
            // `stat` fails with an unexpected error, which is thrown and caught by DevServer.
            expect(await get("/locked/file.txt")).toMatchInlineSnapshot(`
              500
              content-type: text/html; charset=utf-8
              <h1>EACCES: permission denied, stat &apos;/tmp/public/locked/file.txt&apos;</h1>
            `);
          } finally {
            // Allow the temporary directory to be removed.
            fs.chmodSync(path.join(dir, "locked"), 0o755);
          }
        },
      );
    });

    test("Host header", async () => {
      await withServer(
        () => {
          // Nothing.
        },
        async (get, port) => {
          expect(await get("/", { headers: { Host: "evil.com" } }))
            .toMatchInlineSnapshot(`
              403
              content-type: text/html; charset=utf-8

                        <h1>Host not allowed</h1>
                        <p>
                          To protect against
                          <a href="https://en.wikipedia.org/wiki/DNS_rebinding"
                            >DNS rebinding</a
                          >
                          attacks, elm-watch only accepts requests for certain hosts. This
                          request was for:
                        </p>
                        <pre>evil.com</pre>
                        <p>
                          localhost, *.localhost, *.local and IP addresses are always allowed.
                          To allow this host too, add it to
                          your <strong>elm-watch.json</strong> file:
                        </p>
                        <pre><code>"allowedHosts": ["evil.com"]</code></pre>
                        
                                <p>
                                  Or set an environment variable (useful if the host changes):
                                </p>
                                <pre><code>ELM_WATCH_ALLOWED_HOSTS=evil.com</code></pre>
                              
                        <p>
                          👉
                          <a href="https://lydell.github.io/elm-watch/server/#allowed-hosts"
                            >Learn more about allowed hosts</a
                          >
                        </p>
            `);
          expect(await http10RequestWithoutHost(port)).toMatchInlineSnapshot(`
            HTTP/1.1 403 Forbidden

                      <h1>Invalid Host header</h1>
                      <p>The request had an invalid or missing Host header:</p>
                      <pre>(missing)</pre>
          `);
        },
      );
    });

    test("wording for the elm-watch options", async () => {
      const configSource: ConfigSource = { tag: "Options" };
      await withServer(
        () => {
          // Nothing.
        },
        async (get) => {
          expect(await get("/", { headers: { Host: "evil.com" } }))
            .toMatchInlineSnapshot(`
              403
              content-type: text/html; charset=utf-8

                        <h1>Host not allowed</h1>
                        <p>
                          To protect against
                          <a href="https://en.wikipedia.org/wiki/DNS_rebinding"
                            >DNS rebinding</a
                          >
                          attacks, elm-watch only accepts requests for certain hosts. This
                          request was for:
                        </p>
                        <pre>evil.com</pre>
                        <p>
                          localhost, *.localhost, *.local and IP addresses are always allowed.
                          To allow this host too, add it to
                          your <strong>elmWatch()</strong> options:
                        </p>
                        <pre><code>allowedHosts: ["evil.com"],</code></pre>
                        
                        <p>
                          👉
                          <a href="https://lydell.github.io/elm-watch/server/#allowed-hosts"
                            >Learn more about allowed hosts</a
                          >
                        </p>
            `);
          expect(await get("/")).toMatchInlineSnapshot(`
            404
            content-type: text/html; charset=utf-8

                  <h1>Static files directory not found</h1>
                  <p>
                    You have configured a static files directory
                    in the elm-watch options which resolves to:
                  </p>
                  <pre>/tmp/missing</pre>
                  <p>However, that directory does not exist.</p>
          `);
        },
        { staticFilesDir: "missing", configSource },
      );
      await withServer(
        () => {
          // Nothing.
        },
        async (get) => {
          expect(await get("/")).toMatchInlineSnapshot(`
            200
            content-type: text/html; charset=utf-8

                  <h1>Enable elm-watch static file server?</h1>
                  <p>
                    If you want, you can enable a simple static file server for your
                    project.
                  </p>
                  <p>Add the following to your <strong>elmWatch()</strong> options:</p>
                  <pre><code>staticFilesDir: "./folder/to/serve/",</code></pre>
          `);
        },
        { staticFilesDir: null, configSource },
      );
    });

    // Symlinks are followed on purpose, even if they point outside of the
    // static files directory: If you put a symlink in there, you probably
    // want it to be served.
    // Creating symlinks requires extra permissions on Windows.
    testExceptWindows("symlinks are followed", async () => {
      await withServer(
        (dir) => {
          fs.writeFileSync(path.join(dir, "file.txt"), "inside");
          fs.mkdirSync(path.join(dir, "..", "outside"));
          fs.writeFileSync(
            path.join(dir, "..", "outside", "file.txt"),
            "outside",
          );
          fs.symlinkSync("file.txt", path.join(dir, "inside.txt"));
          fs.symlinkSync("../outside/file.txt", path.join(dir, "outside.txt"));
          fs.symlinkSync("../outside", path.join(dir, "outside-dir"));
        },
        async (get) => {
          expect(await get("/inside.txt")).toMatchInlineSnapshot(`
            200
            content-type: text/plain; charset=utf-8
            content-length: 6
            inside
          `);
          expect(await get("/outside.txt")).toMatchInlineSnapshot(`
            200
            content-type: text/plain; charset=utf-8
            content-length: 7
            outside
          `);
          expect(await get("/outside-dir/file.txt")).toMatchInlineSnapshot(`
            200
            content-type: text/plain; charset=utf-8
            content-length: 7
            outside
          `);
        },
      );
    });

    test("range requests", async () => {
      await withServer(
        (dir) => {
          fs.writeFileSync(path.join(dir, "file.txt"), "0123456789");
          fs.writeFileSync(path.join(dir, "empty.txt"), "");
          fs.writeFileSync(path.join(dir, "index.html"), "<p>index</p>");
        },
        async (get) => {
          const range = (value: string): http.RequestOptions => ({
            headers: { Range: value },
          });
          expect(await get("/file.txt", range("bytes=2-4")))
            .toMatchInlineSnapshot(`
            206
            content-type: text/plain; charset=utf-8
            content-range: bytes 2-4/10
            content-length: 3
            234
          `);
          // Unsupported Range header: Ignored.
          expect(await get("/file.txt", range("bytes=2-")))
            .toMatchInlineSnapshot(`
            200
            content-type: text/plain; charset=utf-8
            content-length: 10
            0123456789
          `);
          expect(await get("/file.txt", range("bytes=5-2")))
            .toMatchInlineSnapshot(`
            200
            content-type: text/plain; charset=utf-8
            content-length: 10
            0123456789
          `);
          expect(await get("/file.txt", range(`bytes=3-${"9".repeat(400)}`)))
            .toMatchInlineSnapshot(`
            206
            content-type: text/plain; charset=utf-8
            content-range: bytes 3-9/10
            content-length: 7
            3456789
          `);
          expect(await get("/file.txt", range("bytes=10-20")))
            .toMatchInlineSnapshot(`
            416
            content-range: bytes */10
            content-type: text/html; charset=utf-8
            <h1>Range Not Satisfiable</h1>
                    <pre>Range Not Satisfiable

            Requested range: bytes=10-20
            File size: 10 bytes</pre>
          `);
          expect(await get("/empty.txt", range("bytes=0-0")))
            .toMatchInlineSnapshot(`
            416
            content-range: bytes */0
            content-type: text/html; charset=utf-8
            <h1>Range Not Satisfiable</h1>
                    <pre>Range Not Satisfiable

            Requested range: bytes=0-0
            File size: 0 bytes</pre>
          `);
          expect(await get("/not-found", range("bytes=0-2")))
            .toMatchInlineSnapshot(`
            200
            elm-watch-404: /tmp/public/not-found
            elm-watch-index-html: /tmp/public/index.html
            elm-watch-learn-more: https://lydell.github.io/elm-watch/server/#indexhtml
            content-type: text/html; charset=utf-8
            <!-- elm-watch debug information:

            hacky_hint If_you_see_this_in_a_JS_syntax_error_then_your_JS_file_was_not_found___Click_the_file_name_to_the_right_for_more_information /*

            This response could have been served as a 404 (Not Found),
            but was served as 200 (OK) instead, because an index.html file was found.
            This is for supporting Browser.application programs.

            If you expected a file to served rather than this HTML,
            make sure the URL is correct or that this file exists:
            /tmp/public/not-found

            This is the closest index.html file, which was served instead:
            /tmp/public/index.html

            Learn more:
            https://lydell.github.io/elm-watch/server/#indexhtml

            -->
            <p>index</p>
          `);
        },
      );
    });

    test("unsupported method", async () => {
      await withServer(
        () => {
          // Nothing.
        },
        async (get) => {
          expect(await get("/", { method: "POST" })).toMatchInlineSnapshot(`
            405
            allow: GET, HEAD
            content-type: text/html; charset=utf-8
            <h1>Unsupported method</h1>
                    <pre>Unsupported method

            Only GET and HEAD requests are supported. Got: POST</pre>
          `);
        },
      );
    });
  });

  describe("respondHtml", () => {
    function respondAfterHeadersSent(
      headers: Record<string, number | string>,
    ): http.RequestListener {
      return (_request, response) => {
        for (const [name, value] of Object.entries(headers)) {
          response.setHeader(name, value);
        }
        response.writeHead(200);
        respondHtml(response, 500, errorHtml("Error"));
      };
    }

    test("headers already sent, long enough Content-Length", async () => {
      await withHandler(
        respondAfterHeadersSent({ "Content-Length": 5000 }),
        async (get, rawGet) => {
          const raw = await rawGet("/");
          // The HTML is padded with spaces to the previously set Content-Length.
          expect(Buffer.byteLength(raw)).toBe(
            Buffer.byteLength("200\ncontent-length: 5000\n") + 5000,
          );
          expect(raw.endsWith(" ".repeat(100))).toBe(true);
          expect(await get("/")).toMatchInlineSnapshot(`
            200
            <h1>Error</h1>
          `);
        },
      );
    });

    test("headers already sent, too short Content-Length", async () => {
      await withHandler(
        respondAfterHeadersSent({ "Content-Length": 50 }),
        async (get) => {
          expect(await get("/")).toMatchInlineSnapshot(`
            200
            content-length: 50
            <h1>Error</h1>
          `);
        },
      );
    });

    test("headers already sent, no Content-Length", async () => {
      await withHandler(respondAfterHeadersSent({}), async (get) => {
        expect(await get("/")).toMatchInlineSnapshot(`
          200
          transfer-encoding: chunked
          <h1>Error</h1>
        `);
      });
    });
  });
});
