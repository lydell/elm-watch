// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import {
  grep,
  onlyErrorMessages,
  rimraf,
  rm,
  stringSnapshotSerializer,
  testExceptWindows,
  touch,
  wait,
  waitFor,
} from "./Helpers";
import {
  cleanupAfterEachTest,
  collapseUi,
  expandUi,
  fixtureDir,
  run,
} from "./HotHelpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  afterEach(cleanupAfterEachTest);

  test("changes to elm-watch.json", async () => {
    const fixture = "changes-to-elm-watch-json";
    const dir = fixtureDir(fixture);
    const elmWatchJsonPath = path.join(dir, "elm-watch.json");
    const elmWatchJsonPath2 = path.join(dir, "src", "elm-watch.json");
    const elmWatchJsonTemplatePath = path.join(dir, "elm-watch.template.json");
    const roguePath = path.join(dir, "rogue", "elm-watch.json");
    const elmWatchJsonString = fs
      .readFileSync(elmWatchJsonTemplatePath, "utf8")
      .replace(/\r\n/g, "\n");
    fs.writeFileSync(elmWatchJsonPath, elmWatchJsonString);
    fs.writeFileSync(roguePath, "ROGUE");
    rm(elmWatchJsonPath2);

    const { terminal } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      cwd: "src",
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: async ({ idle, div, stdout }) => {
        switch (idle) {
          case 1:
            assert1(div);
            touch(roguePath);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.slice(0, -10),
            );
            await waitFor(() =>
              stdout.getOutput().includes("I had trouble with the JSON inside"),
            );
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.replace(/"postprocess":.*/, ""),
            );
            return "KeepGoing" as const;
          case 2:
            assert2(div);
            fs.writeFileSync(elmWatchJsonPath2, "{}");
            await waitFor(() =>
              stdout.getOutput().includes('a field called: "targets"'),
            );
            fs.unlinkSync(elmWatchJsonPath2);
            return "KeepGoing";
          case 3:
            assert3(div);
            fs.unlinkSync(elmWatchJsonPath);
            return "KeepGoing";
          default:
            throw new Error(
              "Expected elm-watch to exit due to no elm-watch.json!",
            );
        }
      },
    });

    await window.__ELM_WATCH.KILL_MATCHING(/^/);

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble with the JSON inside:⧘

      At root:
      SyntaxError: (JSON syntax error)

      …

      ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/src/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble with the JSON inside:⧘

      At root:
      Expected an object with a field called: "targets"
      Got: {}

      …

      ⧙-- elm-watch.json NOT FOUND ----------------------------------------------------⧘

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙But I couldn't find one!⧘

      You need to create one with JSON like this:

      {
          "targets": {
              "My target name": {
                  "inputs": [
                      "src/Main.elm"
                  ],
                  "output": "build/main.js"
              }
          }
      }
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>THE TEXT!</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }

    function assert3(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("changes to elm.json", async () => {
    const fixture = "changes-to-elm-json";
    const dir = fixtureDir(fixture);
    const elmJsonPath = path.join(dir, "elm.json");
    const elmJsonPathSub = path.join(dir, "src", "Sub", "elm.json");
    const elmJsonTemplatePath = path.join(dir, "elm.template.json");
    const roguePath = path.join(dir, "rogue", "elm.json");
    const inputPath = path.join(dir, "src", "HtmlMain.elm");
    const otherInputPath = path.join(dir, "src", "Sub", "OtherMain.elm");
    const elmJsonString = fs
      .readFileSync(elmJsonTemplatePath, "utf8")
      .replace(/\r\n/g, "\n");
    fs.writeFileSync(elmJsonPath, elmJsonString);
    fs.writeFileSync(roguePath, "ROGUE");
    rm(elmJsonPathSub);

    const { terminal, onlyExpandedRenders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      cwd: "src",
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert(div);
            fs.writeFileSync(elmJsonPath, elmJsonString.slice(0, -10));
            touch(roguePath);
            return "KeepGoing";
          case 2:
            fs.writeFileSync(elmJsonPath, elmJsonString);
            return "KeepGoing";
          case 3:
            fs.writeFileSync(elmJsonPathSub, elmJsonString);
            return "KeepGoing";
          case 4:
            touch(otherInputPath);
            return "KeepGoing";
          case 5:
            fs.unlinkSync(elmJsonPath);
            return "KeepGoing";
          case 6:
            expandUi();
            touch(inputPath);
            return "KeepGoing";
          case 7:
            touch(otherInputPath);
            collapseUi();
            return "KeepGoing";
          case 8:
            fs.unlinkSync(elmJsonPathSub);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- EXTRA COMMA -----------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      I ran into a problem with your elm.json file. I was partway through parsing a
      JSON object when I got stuck here:

      20|     "test-dependencies": {
      21|         "direct": {},
      22|         "indirect": {
                               ⧙^⧘
      I saw a comma right before I got stuck here, so I was expecting to see a field
      name like ⧙"type"⧘ or ⧙"dependencies"⧘ next.

      This error is commonly caused by trailing commas in JSON objects. Those are
      actually disallowed by <https://json.org> so check the previous line for a
      trailing comma that may need to be deleted.

      ⧙Note⧘: Here is an example of a valid JSON object for reference:

          {
            ⧙"name"⧘: ⧙"Tom"⧘,
            ⧙"age"⧘: ⧙42⧘
          }

      Notice that (1) the field names are in double quotes and (2) there is no
      trailing comma after the last entry. Both are strict requirements in JSON!

      …

      ⧙-- NO UNIQUE elm.json ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I went looking for an ⧙elm.json⧘ for your inputs, but I found more than one!

      src/HtmlMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      It doesn't make sense to compile Elm files from different projects into one output.

      Either split this target, or move the inputs to the same project with the same
      ⧙elm.json⧘.

      …

      ⧙-- NO UNIQUE elm.json ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I went looking for an ⧙elm.json⧘ for your inputs, but I found more than one!

      src/HtmlMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      It doesn't make sense to compile Elm files from different projects into one output.

      Either split this target, or move the inputs to the same project with the same
      ⧙elm.json⧘.

      …

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      …

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      …

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      …

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm
      src/Sub/OtherMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?
    `);

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      target HtmlMain
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status elm.json or inputs error
      -- elm.json NOT FOUND ----------------------------------------------------------
      Target: HtmlMain

      I could not find an elm.json for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run elm init to create one?

      Note that I did find an elm.json for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single elm.json covers all the inputs together!
      ▲ 🚨 13:10:05 HtmlMain
      ================================================================================
      target HtmlMain
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status elm.json or inputs error
      -- elm.json NOT FOUND ----------------------------------------------------------
      Target: HtmlMain

      I could not find an elm.json for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run elm init to create one?

      Note that I did find an elm.json for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single elm.json covers all the inputs together!
      ▲ 🚨 13:10:05 HtmlMain
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("WebSocket message during restart", async () => {
    // When elm.json changes, elm-watch restarts but keeps the WebSocket server.
    // Messages received during the restart are queued and replayed once the
    // new run is set up. Replaying them used to crash with:
    // ReferenceError: Cannot access 'mutable' before initialization
    // The fake `elm` connects to the WebSocket server when `elm --version` is
    // run during the restart, so that a message is queued.
    const elmJsonPath = path.join(fixtureDir("basic"), "elm.json");

    const { terminal } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      isTTY: false,
      bin: "connect-during-restart",
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            touch(elmJsonPath);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      📊 ⧙server:⧘ http://localhost:59123
      ⏳ Html: elm make (typecheck only)
      ✅ Html⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Html: elm make
      ✅ Html⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Html⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Html⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Html: elm make
      ✅ Html⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/basic/elm.json⧘
      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Html⧘
      ℹ️ ⧙13:10:05⧘ ⧙Web socket disconnected for: Html⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("changes to elm.json – typecheck only", async () => {
    const fixture = "changes-to-elm-json";
    const dir = fixtureDir(fixture);
    const elmJsonPath = path.join(dir, "elm.json");
    const elmJsonTemplatePath = path.join(dir, "elm.template.json");
    const elmJsonString = fs
      .readFileSync(elmJsonTemplatePath, "utf8")
      .replace(/\r\n/g, "\n");
    fs.writeFileSync(elmJsonPath, elmJsonString);

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1:
            fs.writeFileSync(elmJsonPath, elmJsonString.slice(0, -10));
            return "KeepGoing";
          default:
            await wait(100);
            return "Stop";
        }
      },
    });

    // Both Elm and the Walker will fail on the invalid elm.json, but only the Elm error should be shown.
    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- EXTRA COMMA -----------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      I ran into a problem with your elm.json file. I was partway through parsing a
      JSON object when I got stuck here:

      20|     "test-dependencies": {
      21|         "direct": {},
      22|         "indirect": {
                               ⧙^⧘
      I saw a comma right before I got stuck here, so I was expecting to see a field
      name like ⧙"type"⧘ or ⧙"dependencies"⧘ next.

      This error is commonly caused by trailing commas in JSON objects. Those are
      actually disallowed by <https://json.org> so check the previous line for a
      trailing comma that may need to be deleted.

      ⧙Note⧘: Here is an example of a valid JSON object for reference:

          {
            ⧙"name"⧘: ⧙"Tom"⧘,
            ⧙"age"⧘: ⧙42⧘
          }

      Notice that (1) the field names are in double quotes and (2) there is no
      trailing comma after the last entry. Both are strict requirements in JSON!
    `);
  });

  test("delete elm-stuff", async () => {
    const fixture = "delete-elm-stuff";
    const dir = fixtureDir(fixture);
    const elmStuff = path.join(dir, "elm-stuff");
    const elmStuff2 = path.join(dir, "src", "elm-stuff");
    const iDat = path.join(elmStuff, "0.19.1", "i.dat");
    const main = path.join(dir, "src", "Main.elm");
    rm(elmStuff2);
    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      useElmErrorWorkaround: false,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1:
            fs.writeFileSync(iDat, fs.readFileSync(iDat).subarray(0, 128));
            touch(main);
            fs.mkdirSync(elmStuff2);
            return "KeepGoing";
          case 2:
            await rimraf(elmStuff);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- CORRUPT CACHE ---------------------------------------------------------------⧘
      ⧙Target: Main⧘

      +-------------------------------------------------------------------------------
      |  Corrupt File: /Users/you/project/tests/fixtures/hot/delete-elm-stuff/elm-stuff/0.19.1/i.dat
      |   Byte Offset: 127
      |       Message: not enough bytes
      |
      | Please report this to https://github.com/elm/compiler/issues
      | Trying to continue anyway.
      +-------------------------------------------------------------------------------

      It looks like some of the information cached in elm-stuff/ has been corrupted.

      Try deleting your elm-stuff/ directory to get unstuck.

      ⧙Note⧘: This almost certainly means that a 3rd party tool (or editor plugin) is
      causing problems your the elm-stuff/ directory. Try disabling 3rd party tools
      one by one until you figure out which it is!
    `);

    expect(terminal.split("\n").slice(-2).join("\n")).toMatchInlineSnapshot(`
      ℹ️ ⧙13:10:05⧘ ⧙Removed /Users/you/project/tests/fixtures/hot/delete-elm-stuff/elm-stuff⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("changes to elm-watch-node JS file", async () => {
    const fixture = "changes-to-postprocess";
    const postprocessPath = path.join(fixtureDir(fixture), "postprocess.js");
    const postprocessTemplatePath = path.join(
      fixtureDir(fixture),
      "postprocess.template.js",
    );
    const roguePath = path.join(fixtureDir(fixture), "src", "postprocess.js");
    const postprocessString = fs
      .readFileSync(postprocessTemplatePath, "utf8")
      .replace(/\r\n/g, "\n");
    fs.writeFileSync(postprocessPath, postprocessString);
    fs.writeFileSync(roguePath, "ROGUE");

    const { terminal } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            fs.writeFileSync(postprocessPath, postprocessString.slice(0, -10));
            touch(roguePath);
            return "KeepGoing";
          case 2:
            fs.writeFileSync(
              postprocessPath,
              postprocessString.replace("toUpperCase", "toLowerCase"),
            );
            return "KeepGoing";
          case 3:
            assert2(div);
            fs.unlinkSync(postprocessPath);
            return "KeepGoing";
          case 4:
            fs.writeFileSync(postprocessPath, postprocessString);
            return "KeepGoing";
          default:
            assert3(div);
            return "Stop";
        }
      },
    });

    expect(onlyErrorMessages(terminal.replace(/^ +at.+\n/gm, "")))
      .toMatchInlineSnapshot(`
      ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js

      I tried to import your postprocess file:

      const imported = await import("file:///Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js")

      But that resulted in this error:

      SyntaxError: missing ) after argument list

      …

      ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js

      I tried to import your postprocess file:

      const imported = await import("file:///Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js")

      But that resulted in this error:

      Cannot find module '/Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js' imported from /Users/you/project/src/PostprocessWorker.ts
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>THE TEXT!</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>the text!</div>`);
    }

    function assert3(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>THE TEXT!</div>`);
    }
  });

  // - Create and delete directories named `Something.elm`.
  // - Create and delete a file named like a package (`Html.elm`).
  test("changes to .elm files", async () => {
    const fixture = "changes-to-elm-files";
    const htmlPath = path.join(fixtureDir(fixture), "src", "Html.elm");
    rm(htmlPath);

    const { terminal } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      cwd: "src",
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert(div);
            fs.mkdirSync(htmlPath);
            return "KeepGoing";
          case 2:
            fs.rmdirSync(htmlPath);
            return "KeepGoing";
          case 3:
            fs.writeFileSync(htmlPath, "");
            return "KeepGoing";
          case 4:
            fs.unlinkSync(htmlPath);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING ELM FILES ---------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      When figuring out all Elm files that your inputs depend on I read a lot of Elm files.
      Doing so I encountered this error:

      EISDIR: illegal operation on a directory, read

      (I still managed to compile your code, but the watcher will not work properly
      and "postprocess" was not run.)

      …

      ⧙-- AMBIGUOUS IMPORT ------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/HtmlMain.elm:3:8

      You are trying to import a \`Html\` module:

      3| import Html
                ⧙^^^^⧘
      But I found multiple modules with that name. One in the ⧙elm/html⧘ package, and
      another defined locally in the
      ⧙/Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      file. I do not have a way to choose between them.

      Try changing the name of the locally defined module to clear up the ambiguity?
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("non interesting .elm files changed, with disabled targets", async () => {
    const fixture = "non-interesting-elm-files-changed-disabled-targets";
    const unusedFolder = path.join(fixtureDir(fixture), "src", "Unused");

    const { terminal } = await run({
      fixture,
      args: ["HtmlMain1"],
      scripts: ["HtmlMain1.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain1"]?.init({ node });
      },
      onIdle: async ({ div, stdout }) => {
        assert(div);
        const files = fs.readdirSync(unusedFolder);
        for (const filePath of files) {
          await wait(1);
          touch(path.join(unusedFolder, filePath));
        }
        await waitFor(() => {
          const output = stdout.getOutput();
          return (
            (output.match(/Changed/g) ?? []).length === files.length &&
            /Changed.*\n.*FYI.*\s*$/.test(output)
          );
        });
        return "Stop" as const;
      },
    });

    // The order in which the files are detected by the watcher
    // is not defined when they happen so close to each other.
    expect(grep(terminal, /Changed/).replace(/\w+\.elm/g, "File.elm"))
      .toMatchInlineSnapshot(`
      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File.elm⧘
      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File.elm⧘
    `);

    // The changes usually end up in the same batch, but not always.
    expect(grep(terminal, /FYI/).split("\n").at(-1)).toMatch(
      /FYI: The above Elm files? (?:are|is) not imported by any of the enabled targets\. Nothing to do!/,
    );

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("non interesting .elm files changed, with all targets enabled", async () => {
    const fixture = "non-interesting-elm-files-changed-all-targets";
    const unusedFile1 = path.join(fixtureDir(fixture), "src", "Unused.elm");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: async ({ div, stdout }) => {
        assert(div);
        touch(unusedFile1);
        await waitFor(() => stdout.getOutput().includes("FYI"));
        return "Stop" as const;
      },
    });

    expect(grep(terminal, /Changed|FYI/)).toMatchInlineSnapshot(`
      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-all-targets/src/Unused.elm⧘
      ✅ ⧙13:10:05⧘ FYI: The above Elm file is not imported by any target. Nothing to do!
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("two changes at the same time", async () => {
    // Note: This uses its own fixture because it has a tendency to write files
    // to `build/` while the next test is removing `build/` – on Windows only.
    const fixture = "two-changes-at-the-same-time";
    const src = path.join(fixtureDir(fixture), "src");
    const inputFile1 = path.join(src, "HtmlMain.elm");
    const inputFile2 = path.join(src, "Worker.elm");

    const { terminal, renders } = await run({
      fixture,
      args: ["Html", "Worker"],
      scripts: ["Html.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1:
            touch(inputFile1);
            touch(inputFile2);
            return "KeepGoing";
          default:
            await wait(100);
            return "Stop";
        }
      },
    });

    // The order in which the files are detected by the watcher
    // is not defined when they happen so close to each other.
    const adjustedTerminal = terminal.replace(/\w+\.elm/g, "File.elm");

    expect(adjustedTerminal).toMatchInlineSnapshot(`
      📊 ⧙server:⧘ http://localhost:59123
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Html: elm make (typecheck only)
      ⏳ Worker: elm make (typecheck only)
      ✅ Html⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Worker⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Html: elm make
      ✅ Html⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Html⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Html⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Html: elm make
      ⚪️ Worker: queued
      ✅ Html⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Worker: elm make (typecheck only)
      ✅ Worker⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/two-changes-at-the-same-time/src/File.elm⧘
      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/two-changes-at-the-same-time/src/File.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ 🔌 13:10:05 Html
      ================================================================================
      ▼ 🔌 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ ✅ 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ ✅ 13:10:05 Html
    `);
  });

  testExceptWindows(
    "typecheck-only should not break because of duplicate inputs",
    async () => {
      const { terminal, renders } = await run({
        fixture: "typecheck-only-unique",
        args: [],
        scripts: ["Main.js"],
        isTTY: false,
        init: (node) => {
          window.Elm?.["Main"]?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(grep(terminal, /elm make/)).toMatchInlineSnapshot(`
        ⏳ Target1: elm make (typecheck only)
        ⏳ Target2: elm make (typecheck only)
        ⏳ Target3: elm make (typecheck only)
        ⏳ Target1: elm make
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Target1
        ================================================================================
        ▼ ⏳ 13:10:05 Target1
        ================================================================================
        ▼ ⏳ 13:10:05 Target1
        ================================================================================
        ▼ 🔌 13:10:05 Target1
        ================================================================================
        ▼ 🔌 13:10:05 Target1
        ================================================================================
        ▼ ⏳ 13:10:05 Target1
        ================================================================================
        ▼ ✅ 13:10:05 Target1
      `);
    },
  );

  test("elm compilation errors from the start, with terminal resize", async () => {
    const fixture = "compile-error";

    const main = path.join(fixtureDir(fixture), "src", "Main.elm");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      init: () => {
        // Do nothing
      },
      onIdle: ({ idle, stdout }) => {
        switch (idle) {
          case 1:
            stdout.resize(60);
            touch(main);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- WEIRD DECLARATION -----------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/compile-error/src/Main.elm:1:1

      I am trying to parse a declaration, but I am getting stuck here:

      1| 
         ⧙^⧘
      When a line has no spaces at the beginning, I expect it to be a declaration like
      one of these:

          greet : String -> String
          greet name =
            ⧙"Hello "⧘ ++ name ++ ⧙"!"⧘
          
          ⧙type⧘ User = Anonymous | LoggedIn String

      Try to make your declaration look like one of those? Or if this is not supposed
      to be a declaration, try adding some spaces before it?

      …

      ⧙-- WEIRD DECLARATION ---------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/compile-error/src/Main.elm:1:1

      I am trying to parse a declaration, but I am getting stuck here:

      1| 
         ⧙^⧘
      When a line has no spaces at the beginning, I expect it to be a declaration like
      one of these:

          greet : String -> String
          greet name =
            ⧙"Hello "⧘ ++ name ++ ⧙"!"⧘
          
          ⧙type⧘ User = Anonymous | LoggedIn String

      Try to make your declaration look like one of those? Or if this is not supposed
      to be a declaration, try adding some spaces before it?
    `);
  });
});
