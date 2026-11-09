// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import {
  onlyErrorMessages,
  rm,
  stringSnapshotSerializer,
  touch,
  waitFor,
} from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  collapseUi,
  expandUi,
  fixtureDir,
  run,
  waitForWatcherToSettle,
} from "./HotHelpers.ts";

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
        // elm-watch prints “error found” once it is ready to pick up the next
        // change to elm-watch.json.
        const countErrorsFound = (): number =>
          stdout.getOutput().split("error found").length - 1;
        const errorsFound = countErrorsFound();
        switch (idle) {
          case 1:
            assert1(div);
            touch(roguePath);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.slice(0, -10),
            );
            await waitFor(() => countErrorsFound() > errorsFound);
            // Fix elm-watch.json again.
            fs.writeFileSync(elmWatchJsonPath, elmWatchJsonString);
            return "KeepGoing" as const;
          case 2:
            assert2(div);
            fs.writeFileSync(elmWatchJsonPath2, "{}");
            await waitFor(() => countErrorsFound() > errorsFound);
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
                  "type": "application",
                  "elmJson": "../elm.json",
                  "inputs": [
                      "src/Main.elm"
                  ],
                  "output": "build/main.js"
              }
          }
      }
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
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
    const elmJsonString = fs
      .readFileSync(elmJsonTemplatePath, "utf8")
      .replace(/\r\n/g, "\n");
    fs.writeFileSync(elmJsonPath, elmJsonString);
    fs.writeFileSync(roguePath, "ROGUE");
    rm(elmJsonPathSub);

    const { terminal } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      cwd: "src",
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert(div);
            // Other elm.json files don’t matter, even if closer to an input.
            touch(roguePath);
            fs.writeFileSync(elmJsonPathSub, elmJsonString);
            // Let those be handled (and ignored) before the next change.
            await waitForWatcherToSettle();
            fs.writeFileSync(elmJsonPath, elmJsonString.slice(0, -10));
            return "KeepGoing";
          case 2:
            fs.writeFileSync(elmJsonPath, elmJsonString);
            return "KeepGoing";
          default:
            assert(div);
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
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("elm.json changes type, or goes missing", async () => {
    const fixture = "changes-to-elm-json";
    const dir = fixtureDir(fixture);
    const elmJsonPath = path.join(dir, "elm.json");
    const elmJsonTemplatePath = path.join(dir, "elm.template.json");
    const elmJsonString = fs
      .readFileSync(elmJsonTemplatePath, "utf8")
      .replace(/\r\n/g, "\n");
    const packageElmJsonString = JSON.stringify({
      type: "package",
      name: "author/project",
      summary: "summary",
      license: "MIT",
      version: "1.0.0",
      "exposed-modules": [],
      "elm-version": "0.19.0 <= v < 0.20.0",
      dependencies: { "elm/core": "1.0.0 <= v < 2.0.0" },
      "test-dependencies": {},
    });
    fs.writeFileSync(elmJsonPath, elmJsonString);

    const { terminal, onlyExpandedRenders } = await run({
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
            expandUi();
            fs.writeFileSync(elmJsonPath, packageElmJsonString);
            return "KeepGoing";
          case 2:
            fs.unlinkSync(elmJsonPath);
            return "KeepGoing";
          case 3:
            collapseUi();
            fs.writeFileSync(elmJsonPath, elmJsonString);
            return "KeepGoing";
          default:
            expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
            return "Stop";
        }
      },
    });

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- elm.json TYPE MISMATCH ------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      This target has ⧙"type": "application"⧘, but its ⧙elm.json⧘ has ⧙"type": "package"⧘:

      /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      Either change the "type" of the target, or use another ⧙elm.json⧘.

      Note: Application targets compile Elm files with \`main\` to JavaScript. To
      typecheck a package, use "type": "package" (without inputs and output) instead.
      To try out a package in the browser, make an application with its own elm.json
      (for example in examples/), with the package's src/ in "source-directories".

      …

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find the ⧙elm.json⧘ for this target:

      /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      Is "elmJson" misspelled? Or do you need to run ⧙elm init⧘ to create it?
    `);

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      ▲ ✅
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ✅ HtmlMain Successfully compiled · 13:10:05
      Compilation mode for HtmlMain
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger isn't supported by \`Html\` programs.
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ ⏳
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ⏳ HtmlMain Waiting for compilation · 13:10:05
      Compilation mode for HtmlMain
      ◯ (disabled) Debug
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      The Elm debugger isn't supported by \`Html\` programs.
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ 🚨
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      🚨 HtmlMain elm.json or inputs error · 13:10:05
      -- elm.json TYPE MISMATCH ------------------------------------------------------
      Target: HtmlMain

      This target has "type": "application", but its elm.json has "type": "package":

      /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      Either change the "type" of the target, or use another elm.json.

      Note: Application targets compile Elm files with \`main\` to JavaScript. To
      typecheck a package, use "type": "package" (without inputs and output) instead.
      To try out a package in the browser, make an application with its own elm.json
      (for example in examples/), with the package's src/ in "source-directories".
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ 🚨
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      🚨 HtmlMain elm.json or inputs error · 13:10:05
      -- elm.json NOT FOUND ----------------------------------------------------------
      Target: HtmlMain

      I could not find the elm.json for this target:

      /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      Is "elmJson" misspelled? Or do you need to run elm init to create it?
      Drag emoji or press shift+arrows to move
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
            await waitForWatcherToSettle();
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
});
