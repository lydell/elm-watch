// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { describe, expect, test } from "vitest";

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
});
