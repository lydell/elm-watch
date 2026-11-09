// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import { NO_COLOR } from "../src/Env.ts";
import { grep, rm, stringSnapshotSerializer } from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  expandUi,
  failInit,
  fixtureDir,
  run,
  withoutConnectionAttempts,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  afterEach(cleanupAfterEachTest);

  test("successful connect (collapsed)", async () => {
    const { terminal, renders, div } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      // Also test exposing the server on the network.
      env: { ELM_WATCH_HOST: "0.0.0.0" },
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      🌐 http://localhost:59123   ⧙network:⧘ http://192.168.0.1:59123

      ✅ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Html +1 more⧘
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌
      ================================================================================
      ▼ ⏳
      ================================================================================
      ▼ 🔌
      ================================================================================
      ▼ ⏳
      ================================================================================
      ▼ ✅
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
  });

  test("host option (elm-watch options)", async () => {
    const { terminal } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      useElmWatchFunction: { host: "0.0.0.0" },
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(grep(terminal, /🌐/)).toMatchInlineSnapshot(
      `🌐 http://localhost:59123   ⧙network:⧘ http://192.168.0.1:59123`,
    );
  });

  test("successful connect (expanded, not TTY, Worker)", async () => {
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Worker"],
      scripts: ["Worker.js"],
      expandUiImmediately: true,
      isTTY: false,
      init: () => {
        window.Elm?.["Worker"]?.init();
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      🌐 http://localhost:59123
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Worker: elm make (typecheck only)
      ✅ Worker⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Worker: elm make
      ✅ Worker⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Worker⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Worker⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌
      ================================================================================
      ▲ 🔌
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      🔌 Worker Connecting · 13:10:05
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ ⏳
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ⏳ Worker Waiting for compilation · 13:10:05
      Compilation mode for Worker
      ◯ (disabled) Debug
      ◯ (disabled) Standard
      ◯ (disabled) Optimize
      The Elm debugger isn't available at this point.
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ ⏳
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ⏳ Worker Waiting for compilation · 13:10:05
      Compilation mode for Worker
      ◯ (disabled) Debug
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      The Elm debugger isn't available at this point.
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▼ 🔌
      ================================================================================
      ▲ 🔌
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      🔌 Worker Connecting · 13:10:05
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ ⏳
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ⏳ Worker Waiting for compilation · 13:10:05
      Compilation mode for Worker
      ◯ (disabled) Debug
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      The Elm debugger isn't supported by \`Platform.worker\` programs.
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ ✅
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ✅ Worker Successfully compiled · 13:10:05
      Compilation mode for Worker
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger isn't supported by \`Platform.worker\` programs.
      Drag emoji or press shift+arrows to move
    `);
  });

  test("successful connect (non-fancy)", async () => {
    const { terminal, div } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      env: {
        [NO_COLOR]: "",
      },
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      Html: success                            1 ms Q | 1.23 s E /  55 ms W |   9 ms I
      http://localhost:59123

      13:10:05 Up to date   web socket connected: Html +1 more
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
  });

  test("successful connect (non-fancy, not TTY)", async () => {
    const { terminal, div } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      isTTY: false,
      env: {
        [NO_COLOR]: "",
      },
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      http://localhost:59123
      Dependencies: in progress
      Dependencies: success
      Html: elm make (typecheck only)
      Html: success     1 ms Q | 765 ms T /  50 ms W

      13:10:05 Compilation finished in 123 ms.
      Html: elm make
      Html: success     1 ms Q | 1.23 s E /  55 ms W |   9 ms I

      13:10:05 Web socket connected needing compilation of: Html
      13:10:05 Compilation finished in 123 ms.

      13:10:05 Web socket connected for: Html
      13:10:05 Everything up to date.
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
  });

  test("successful connect (target name with escapes)", async () => {
    const { div } = await run({
      fixture: "basic",
      args: ['"Esc\\apes"'],
      scripts: ["Escapes.js"],
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
  });

  test("connect with elm.json error", async () => {
    const fixture = "connect-with-elm-json-error";
    const dir = fixtureDir(fixture);
    fs.copyFileSync(
      path.join(dir, "elm.template.json"),
      path.join(dir, "elm.json"),
    );

    const { terminal } = await run({
      fixture,
      args: ["Main"],
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      🌐 http://localhost:59123

      ✅ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main +1 more⧘
    `);

    rm(path.join(dir, "elm.json"));

    const { renders } = await run({
      fixture,
      args: ["Main"],
      scripts: ["Main.js"],
      expandUiImmediately: true,
      keepBuild: true,
      keepElmStuffJson: true,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(withoutConnectionAttempts(renders)).toMatchInlineSnapshot(`
      ▼ 🔌
      ================================================================================
      ▲ ⏳
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ⏳ Main Waiting for compilation · 13:10:05
      Compilation mode for Main
      ◯ (disabled) Debug
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      The Elm debugger cannot be enabled until at least one Elm app has been initialized. (Check the browser console for errors if you expected an Elm app to be initialized by now.)
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ 🚨
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      🚨 Main elm.json or inputs error · 13:10:05
      -- elm.json NOT FOUND ----------------------------------------------------------
      Target: Main

      I could not find the elm.json for this target:

      /Users/you/project/tests/fixtures/hot/connect-with-elm-json-error/elm.json

      Is "elmJson" misspelled? Or do you need to run elm init to create it?
      Drag emoji or press shift+arrows to move
    `);
  });

  test("fail to read Elm’s output (no postprocess)", async () => {
    const { terminal, onlyExpandedRenders } = await run({
      fixture: "basic",
      args: ["Removed"],
      scripts: ["Removed.js"],
      init: failInit,
      onIdle: () => {
        expandUi();
        return "Stop";
      },
      bin: "exit-0-remove-output",
    });

    expect(terminal).toMatchInlineSnapshot(`
      🚨 ⧙Removed⧘: 1 error ◀
      🌐 http://localhost:59123

      ⧙-- TROUBLE READING OUTPUT ------------------------------------------------------⧘
      ⧙Target: Removed⧘

      I managed to compile your code. Then I tried to read the output:

      /Users/you/project/tests/fixtures/hot/basic/elm-stuff/elm-watch/2.js

      Doing so I encountered this error:

      ENOENT: no such file or directory, open '/Users/you/project/tests/fixtures/hot/basic/elm-stuff/elm-watch/2.js'

      ℹ️ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Removed⧘
      🚨 error 1/1
      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ ⧙error⧘   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙a⧘⧙]⧘ show all
    `);

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      ▲ 🚨
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Hide errors]
      [Close elm-watch]
      🚨 Removed Compilation error · 13:10:05
      Compilation mode for Removed
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger isn't available at this point.
      Drag emoji or press shift+arrows to move
    `);
  });

  test("fail to write output with hot injection (no postprocess)", async () => {
    const { terminal, onlyExpandedRenders } = await run({
      fixture: "basic",
      args: ["Readonly"],
      scripts: ["Readonly.js"],
      init: failInit,
      onIdle: () => {
        expandUi();
        return "Stop";
      },
      bin: "exit-0-write-readonly",
    });

    expect(terminal).toMatchInlineSnapshot(`
      🚨 ⧙Readonly⧘: 1 error ◀
      🌐 http://localhost:59123

      ⧙-- TROUBLE WRITING OUTPUT ------------------------------------------------------⧘
      ⧙Target: Readonly⧘

      I managed to compile your code and read the generated file:

      /Users/you/project/tests/fixtures/hot/basic/elm-stuff/elm-watch/3.js

      I injected code for hot reloading, and then tried to write that to the output path:

      /Users/you/project/tests/fixtures/hot/basic/build/Readonly.js

      But I encountered this error:

      EACCES: permission denied, open '/Users/you/project/tests/fixtures/hot/basic/build/Readonly.js'

      ℹ️ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Readonly⧘
      🚨 error 1/1
      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ ⧙error⧘   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙a⧘⧙]⧘ show all
    `);

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      ▲ 🚨
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Hide errors]
      [Close elm-watch]
      🚨 Readonly Compilation error · 13:10:05
      Compilation mode for Readonly
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger isn't available at this point.
      Drag emoji or press shift+arrows to move
    `);
  });
});
