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
import { httpGet, stringSnapshotSerializer } from "./Helpers";
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
