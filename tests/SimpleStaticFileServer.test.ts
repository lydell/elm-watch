// @vitest-environment jsdom
import * as fs from "fs";
import * as http from "http";
import type { AddressInfo } from "net";
import * as os from "os";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { describe, expect, test } from "vitest";

import { toError } from "../src/Helpers";
import {
  errorHtml,
  respondHtml,
  serveStatic,
} from "../src/SimpleStaticFileServer";
import { markAsAbsolutePath, markAsStaticFilesDir } from "../src/Types";
import {
  httpGet,
  stringSnapshotSerializer,
  testExceptWindows,
} from "./Helpers";
import { FIXTURES_DIR, run } from "./HotHelpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("SimpleStaticFileServer", () => {
  test("WebSocket server HTTP HTML page", async () => {
    const fixture = "websocket-server-http-html";
    const dir = path.join(FIXTURES_DIR, fixture);
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
    async function withServer(
      setup: (dir: string) => void,
      f: (
        get: (
          urlPath: string,
          options?: http.RequestOptions,
        ) => Promise<string>,
      ) => Promise<void>,
    ): Promise<void> {
      const tmpDir = fs.realpathSync(
        fs.mkdtempSync(path.join(os.tmpdir(), "elm-watch-serve-")),
      );
      const dir = path.join(tmpDir, "public");
      fs.mkdirSync(dir);
      setup(dir);
      const server = http.createServer((request, response) => {
        try {
          serveStatic(markAsStaticFilesDir(markAsAbsolutePath(dir)))(
            request,
            response,
          );
        } catch (error) {
          respondHtml(response, 500, errorHtml(toError(error).message));
        }
      });
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as AddressInfo;
      try {
        await f(async (urlPath, options) =>
          (await httpGet(`http://127.0.0.1:${port}${urlPath}`, options))
            // Only keep status, headers and the <main> content.
            .replace(/<!DOCTYPE[^]*<main>([^]*)<\/main>[^]*/, "$1")
            .split(tmpDir)
            .join("/tmp")
            .replace(/content-length: \d{3,}\n/, ""),
        );
      } finally {
        await new Promise((resolve) => {
          server.close(resolve);
          // Don’t wait for keep-alive connections to time out.
          server.closeAllConnections();
        });
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }

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
});
