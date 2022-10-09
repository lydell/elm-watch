/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";
import * as Decode from "tiny-decoders";

import { WebSocketToServerMessage } from "../client/WebSocketMessages";
import {
  __ELM_WATCH_ELM_TIMEOUT_MS,
  __ELM_WATCH_EXIT_ON_WORKER_LIMIT,
  __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS,
  __ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS,
  ELM_WATCH_OPEN_EDITOR,
  Env,
  NO_COLOR,
} from "../src/Env";
import { LatestEvent, printTimeline } from "../src/Hot";
import { IS_WINDOWS } from "../src/IsWindows";
import { LoggerConfig } from "../src/Logger";
import {
  clean,
  CtrlCReadStream,
  httpGet,
  rimraf,
  rm,
  rmSymlink,
  stringSnapshotSerializer,
  TEST_ENV,
  testExceptWindows,
  touch,
  wait,
} from "./Helpers";
import {
  assertDebugger,
  cleanupAfterEachTest,
  clickFirstErrorLocation,
  collapseUi,
  expandUi,
  failInit,
  FIXTURES_DIR,
  getOverlay,
  moveUi,
  run,
  showErrors,
  switchCompilationMode,
} from "./HotHelpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  afterEach(cleanupAfterEachTest);

  test("successful connect (collapsed)", async () => {
    const { terminal, renders, div } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Html
      ℹ️ 13:10:05 Web socket connected for: Html⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
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
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
  });

  test("successful connect (expanded, not TTY, Worker)", async () => {
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Worker"],
      scripts: ["Worker.js"],
      expandUiImmediately: true,
      isTTY: false,
      init: () => {
        window.Elm?.Worker?.init();
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Worker: elm make (typecheck only)
      ✅ Worker⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Worker: elm make
      ✅ Worker⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Worker⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Worker
      ℹ️ 13:10:05 Web socket connected for: Worker⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't available at this point.
      ◯ (disabled) Standard
      ◯ (disabled) Optimize
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't available at this point.
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 Worker
      ================================================================================
      ▼ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Platform.worker\` programs.
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Platform.worker\` programs.
      ◉ Standard
      ◯ Optimize
      ↑↗
      ·→
      ▲ ✅ 13:10:05 Worker
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
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      Html: success                            1 ms Q | 1.23 s E /  55 ms W |   9 ms I

      web socket connections: 1 (ws://0.0.0.0:59123)

      13:10:05 Web socket disconnected for: Html
      13:10:05 Web socket connected for: Html
      13:10:05 Everything up to date.
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
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      Dependencies: in progress
      Dependencies: success
      Html: elm make (typecheck only)
      Html: success     1 ms Q | 765 ms T /  50 ms W

      web socket connections: 0 (ws://0.0.0.0:59123)

      13:10:05 Compilation finished in 123 ms.
      Html: elm make
      Html: success     1 ms Q | 1.23 s E /  55 ms W |   9 ms I

      web socket connections: 1 (ws://0.0.0.0:59123)

      13:10:05 Web socket connected needing compilation of: Html
      13:10:05 Compilation finished in 123 ms.

      web socket connections: 1 (ws://0.0.0.0:59123)

      13:10:05 Web socket disconnected for: Html
      13:10:05 Web socket connected for: Html
      13:10:05 Everything up to date.
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
  });

  test("successful connect (package)", async () => {
    const { terminal, renders, div } = await run({
      fixture: "package",
      args: ["Main"],
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>main</div>`);
  });

  test("connect with elm.json error", async () => {
    const fixture = "connect-with-elm-json-error";
    const dir = path.join(FIXTURES_DIR, fixture);
    fs.copyFileSync(
      path.join(dir, "elm.template.json"),
      path.join(dir, "elm.json")
    );

    const { terminal } = await run({
      fixture,
      args: ["Main"],
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
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
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      It looks like no Elm apps were initialized by elm-watch. Check the console in the browser developer tools to see potential errors!
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status elm.json or inputs error
      -- elm.json NOT FOUND ----------------------------------------------------------
      Target: Main

      I could not find an elm.json for these inputs:

      src/Main.elm

      Has it gone missing? Maybe run elm init to create one?
      ▲ 🚨 13:10:05 Main
    `);
  });

  test("fail to read Elm’s output (no postprocess)", async () => {
    const { terminal, renders } = await run({
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
      🚨 Removed

      ⧙-- TROUBLE READING OUTPUT ------------------------------------------------------⧘
      ⧙Target: Removed⧘

      I managed to compile your code. Then I tried to read the output:

      /Users/you/project/tests/fixtures/hot/basic/elm-stuff/elm-watch/2.js

      Doing so I encountered this error:

      ENOENT: no such file or directory, open '/Users/you/project/tests/fixtures/hot/basic/elm-stuff/elm-watch/2.js'

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Removed⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Removed
      ================================================================================
      ▼ ⏳ 13:10:05 Removed
      ================================================================================
      ▼ ⏳ 13:10:05 Removed
      ================================================================================
      ▼ 🚨 13:10:05 Removed
      ================================================================================
      target Removed
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Compilation error
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't available at this point.
      ◉ Standard
      ◯ Optimize
      [Show errors]
      ↑↗
      ·→
      ▲ 🚨 13:10:05 Removed
    `);
  });

  test("fail to write output with hot injection (no postprocess)", async () => {
    const { terminal, renders } = await run({
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
      🚨 Readonly

      ⧙-- TROUBLE WRITING OUTPUT ------------------------------------------------------⧘
      ⧙Target: Readonly⧘

      I managed to compile your code and read the generated file:

      /Users/you/project/tests/fixtures/hot/basic/elm-stuff/elm-watch/3.js

      I injected code for hot reloading, and then tried to write that to the output path:

      /Users/you/project/tests/fixtures/hot/basic/build/Readonly.js

      But I encountered this error:

      EACCES: permission denied, open '/Users/you/project/tests/fixtures/hot/basic/build/Readonly.js'

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Readonly⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Readonly
      ================================================================================
      ▼ ⏳ 13:10:05 Readonly
      ================================================================================
      ▼ ⏳ 13:10:05 Readonly
      ================================================================================
      ▼ 🚨 13:10:05 Readonly
      ================================================================================
      target Readonly
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Compilation error
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't available at this point.
      ◉ Standard
      ◯ Optimize
      [Show errors]
      ↑↗
      ·→
      ▲ 🚨 13:10:05 Readonly
    `);
  });

  describe("Parse web socket connect request url errors", () => {
    const originalWebSocket = WebSocket;
    let _lastWebSocket: WebSocket | undefined = undefined;

    afterEach(() => {
      window.WebSocket = originalWebSocket;
      _lastWebSocket = undefined;
    });

    function modifyUrl(f: (url: URL) => void): void {
      class TestWebSocket extends WebSocket {
        constructor(url: URL | string) {
          if (typeof url === "string") {
            throw new Error(
              "TestWebSocket expects the url to be a URL object, not a string!"
            );
          }

          f(url);

          super(url);

          // eslint-disable-next-line @typescript-eslint/no-this-alias
          _lastWebSocket = this;
        }
      }

      window.WebSocket = TestWebSocket;
    }

    function disconnect(): void {
      if (_lastWebSocket === undefined) {
        throw new Error("No WebSocket to disconnect!");
      }
      _lastWebSocket.close();
    }

    function send(message: WebSocketToServerMessage): void {
      if (_lastWebSocket === undefined) {
        throw new Error("No WebSocket to send message to!");
      }
      _lastWebSocket.send(JSON.stringify(message));
    }

    test("bad url", async () => {
      modifyUrl((url) => {
        url.pathname = "nope";
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["BadUrl"],
        scripts: ["BadUrl.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ BadUrl⧙                                           1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(
        renders.replace(
          /elmCompiledTimestamp=\d+/,
          "elmCompiledTimestamp=1644064438938"
        )
      ).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 BadUrl
        ================================================================================
        ▼ ⏳ 13:10:05 BadUrl
        ================================================================================
        target BadUrl
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I expected the web socket connection URL to start with:

        /?

        But it looks like this:

        /nope?elmWatchVersion=%25VERSION%25&targetName=BadUrl&elmCompiledTimestamp=1644064438938

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here.
        ▲ ❌ 13:10:05 BadUrl
      `);
    });

    test("params decode error and disconnect", async () => {
      modifyUrl((url) => {
        url.searchParams.set("elmCompiledTimestamp", "2021-12-11");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["ParamsDecodeError"],
        scripts: ["ParamsDecodeError.js"],
        init: failInit,
        onIdle: ({ idle }) => {
          switch (idle) {
            case 1:
              disconnect();
              return "KeepGoing";
            default:
              return "Stop";
          }
        },
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ ParamsDecodeError⧙                                1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 ParamsDecodeError
        ================================================================================
        ▼ ⏳ 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I ran into trouble parsing the web socket connection URL parameters:

        At root["elmCompiledTimestamp"]:
        Expected a number
        Got: "2021-12-11"

        The URL looks like this:

        /?elmWatchVersion=%25VERSION%25&targetName=ParamsDecodeError&elmCompiledTimestamp=2021-12-11

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here. Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Sleeping
        attempt 1
        sleep 1.01 seconds
        [Reconnect web socket now]
        ▲ 🔌 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ↑↗
        ·→
        ▲ ⏳ 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I ran into trouble parsing the web socket connection URL parameters:

        At root["elmCompiledTimestamp"]:
        Expected a number
        Got: "2021-12-11"

        The URL looks like this:

        /?elmWatchVersion=%25VERSION%25&targetName=ParamsDecodeError&elmCompiledTimestamp=2021-12-11

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here. Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 13:10:05 ParamsDecodeError
      `);
    });

    test("wrong version and send message anyway", async () => {
      modifyUrl((url) => {
        url.searchParams.set("elmWatchVersion", "0.0.0");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["WrongVersion"],
        scripts: ["WrongVersion.js"],
        init: failInit,
        onIdle: async () => {
          send({
            tag: "ChangedCompilationMode",
            compilationMode: "optimize",
          });
          send({
            tag: "ChangedBrowserUiPosition",
            browserUiPosition: "TopLeft",
          });
          send({
            tag: "ChangedOpenErrorOverlay",
            openErrorOverlay: true,
          });
          // Wait for the above messages to be processed before stopping (needed
          // for code coverage).
          await wait(100);
          return "Stop" as const;
        },
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ WrongVersion⧙                                     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 WrongVersion
        ================================================================================
        ▼ ⏳ 13:10:05 WrongVersion
        ================================================================================
        target WrongVersion
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it was compiled with:

        elm-watch 0.0.0

        But the server is:

        elm-watch %VERSION%

        Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 13:10:05 WrongVersion
      `);
    });

    test("target not found", async () => {
      modifyUrl((url) => {
        url.searchParams.set("targetName", "nope");
      });

      const { terminal, renders } = await run({
        fixture: "target-not-found",
        args: ["Enabled"],
        scripts: ["Enabled1.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 EnabledNotFound
        ✅ Enabled1⧙                                         1 ms Q | 765 ms T ¦  50 ms W⧘
        ✅ Enabled2⧙                                         1 ms Q | 765 ms T ¦  50 ms W⧘

        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙Target: EnabledNotFound⧘

        You asked me to compile these inputs:

        src/EnabledNotFound.elm ⧙(/Users/you/project/tests/fixtures/hot/target-not-found/src/EnabledNotFound.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        🚨 ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Enabled1
        ================================================================================
        ▼ ⏳ 13:10:05 Enabled1
        ================================================================================
        target Enabled1
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        nope

        But I can't find that target in elm-watch.json!

        These targets are available in elm-watch.json:

        EnabledNotFound
        Enabled1
        Enabled2

        These targets are also available in elm-watch.json, but are not enabled (because of the CLI arguments passed):

        Disabled1
        Disabled2

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        If so, try reloading the page.
        ▲ ❌ 13:10:05 Enabled1
      `);
    });

    test("target not found (no disabled targets)", async () => {
      modifyUrl((url) => {
        url.searchParams.set("targetName", "nope");
      });

      const { terminal, renders } = await run({
        fixture: "single",
        args: ["Main"],
        scripts: ["Main.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ Main⧙                                             1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        nope

        But I can't find that target in elm-watch.json!

        These targets are available in elm-watch.json:

        Main

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        If so, try reloading the page.
        ▲ ❌ 13:10:05 Main
      `);
    });

    test("change target name", async () => {
      const fixture = "change-target-name";
      const dir = path.join(FIXTURES_DIR, fixture);
      const elmWatchJsonPath = path.join(dir, "elm-watch.json");
      const elmWatchJsonTemplatePath = path.join(
        dir,
        "elm-watch.template.json"
      );
      const elmWatchJsonString = fs.readFileSync(
        elmWatchJsonTemplatePath,
        "utf8"
      );
      fs.writeFileSync(elmWatchJsonPath, elmWatchJsonString);

      const { terminal, renders } = await run({
        fixture,
        scripts: ["Main.js"],
        isTTY: false,
        init: (node) => {
          try {
            window.Elm?.Main?.init({ node });
          } catch {
            // Ignore elm-watch proxy “error” on reload.
          }
        },
        onIdle: ({ idle }) => {
          switch (idle) {
            case 1:
              fs.writeFileSync(
                elmWatchJsonPath,
                elmWatchJsonString.replace("Main", "Renamed")
              );
              return "KeepGoing";
            case 2:
              expandUi();
              window.__ELM_WATCH.RELOAD_PAGE(undefined);
              return "KeepGoing";
            default:
              return "Stop";
          }
        },
      });

      expect(terminal).toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ Main: elm make (typecheck only)
        ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ Main: elm make
        ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
        ℹ️ 13:10:05 Web socket connected for: Main⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ Renamed: elm make (typecheck only)
        ✅ Renamed⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/change-target-name/elm-watch.json⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
        ⏳ Renamed: elm make
        ✅ Renamed⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: (no matching target)
        ℹ️ 13:10:05 Web socket connected needing compilation of: Renamed⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: Renamed
        ℹ️ 13:10:05 Web socket connected for: Renamed⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ ✅ 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        Main

        But I can't find that target in elm-watch.json!

        These targets are available in elm-watch.json:

        Renamed

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        If so, try reloading the page.
        ▲ ❌ 13:10:05 Main
        ================================================================================
        ▼ 🔌 13:10:05 Renamed
        ================================================================================
        ▼ ⏳ 13:10:05 Renamed
        ================================================================================
        ▼ ⏳ 13:10:05 Renamed
        ================================================================================
        ▼ 🔌 13:10:05 Renamed
        ================================================================================
        ▼ 🔌 13:10:05 Renamed
        ================================================================================
        ▼ ⏳ 13:10:05 Renamed
        ================================================================================
        ▼ ✅ 13:10:05 Renamed
      `);
    });

    test("target disabled", async () => {
      modifyUrl((url) => {
        url.searchParams.set("targetName", "Html");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["TargetDisabled"],
        scripts: ["TargetDisabled.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ TargetDisabled⧙                                   1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 TargetDisabled
        ================================================================================
        ▼ ⏳ 13:10:05 TargetDisabled
        ================================================================================
        target TargetDisabled
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        Html

        That target does exist in elm-watch.json, but isn't enabled.

        These targets are enabled via CLI arguments:

        TargetDisabled

        These targets exist in elm-watch.json but aren't enabled:

        Html
        Worker
        Removed
        Readonly
        InjectError
        BadUrl
        ParamsDecodeError
        WrongVersion
        SendBadJson
        Reconnect

        If you want to have this target compiled, restart elm-watch either with more CLI arguments or no CLI arguments at all!
        ▲ ❌ 13:10:05 TargetDisabled
      `);
    });

    test("send bad json", async () => {
      let first = true;

      class TestWebSocket extends WebSocket {
        override send(message: string): void {
          if (first) {
            super.send(JSON.stringify({ tag: "Nope" }));
            first = false;
          } else {
            super.send(message);
          }
        }
      }

      window.WebSocket = TestWebSocket;

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["SendBadJson"],
        scripts: ["SendBadJson.js"],
        init: (node) => {
          window.Elm?.HtmlMain?.init({ node });
        },
        onIdle: ({ idle }) => {
          switch (idle) {
            case 1:
              switchCompilationMode("optimize");
              return "KeepGoing";
            default:
              return "Stop";
          }
        },
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ SendBadJson⧙                           1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: SendBadJson
        ℹ️ 13:10:05 Web socket connected for: SendBadJson⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 SendBadJson
        ================================================================================
        ▼ ⏳ 13:10:05 SendBadJson
        ================================================================================
        ▼ ⏳ 13:10:05 SendBadJson
        ================================================================================
        ▼ 🔌 13:10:05 SendBadJson
        ================================================================================
        ▼ 🔌 13:10:05 SendBadJson
        ================================================================================
        ▼ ⏳ 13:10:05 SendBadJson
        ================================================================================
        ▼ ✅ 13:10:05 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ↑↗
        ·→
        ▲ ✅ 13:10:05 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize 🚀
        ↑↗
        ·→
        ▲ 🚀 ⏳ 13:10:05 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["tag"]:
        Expected one of these tags: "ChangedCompilationMode", "ChangedBrowserUiPosition", "ChangedOpenErrorOverlay", "FocusedTab", "PressedOpenEditor"
        Got: "Nope"

        The web socket code I generate is supposed to always send correct messages, so something is up here.
        ▲ 🚀 ❌ 13:10:05 SendBadJson
      `);
    });

    test("reconnect a few times", async () => {
      let i = 0;
      modifyUrl((url) => {
        i++;
        if (i <= 2) {
          url.port = "65252"; // Hopefully unused port.
        }
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["Reconnect"],
        scripts: ["Reconnect.js"],
        expandUiImmediately: true,
        init: (node) => {
          window.Elm?.HtmlMain?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Reconnect⧙                             1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: Reconnect
        ℹ️ 13:10:05 Web socket connected for: Reconnect⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Sleeping
        attempt 2
        sleep 1.04 seconds
        [Reconnect web socket now]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 2
        sleep 1.04 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Sleeping
        attempt 3
        sleep 1.09 seconds
        [Reconnect web socket now]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 3
        sleep 1.09 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ↑↗
        ·→
        ▲ ⏳ 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◉ (disabled) Standard
        ◯ (disabled) Optimize
        ↑↗
        ·→
        ▲ ⏳ 13:10:05 Reconnect
        ================================================================================
        ▼ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ (disabled) Standard
        ◯ (disabled) Optimize
        ↑↗
        ·→
        ▲ ⏳ 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ↑↗
        ·→
        ▲ ✅ 13:10:05 Reconnect
      `);
    }, 9000); // This test sometimes reaches the default 5000 limit.

    test("outdated timestamp", async () => {
      modifyUrl((url) => {
        url.searchParams.set("elmCompiledTimestamp", "0");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["Html"],
        scripts: ["Html.js"],
        init: (node) => {
          window.Elm?.HtmlMain?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: Html
        ℹ️ 13:10:05 Web socket connected needing compilation of: Html⧘
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
        ▼ ⏳ 13:10:05 Html
        ================================================================================
        ▼ ⏳ 13:10:05 Html
        ================================================================================
        ▼ ✅ 13:10:05 Html
      `);
    });
  });

  test("changes to elm-watch.json", async () => {
    const fixture = "changes-to-elm-watch-json";
    const dir = path.join(FIXTURES_DIR, fixture);
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

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      cwd: "src",
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            touch(roguePath);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.slice(0, -10)
            );
            await wait(100);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.replace(/"postprocess":.*/, "")
            );
            return "KeepGoing" as const;
          case 2:
            assert2(div);
            fs.writeFileSync(elmWatchJsonPath2, "{}");
            await wait(100);
            fs.unlinkSync(elmWatchJsonPath2);
            return "KeepGoing";
          case 3:
            assert2(div);
            fs.unlinkSync(elmWatchJsonPath);
            return "KeepGoing";
          default:
            throw new Error(
              "Expected elm-watch to exit due to no elm-watch.json!"
            );
        }
      },
    });

    await window.__ELM_WATCH.KILL_MATCHING(/^/);

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⧙-- TROUBLE READING elm-watch.json ----------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble reading it as JSON:⧘

      Unexpected end of JSON input

      🚨 ⧙1⧘ error found
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/elm-watch.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/src/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble with the JSON inside:⧘

      At root["targets"]:
      Expected an object
      Got: undefined

      🚨 ⧙1⧘ error found
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/src/elm-watch.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
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

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>THE TEXT!</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("changes to elm.json", async () => {
    const fixture = "changes-to-elm-json";
    const dir = path.join(FIXTURES_DIR, fixture);
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

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      cwd: "src",
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
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

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Dependencies
      ⛔️ Dependencies
      ⏳ HtmlMain: elm make
      🚨 HtmlMain

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

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      🚨 HtmlMain

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

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      🚨 HtmlMain

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

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/OtherMain.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/HtmlMain.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/OtherMain.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm
      src/Sub/OtherMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      target HtmlMain
      elm-watch %VERSION%
      web socket ws://localhost:59123
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
      web socket ws://localhost:59123
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
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("changes to elm.json – typecheck only", async () => {
    const fixture = "changes-to-elm-json";
    const dir = path.join(FIXTURES_DIR, fixture);
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
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            fs.writeFileSync(elmJsonPath, elmJsonString.slice(0, -10));
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    // Both Elm and the Walker will fail on the invalid elm.json, but only the Elm error should be shown.
    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ⏳ Other: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Other⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Dependencies
      ⛔️ Dependencies
      ⏳ HtmlMain: elm make
      ⚪️ Other: queued
      🚨 HtmlMain
      ⏳ Other: elm make (typecheck only)
      🚨 Other

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

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("delete elm-stuff", async () => {
    const fixture = "delete-elm-stuff";
    const dir = path.join(FIXTURES_DIR, fixture);
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
      init: (node) => {
        window.Elm?.Main?.init({ node });
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

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main: elm make
      🚨 Main

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

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/delete-elm-stuff/src/Main.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/delete-elm-stuff/elm-stuff⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("changes to elm-watch-node JS file", async () => {
    const fixture = "changes-to-postprocess";
    const postprocessPath = path.join(FIXTURES_DIR, fixture, "postprocess.js");
    const postprocessTemplatePath = path.join(
      FIXTURES_DIR,
      fixture,
      "postprocess.template.js"
    );
    const roguePath = path.join(FIXTURES_DIR, fixture, "src", "postprocess.js");
    const postprocessString = fs
      .readFileSync(postprocessTemplatePath, "utf8")
      .replace(/\r\n/g, "\n");
    fs.writeFileSync(postprocessPath, postprocessString);
    fs.writeFileSync(roguePath, "ROGUE");

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
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
              postprocessString.replace("toUpperCase", "toLowerCase")
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
            assert1(div);
            return "Stop";
        }
      },
    });

    expect(terminal.replace(/^ +at.+\n/gm, "")).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      🚨 HtmlMain

      ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js

      I tried to import your postprocess file:

      const imported = await import("file:///Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js")

      But that resulted in this error:

      Error: Transform failed with 1 error:
      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js:2:51: ERROR: Expected ")" but found end of file

      🚨 ⧙1⧘ error found

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      🚨 HtmlMain

      ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js

      I tried to import your postprocess file:

      const imported = await import("file:///Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js")

      But that resulted in this error:

      Cannot find module '/Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js' imported from /Users/you/project/src/PostprocessWorker.ts

      🚨 ⧙1⧘ error found

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>THE TEXT!</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>the text!</div>`);
    }
  });

  // - Create and delete directories named `Something.elm`.
  // - Create and delete a file named like a package (`Html.elm`).
  test("changes to .elm files", async () => {
    const fixture = "changes-to-elm-files";
    const htmlPath = path.join(FIXTURES_DIR, fixture, "src", "Html.elm");
    rm(htmlPath);

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      cwd: "src",
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
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

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ HtmlMain: elm make
      🚨 HtmlMain

      ⧙-- TROUBLE READING ELM FILES ---------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      When figuring out all Elm files that your inputs depend on I read a lot of Elm files.
      Doing so I encountered this error:

      EISDIR: illegal operation on a directory, read

      (I still managed to compile your code, but the watcher will not work properly
      and "postprocess" was not run.)

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      🚨 HtmlMain

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

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("non interesting .elm files changed, with disabled targets", async () => {
    const fixture = "non-interesting-elm-files-changed-disabled-targets";
    const unusedFolder = path.join(FIXTURES_DIR, fixture, "src", "Unused");

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain1"],
      scripts: ["HtmlMain1.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain1?.init({ node });
      },
      onIdle: async ({ div }) => {
        assert(div);
        for (const filePath of fs.readdirSync(unusedFolder)) {
          await wait(1);
          touch(path.join(unusedFolder, filePath));
        }
        await wait(100);
        return "Stop" as const;
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain1: elm make (typecheck only)
      ✅ HtmlMain1⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain1: elm make
      ✅ HtmlMain1⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain1⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain1
      ℹ️ 13:10:05 Web socket connected for: HtmlMain1⧘
      ✅ ⧙13:10:05⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File1.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File2.elm⧘
      ✅ ⧙13:10:05⧘ FYI: The above Elm files are not imported by any of the enabled targets. Nothing to do!
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 HtmlMain1
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain1
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain1
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain1
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain1
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain1
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain1
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("non interesting .elm files changed, with all targets enabled", async () => {
    const fixture = "non-interesting-elm-files-changed-all-targets";
    const unusedFile1 = path.join(FIXTURES_DIR, fixture, "src", "Unused.elm");

    const { terminal, renders } = await run({
      fixture,
      args: [],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: async ({ div }) => {
        assert(div);
        touch(unusedFile1);
        await wait(100);
        return "Stop" as const;
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-all-targets/src/Unused.elm⧘
      ✅ ⧙13:10:05⧘ FYI: The above Elm file is not imported by any target. Nothing to do!
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("two changes at the same time", async () => {
    // Note: This uses its own fixture because it has a tendency to write files
    // to `build/` while the next test is removing `build/` – on Windows only.
    const fixture = "two-changes-at-the-same-time";
    const src = path.join(FIXTURES_DIR, fixture, "src");
    const inputFile1 = path.join(src, "HtmlMain.elm");
    const inputFile2 = path.join(src, "Worker.elm");

    const { terminal, renders } = await run({
      fixture,
      args: ["Html", "Worker"],
      scripts: ["Html.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            touch(inputFile1);
            touch(inputFile2);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Html: elm make (typecheck only)
      ⏳ Worker: elm make (typecheck only)
      ✅ Html⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Worker⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Html: elm make
      ✅ Html⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Html⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Html
      ℹ️ 13:10:05 Web socket connected for: Html⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Html: elm make
      ⚪️ Worker: queued
      ✅ Html⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Worker: elm make (typecheck only)
      ✅ Worker⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/two-changes-at-the-same-time/src/HtmlMain.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/two-changes-at-the-same-time/src/Worker.elm⧘
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
          window.Elm?.Main?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ Target1: elm make (typecheck only)
        ⏳ Target2: elm make (typecheck only)
        ⏳ Target3: elm make (typecheck only)
        ✅ Target1⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
        ✅ Target2⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
        ✅ Target3⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ Target1: elm make
        ✅ Target1⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Target1⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: Target1
        ℹ️ 13:10:05 Web socket connected for: Target1⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
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
    }
  );

  test("elm compilation errors from the start, with terminal resize", async () => {
    const fixture = "compile-error";

    const main = path.join(FIXTURES_DIR, fixture, "src", "Main.elm");

    const { terminal, renders } = await run({
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

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      🚨 Main

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

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      🚨 ⧙13:10:05⧘ Everything up to date.
      ⏳ Main: elm make
      🚨 Main

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

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/compile-error/src/Main.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🚨 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🚨 13:10:05 Main
    `);
  });

  test("kill Elm", async () => {
    const fixture = "kill-elm";
    const dir = path.join(FIXTURES_DIR, fixture);
    const input = path.join(dir, "src", "Main.elm");
    const lock = path.join(dir, "lock");

    // Hang on installing dependencies.
    // `bad-bin/compile-forever/elm` then updates `lock` to hang on typecheck
    // only, and then succeed.
    fs.writeFileSync(lock, "LockAll");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["main.js"],
      isTTY: false,
      bin: "compile-forever",
      env: {
        ...TEST_ENV,
        [__ELM_WATCH_ELM_TIMEOUT_MS]: "0",
      },
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            // Hang on compile.
            // `bad-bin/compile-forever/elm` then updates `lock` to succeed.
            fs.writeFileSync(lock, "LockExceptInstall");
            touch(input);
            return "KeepGoing";

          default:
            return "Stop";
        }
      },
    });

    // The middle “Dependencies” line is when it’s interrupted.
    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ⏳ Dependencies
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ⏳ Main: interrupted
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-elm/elm.json
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-elm/src/Main.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main: elm make
      ⏳ Main: interrupted
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-elm/src/Main.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-elm/src/Main.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("kill Elm while installing dependencies in TTY mode", async () => {
    const fixture = "kill-elm";
    const dir = path.join(FIXTURES_DIR, fixture);
    const lock = path.join(dir, "lock");

    // Hang on installing dependencies.
    fs.writeFileSync(lock, "LockAll");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["main.js"],
      isTTY: true,
      bin: "compile-forever",
      env: {
        ...TEST_ENV,
        [__ELM_WATCH_ELM_TIMEOUT_MS]: "0",
      },
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);
  });

  test("kill postprocess", async () => {
    const fixture = "kill-postprocess";
    const input = path.join(FIXTURES_DIR, fixture, "src", "Main.elm");
    const tmp = path.join(FIXTURES_DIR, fixture, "postprocess.tmp");
    fs.writeFileSync(tmp, "1");
    const { terminal, renders } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            touch(input);
            await wait(1000); // Wait for Elm to finish and postprocess to start.
            touch(input); // Touch while postprocessing.
            return "KeepGoing";
          default:
            assert2(div);
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ⏳ Main: interrupted
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess/src/Main.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess/src/Main.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content before</div>`
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content after</div>`
      );
    }
  });

  test("kill postprocess (elm-watch-node)", async () => {
    const fixture = "kill-postprocess-elm-watch-node";
    const input = path.join(FIXTURES_DIR, fixture, "src", "Main.elm");
    const tmp = path.join(FIXTURES_DIR, fixture, "postprocess.tmp");
    fs.writeFileSync(tmp, "1");
    const { terminal, renders } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            touch(input);
            await wait(1000); // Wait for Elm to finish and postprocess to start.
            touch(input); // Touch while postprocessing.
            return "KeepGoing";
          default:
            assert2(div);
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ⏳ Main: interrupted
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess-elm-watch-node/src/Main.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess-elm-watch-node/src/Main.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content before</div>`
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content after</div>`
      );
    }
  });

  test("limit postprocess workers", async () => {
    const fixture = "limit-postprocess-workers";
    const lock = path.join(FIXTURES_DIR, fixture, "lock");
    rm(lock);

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["One.js", "Two.js"],
      isTTY: false,
      env: {
        [__ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS]: "150",
        [__ELM_WATCH_EXIT_ON_WORKER_LIMIT]: "",
      },
      init: (node) => {
        const node1 = document.createElement("div");
        const node2 = document.createElement("div");
        node.append(node1, node2);
        window.Elm?.One?.init({ node: node1 });
        window.Elm?.Two?.init({ node: node2 });
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1:
            return "KeepGoing"; // First script has loaded.
          default:
            await window.__ELM_WATCH.KILL_MATCHING(/^/);
            return "KeepGoing" as const;
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ One: elm make (typecheck only)
      ⏳ Two: elm make (typecheck only)
      ✅ One⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Two⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Two: elm make
      ⚪️ One: queued
      🟢 Two: elm make done
      ⏳ Two: postprocess
      ⏳ One: elm make
      🟢 One: elm make done
      ⏳ One: postprocess
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: One
      ℹ️ 13:10:05 Web socket connected needing compilation of: Two⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Two
      ℹ️ 13:10:05 Web socket disconnected for: One
      ℹ️ 13:10:05 Web socket connected for: One
      ℹ️ 13:10:05 Web socket connected for: Two⧘
      ✅ ⧙13:10:05⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Two
      ℹ️ 13:10:05 Web socket disconnected for: One⧘
      ✅ ⧙13:10:05⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Terminated 1 superfluous worker⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);
  });

  test("persisted compilation mode", async () => {
    const { terminal, renders } = await run({
      fixture: "persisted-compilation-mode",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: ({ body }) => {
        assertDebugger(body);
        return "Stop";
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:9988)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🐛 ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🐛 🔌 13:10:05 Main
      ================================================================================
      ▼ 🐛 🔌 13:10:05 Main
      ================================================================================
      ▼ 🐛 ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🐛 ✅ 13:10:05 Main
    `);
  });

  test("persisted browser UI position", async () => {
    const { terminal, renders } = await run({
      fixture: "persisted-browser-ui-position",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      expandUiImmediately: true,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:9988)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't available at this point.
      ◯ (disabled) Standard
      ◯ (disabled) Optimize
      ←·
      ↙↓
      ▲ ⏳ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't available at this point.
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ←·
      ↙↓
      ▲ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ←·
      ↙↓
      ▲ ⏳ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◯ Debug
      ◉ Standard
      ◯ Optimize
      ←·
      ↙↓
      ▲ ✅ 13:10:05 Main
    `);
  });

  test("persisted open error overlay", async () => {
    const { terminal } = await run({
      fixture: "persisted-open-error-overlay",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Dependencies
      🚨 Main

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31

      I am struggling with this boolean operation:

      10|     , view = \\_ -> if True && 5 then Html.text "yes" else Html.text "no"
                                        ⧙^⧘
      Both sides of (&&) must be ⧙Bool⧘ values, but the right side is:

          ⧙number⧘

      ⧙Hint⧘: Only ⧙Int⧘ and ⧙Float⧘ values work as numbers.

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:9988)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      🚨 ⧙13:10:05⧘ Everything up to date.
    `);

    expect(getOverlay()).toMatchInlineSnapshot(`
      <overlay visible style="background-color: rgb(32, 30, 30);">
      <details open="" id="0" data-target-names="Main" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
      <summary><span style="background-color: rgb(32, 30, 30);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31</button></p></summary>
      <pre>I am struggling with this boolean operation:

      10|     , view = \\_ -&gt; if True &amp;&amp; 5 then Html.text "yes" else Html.text "no"
                                        <span style="color: rgb(241, 76, 76)">^</span>
      Both sides of (&amp;&amp;) must be <span style="color: rgb(229, 229, 16)">Bool</span> values, but the right side is:

          <span style="color: rgb(229, 229, 16)">number</span>

      <u>Hint</u>: Only <span style="color: rgb(35, 209, 139)">Int</span> and <span style="color: rgb(35, 209, 139)">Float</span> values work as numbers.</pre></details>
      </overlay>
    `);
  });

  test("persisted open error overlay, no color", async () => {
    const { terminal } = await run({
      fixture: "persisted-open-error-overlay",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      env: {
        [NO_COLOR]: "",
      },
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      Dependencies: success
      Main: error

      -- TYPE MISMATCH ---------------------------------------------------------------
      /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31

      I am struggling with this boolean operation:

      10|     , view = \\_ -> if True && 5 then Html.text "yes" else Html.text "no"
                                        ^
      Both sides of (&&) must be Bool values, but the right side is:

          number

      Hint: Only Int and Float values work as numbers.

      1 error found

      web socket connections: 1 (ws://0.0.0.0:9988)

      13:10:05 Web socket connected needing compilation of: Main
      13:10:05 Everything up to date.
    `);

    expect(getOverlay()).toMatchInlineSnapshot(`
      <overlay visible style="background-color: rgb(32, 30, 30);">
      <details open="" id="0" data-target-names="Main" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
      <summary><span style="background-color: rgb(32, 30, 30);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31</button></p></summary>
      <pre>I am struggling with this boolean operation:

      10|     , view = \\_ -&gt; if True &amp;&amp; 5 then Html.text "yes" else Html.text "no"
                                        ^
      Both sides of (&amp;&amp;) must be Bool values, but the right side is:

          number

      Hint: Only Int and Float values work as numbers.</pre></details>
      </overlay>
    `);
  });

  test("error overlay bold and dim", async () => {
    const { terminal } = await run({
      fixture: "error-overlay-bold-and-dim",
      args: [],
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            switchCompilationMode("optimize");
            return "KeepGoing";
          case 2:
            expandUi();
            showErrors();
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      🚨 Main

      ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
      ⧙Target: Main⧘

      I ran your postprocess command:

      cd /Users/you/project/tests/fixtures/hot/error-overlay-bold-and-dim
      printf '(function(...;}(this));' | node postprocess.js Main optimize hot

      ⧙It exited with an error:⧘

      exit 1
      ⧙(no output)⧘

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed compilation mode to "optimize" of: Main⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(getOverlay()).toMatchInlineSnapshot(`
      <overlay visible style="background-color: rgb(32, 30, 30);">
      <details open="" id="0" data-target-names="Main" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
      <summary><span style="background-color: rgb(32, 30, 30);">POSTPROCESS ERROR</span><p>Target: Main</p></summary>
      <pre>I ran your postprocess command:

      cd /Users/you/project/tests/fixtures/hot/error-overlay-bold-and-dim
      printf '(function(...;}(this));' | node postprocess.js Main optimize hot

      <b>It exited with an error:</b>

      exit 1
      <span style="opacity: 0.6">(no output)</span></pre></details>
      </overlay>
    `);
  });

  describe("click error location", () => {
    const fixture = "persisted-open-error-overlay";

    const runFailClickErrorLocation = async (env: Env): Promise<string> => {
      const { renders } = await run({
        fixture,
        args: [],
        scripts: ["Main.js"],
        keepElmStuffJson: true,
        env,
        init: (node) => {
          window.Elm?.Main?.init({ node });
        },
        onIdle: ({ idle }) => {
          switch (idle) {
            case 1:
              clickFirstErrorLocation();
              return "KeepGoing";
            default:
              return "Stop";
          }
        },
      });
      return renders;
    };

    test("env var not set", async () => {
      const renders = await runFailClickErrorLocation({});
      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ 🚨 13:10:05 Main
        ================================================================================
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988
        updated 2022-02-05 13:10:05
        status Compilation error
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◉ Standard
        ◯ Optimize
        [Hide errors]
        Clicking error locations only works if you set it up.
        Check this out: [Clickable error locations](https://github.com/lydell/elm-watch#clickable-error-locations)
        ↑↗
        ·→
        ▲ 🚨 13:10:05 Main
      `);
    });

    test("unknown command", async () => {
      const renders = await runFailClickErrorLocation({
        [ELM_WATCH_OPEN_EDITOR]: "nope",
      });

      const replacement = "nope: command not found";

      const cleanedRenders = renders
        // macOS
        .replace("/bin/sh: nope: command not found", replacement)
        // Linux
        .replace("/bin/sh: 1: nope: not found", replacement)
        // Windows
        .replace(
          "'nope' is not recognized as an internal or external command,\r\noperable program or batch file.",
          replacement
        )
        .replace("code 1.", "code 127.");

      expect(cleanedRenders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ 🚨 13:10:05 Main
        ================================================================================
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988
        updated 2022-02-05 13:10:05
        status Compilation error
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◉ Standard
        ◯ Optimize
        [Hide errors]
        Opening the location in your editor failed!
        I ran your command for opening an editor (set via the ELM_WATCH_OPEN_EDITOR environment variable):

        cd /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay
        nope

        I ran the command with these extra environment variables:

        {
         "file": "/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm",
         "line": "10",
         "column": "31"
        }

        The command exited with code 127.

        nope: command not found
        ↑↗
        ·→
        ▲ 🚨 13:10:05 Main
      `);
    });

    test("timeout", async () => {
      const renders = await runFailClickErrorLocation({
        [ELM_WATCH_OPEN_EDITOR]: `node -e "setTimeout(() => process.exit(1), 10000)"`,
        [__ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS]: "10",
      });
      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ 🚨 13:10:05 Main
        ================================================================================
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988
        updated 2022-02-05 13:10:05
        status Compilation error
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◉ Standard
        ◯ Optimize
        [Hide errors]
        Opening the location in your editor failed!
        I ran your command for opening an editor (set via the ELM_WATCH_OPEN_EDITOR environment variable):

        cd /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay
        node -e "setTimeout(() => process.exit(1), 10000)"

        I ran the command with these extra environment variables:

        {
         "file": "/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm",
         "line": "10",
         "column": "31"
        }

        The command took too long to run, and was killed after 10 ms.

        (no output)
        ↑↗
        ·→
        ▲ 🚨 13:10:05 Main
      `);
    });

    test("exit 1", async () => {
      const renders = await runFailClickErrorLocation({
        [ELM_WATCH_OPEN_EDITOR]: `node -e "process.exit(1)"`,
      });
      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ 🚨 13:10:05 Main
        ================================================================================
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988
        updated 2022-02-05 13:10:05
        status Compilation error
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◉ Standard
        ◯ Optimize
        [Hide errors]
        Opening the location in your editor failed!
        I ran your command for opening an editor (set via the ELM_WATCH_OPEN_EDITOR environment variable):

        cd /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay
        node -e "process.exit(1)"

        I ran the command with these extra environment variables:

        {
         "file": "/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm",
         "line": "10",
         "column": "31"
        }

        The command exited with code 1.

        (no output)
        ↑↗
        ·→
        ▲ 🚨 13:10:05 Main
      `);
    });

    test("successful execution", async () => {
      const outputFile = path.join(
        FIXTURES_DIR,
        fixture,
        "click-error-location.txt"
      );
      rm(outputFile);

      const arg = IS_WINDOWS
        ? `"%file%:%line%:%column%"`
        : `"$file:$line:$column"`;

      const { renders } = await run({
        fixture,
        args: [],
        scripts: ["Main.js"],
        keepElmStuffJson: true,
        env: {
          [ELM_WATCH_OPEN_EDITOR]: `node -e "require('fs').writeFileSync('click-error-location.txt', process.argv[1])" ${arg}`,
        },
        init: (node) => {
          window.Elm?.Main?.init({ node });
        },
        onIdle: async () => {
          clickFirstErrorLocation();
          while (!fs.existsSync(outputFile)) {
            await wait(100);
          }
          return "Stop" as const;
        },
      });

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        ▼ 🚨 13:10:05 Main
      `);
      expect(clean(fs.readFileSync(outputFile, "utf-8"))).toMatchInlineSnapshot(
        `/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31`
      );
    });
  });

  test("persisted debug mode for Html", async () => {
    // You can set "compilationMode": "debug" for Html and Worker programs in
    // elm-stuff/elm-watch/stuff.json. The only thing that happens is that the disabled
    // "debug" radio button is checked.
    const { terminal, renders } = await run({
      fixture: "persisted-debug-mode-for-html",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: ({ body }) => {
        // No debugger.
        expect(body.outerHTML).toMatchInlineSnapshot(
          `<body><div>Html</div></body>`
        );
        expandUi();
        return "Stop";
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:9988)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🐛 ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🐛 🔌 13:10:05 Main
      ================================================================================
      ▼ 🐛 🔌 13:10:05 Main
      ================================================================================
      ▼ 🐛 ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🐛 ✅ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◉ (disabled) Debug 🐛 The Elm debugger isn't supported by \`Html\` programs.
      ◯ Standard
      ◯ Optimize
      ↑↗
      ·→
      ▲ 🐛 ✅ 13:10:05 Main
    `);
  });

  test("late init", async () => {
    const { terminal, renders } = await run({
      fixture: "late-init",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: () => {
        expandUi();
      },
      onIdle: ({ div }) => {
        window.Elm?.Main?.init({ node: div });
        return "Stop";
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      It looks like no Elm apps were initialized by elm-watch. Check the console in the browser developer tools to see potential errors!
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Successfully compiled
      It looks like no Elm apps were initialized by elm-watch. Check the console in the browser developer tools to see potential errors!
      ↑↗
      ·→
      ▲ ❓ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
      ◉ Standard
      ◯ Optimize
      ↑↗
      ·→
      ▲ ✅ 13:10:05 Main
    `);
  });

  test("typecheck only", async () => {
    const fixture = "typecheck-only";
    const main4Path = path.join(FIXTURES_DIR, fixture, "src", "Main4.elm");
    const sharedPath = path.join(FIXTURES_DIR, fixture, "src", "Shared.elm");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["Main3.js", "Main4.js"],
      isTTY: false,
      init: (node) => {
        const node1 = document.createElement("div");
        const node2 = document.createElement("div");
        node.append(node1, node2);
        window.Elm?.Main3?.init({ node: node1 });
        window.Elm?.Main4?.init({ node: node2 });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            return "KeepGoing";
          case 2:
            touch(sharedPath);
            return "KeepGoing";
          case 3:
            return "KeepGoing";
          case 4:
            touch(main4Path);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ⏳ Main3: elm make (typecheck only)
      ⏳ Main4: elm make (typecheck only)
      ✅ Main1⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Main2⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Main3⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Main4⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Main4: elm make
      ⚪️ Main3: queued
      ✅ Main4⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Main3: elm make
      ✅ Main3⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main3
      ℹ️ 13:10:05 Web socket connected needing compilation of: Main4⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main4
      ℹ️ 13:10:05 Web socket disconnected for: Main3
      ℹ️ 13:10:05 Web socket connected for: Main3
      ℹ️ 13:10:05 Web socket connected for: Main4⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main4: elm make
      ⚪️ Main3: queued
      ⚪️ Main1: queued
      ⚪️ Main2: queued
      ✅ Main4⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Main3: elm make
      ✅ Main3⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ✅ Main1⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Main2⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/typecheck-only/src/Shared.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Main4: elm make
      ✅ Main4⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/typecheck-only/src/Main4.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("prioritize last focused target", async () => {
    const fixture = "prioritization";
    const sharedFile = path.join(FIXTURES_DIR, fixture, "src", "Shared.elm");
    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["One.js", "Two.js"],
      isTTY: false,
      init: (node) => {
        const node1 = document.createElement("div");
        const node2 = document.createElement("div");
        node.append(node1, node2);
        window.Elm?.One?.init({ node: node1 });
        window.Elm?.Two?.init({ node: node2 });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            // One of them loaded.
            return "KeepGoing";
          case 2:
            // `Two` should be compiled first here since it loaded last.
            touch(sharedFile);
            return "KeepGoing"; // First script has loaded.
          case 3:
            // One of them done.
            return "KeepGoing";
          case 4:
            // This should give priority to `One`.
            window.dispatchEvent(new CustomEvent("focus", { detail: "One" }));
            touch(sharedFile);
            return "KeepGoing";
          case 5:
            // One of them done.
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ One: elm make (typecheck only)
      ⏳ Two: elm make (typecheck only)
      ✅ One⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Two⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Two: elm make
      ⚪️ One: queued
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ One: elm make
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: One
      ℹ️ 13:10:05 Web socket connected needing compilation of: Two⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Two
      ℹ️ 13:10:05 Web socket disconnected for: One
      ℹ️ 13:10:05 Web socket connected for: One
      ℹ️ 13:10:05 Web socket connected for: Two⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Two: elm make
      ⚪️ One: queued
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ One: elm make
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/prioritization/src/Shared.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ One: elm make
      ⚪️ Two: queued
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Two: elm make
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/prioritization/src/Shared.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  testExceptWindows("duplicate inputs", async () => {
    const fixture = "duplicate-inputs";
    const dir = path.join(FIXTURES_DIR, fixture);
    const elmJsonPath = path.join(dir, "elm.json");
    const main = path.join(dir, "src", "Main.elm");
    const main2 = path.join(dir, "src", "Main2.elm");
    const symlink = path.join(dir, "src", "Symlink.elm");

    rmSymlink(symlink);
    fs.symlinkSync(main2, symlink);

    const { terminal, renders } = await run({
      fixture,
      args: ["Main"],
      scripts: ["Main.js"],
      isTTY: false,
      // The test has a tendency to hang otherwise (`onIdle` is never called).
      // Maybe `elm` doesn’t like the symlink shenanigans.
      clearElmStuff: true,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert(div);
            fs.unlinkSync(symlink);
            return "KeepGoing";
          case 2:
            fs.symlinkSync(main, symlink);
            return "KeepGoing";
          case 3:
            touch(elmJsonPath);
            touch(main);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    fs.unlinkSync(symlink);

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      🚨 Main

      ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
      ⧙Target: Main⧘

      You asked me to compile these inputs:

      src/Symlink.elm ⧙(/Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Symlink.elm)⧘

      ⧙But they don't exist!⧘

      Is something misspelled? Or do you need to create them?

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Symlink.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      🚨 Main

      ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
      ⧙Target: Main⧘

      Some of your inputs seem to be duplicates!

      src/Main.elm
      src/Symlink.elm ⧙(symlink)⧘
      -> /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Main.elm

      Make sure every input is listed just once!

      Note that at least one of the inputs seems to be a symlink. They can be tricky!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Symlink.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      🚨 Main

      ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
      ⧙Target: Main⧘

      Some of your inputs seem to be duplicates!

      src/Main.elm
      src/Symlink.elm ⧙(symlink)⧘
      -> /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Main.elm

      Make sure every input is listed just once!

      Note that at least one of the inputs seems to be a symlink. They can be tricky!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Main.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Symlink.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🚨 13:10:05 Main
      ================================================================================
      ▼ 🚨 13:10:05 Main
      ================================================================================
      ▼ 🚨 13:10:05 Main
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Main</div>`);
    }
  });

  test("missing window.Elm", async () => {
    const { renders } = await run({
      fixture: "missing-window-elm",
      args: ["Main"],
      scripts: ["Main.js"],
      init: () => {
        expect(window.Elm).toBeUndefined();
      },
      onIdle: () => {
        expandUi();
        return "Stop";
      },
    });

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ❌ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Successfully compiled
      elm-watch requires [window.Elm](https://github.com/lydell/elm-watch#windowelm) to exist, but it is undefined!
      ↑↗
      ·→
      ▲ ❌ 13:10:05 Main
    `);
  });

  test("Move UI", async () => {
    const { renders } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            moveUi("TopLeft");
            return "KeepGoing";
          case 2:
            moveUi("TopRight");
            return "KeepGoing";
          case 3:
            moveUi("BottomRight");
            return "KeepGoing";
          case 4:
            moveUi("BottomLeft");
            return "KeepGoing";
          case 5:
            // Note: This results in the server sending two "Busy" messages.
            // Both local updates happen (moving the UI to the top-left corner),
            // then both "Busy" messages arrive, temporarily flipping back to the
            // bottom-right corner. In reality I’ve never seen this, but it explains
            // the snapshot output.
            moveUi("BottomRight");
            moveUi("TopLeft");
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    const newRenders = renders
      .split(/\n=+\n/)
      // Focus on just the arrow buttons and status emojis.
      .map((segment) => segment.split("\n").slice(-3).join("\n"))
      .join(`\n${"=".repeat(80)}\n`)
      // Remove duplicate renders in a row.
      .replace(/(=+[^=]+)\1/g, "$1");

    expect(newRenders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ 🔌 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ ✅ 13:10:05 Html
      ================================================================================
      ↑↗
      ·→
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ·→
      ↓↘
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ·→
      ↓↘
      ▲ ⏳ 13:10:05 Html
      ================================================================================
      ·→
      ↓↘
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ←·
      ↙↓
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ←·
      ↙↓
      ▲ ⏳ 13:10:05 Html
      ================================================================================
      ←·
      ↙↓
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ↖↑
      ←·
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ↖↑
      ←·
      ▲ ⏳ 13:10:05 Html
      ================================================================================
      ↖↑
      ←·
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ↑↗
      ·→
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 Html
      ================================================================================
      ↑↗
      ·→
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ↖↑
      ←·
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ·→
      ↓↘
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ↖↑
      ←·
      ▲ ⏳ 13:10:05 Html
      ================================================================================
      ·→
      ↓↘
      ▲ ⏳ 13:10:05 Html
      ================================================================================
      ·→
      ↓↘
      ▲ ⏳ 13:10:05 Html
      ================================================================================
      ·→
      ↓↘
      ▲ ✅ 13:10:05 Html
      ================================================================================
      ·→
      ↓↘
      ▲ ✅ 13:10:05 Html
    `);
  });

  test("WebSocket server HTTP HTML page", async () => {
    const fixture = "websocket-server-http-html";
    const dir = path.join(FIXTURES_DIR, fixture);
    const elmWatchJsonPath = path.join(dir, "elm-watch.json");
    const elmWatchJson: unknown = JSON.parse(
      fs.readFileSync(elmWatchJsonPath, "utf8")
    );
    const port = Decode.fields((field) => field("port", Decode.number))(
      elmWatchJson
    );

    let mainHtml = "(not set)";
    let variations: Array<string> = ["(not set)"];

    await run({
      fixture,
      args: ["Main"],
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: async () => {
        mainHtml = await httpGet(`http://localhost:${port}`);
        variations = await Promise.all([
          httpGet(`https://localhost:${port}`),
          httpGet(`http://localhost:${port}/accept`),
          httpGet(`http://localhost:${port}/accept`, { setHost: false }),
          httpGet(`https://localhost:${port}/accept`),
          httpGet(`https://localhost:${port}/accept`, {
            headers: { referer: `http://localhost:${port + 1}/page` },
          }),
          httpGet(`https://localhost:${port}/accept`, {
            headers: { referer: `http://localhost:${port}/accept` },
          }),
        ]);
        return "Stop" as const;
      },
    });

    expect(mainHtml).toMatchInlineSnapshot(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>elm-watch</title>
          <style>
            html {
              font-family: system-ui, sans-serif;
            }
          </style>
        </head>
        <body>
          <p>ℹ️ This is the elm-watch WebSocket server.</p>
          
        </body>
      </html>
    `);

    const variationsString = variations
      .map((html) => {
        const match = /<body>\n( *)([^]*)<\/body>/.exec(html);
        if (match === null) {
          return `Unable to match '<body> ... </body>' in:\n${html}`;
        }
        const [, indent = "", content = "missing content"] = match;
        return content.trim().replace(RegExp(`^ {${indent.length}}`, "gm"), "");
      })
      .join(`\n${"=".repeat(80)}\n`);

    expect(variationsString).toMatchInlineSnapshot(`
      <p>ℹ️ This is the elm-watch WebSocket server.</p>
      ================================================================================
      <p>ℹ️ This is the elm-watch WebSocket server.</p>
      <p>Did you mean to go to the <a href="https://localhost:9753/accept">HTTPS version of this page</a> to accept elm-watch's self-signed certificate?</p>
      ================================================================================
      <p>ℹ️ This is the elm-watch WebSocket server.</p>
      <p>Did you mean to go to the HTTPS version of this page to accept elm-watch's self-signed certificate?</p>
      ================================================================================
      <p>ℹ️ This is the elm-watch WebSocket server.</p>
      <p>✅ Certificate accepted. You may now return to your page.</p>
      ================================================================================
      <p>ℹ️ This is the elm-watch WebSocket server.</p>
      <p>✅ Certificate accepted. You may now <a href="http://localhost:9754/page">return to your page</a>.</p>
      ================================================================================
      <p>ℹ️ This is the elm-watch WebSocket server.</p>
      <p>✅ Certificate accepted. You may now return to your page.</p>
    `);
  });

  test("ctrl+c", async () => {
    const stdin = new CtrlCReadStream();
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      stdin,
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: () => {
        stdin.ctrlC();
        return "KeepGoing";
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Html
      ℹ️ 13:10:05 Web socket connected for: Html⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
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
    `);
  });

  describe("printTimeline", () => {
    function print(
      events: Array<LatestEvent>,
      loggerConfig?: Partial<LoggerConfig>
    ): string | undefined {
      const result = printTimeline(
        {
          debug: false,
          noColor: false,
          fancy: true,
          isTTY: true,
          mockedTimings: false,
          columns: 80,
          ...loggerConfig,
        },
        events
      );
      return result === undefined
        ? undefined
        : clean(result).replace(/\x1B\[3G/g, "");
    }

    const events: Array<LatestEvent> = [
      {
        tag: "WatcherEvent",
        date: new Date("2022-03-05T23:59:05Z"),
        eventName: "changed",
        file: { tag: "AbsolutePath", absolutePath: "/One.elm" },
        affectsAnyTarget: true,
      },
      {
        tag: "WebSocketConnectedNeedingCompilation",
        date: new Date("2022-03-06T00:00:11Z"),
        outputPath: {
          tag: "OutputPath",
          theOutputPath: { tag: "AbsolutePath", absolutePath: "/build/One.js" },
          temporaryOutputPath: {
            tag: "AbsolutePath",
            absolutePath: "/elm-stuff/elm-watch/1.js",
          },
          originalString: "build/One.js",
          targetName: "One",
        },
      },
      {
        tag: "WatcherEvent",
        date: new Date("2022-03-06T00:01:23Z"),
        eventName: "removed",
        file: { tag: "AbsolutePath", absolutePath: "/Two.elm" },
        affectsAnyTarget: true,
      },
      {
        tag: "WatcherEvent",
        date: new Date("2022-03-06T00:01:24Z"),
        eventName: "added",
        file: { tag: "AbsolutePath", absolutePath: "/Three.elm" },
        affectsAnyTarget: true,
      },
      {
        tag: "WebSocketClosed",
        date: new Date("2022-03-06T00:02:00Z"),
        outputPath: { tag: "OutputPathError" },
      },
      {
        tag: "WebSocketConnectedWithErrors",
        date: new Date("2022-03-06T00:02:59Z"),
      },
    ];

    test("0 events", () => {
      expect(print([])).toMatchInlineSnapshot(`undefined`);
    });

    test("1 event", () => {
      expect(print(events.slice(0, 1))).toMatchInlineSnapshot(
        `⧙ℹ️ 23:59:05 Changed /One.elm⧘`
      );
    });

    test("2 events", () => {
      expect(print(events.slice(0, 2))).toMatchInlineSnapshot(`
        ⧙ℹ️ 23:59:05 Changed /One.elm
        ℹ️ 00:00:11 Web socket connected needing compilation of: One⧘
      `);
    });

    test("3 events", () => {
      expect(print(events.slice(0, 3))).toMatchInlineSnapshot(`
        ⧙ℹ️ 23:59:05 Changed /One.elm
        ℹ️ 00:00:11 Web socket connected needing compilation of: One
        ℹ️ 00:01:23 Removed /Two.elm⧘
      `);
    });

    test("4 events", () => {
      expect(print(events.slice(0, 4))).toMatchInlineSnapshot(`
        ⧙ℹ️ 23:59:05 Changed /One.elm
        ℹ️ 00:00:11 Web socket connected needing compilation of: One
        ℹ️ 00:01:23 Removed /Two.elm
        ℹ️ 00:01:24 Added /Three.elm⧘
      `);
    });

    test("5 events", () => {
      expect(print(events.slice(0, 5))).toMatchInlineSnapshot(`
        ⧙ℹ️ 23:59:05 Changed /One.elm
        ℹ️ 00:00:11 Web socket connected needing compilation of: One
        ℹ️ 00:01:23 Removed /Two.elm
        ℹ️ 00:01:24 Added /Three.elm
        ℹ️ 00:02:00 Web socket disconnected for: (no matching target)⧘
      `);
    });

    test("6 events", () => {
      expect(print(events.slice(0, 6))).toMatchInlineSnapshot(`
        ⧙ℹ️ 23:59:05 Changed /One.elm
        ℹ️ 00:00:11 Web socket connected needing compilation of: One
           (2 more events)
        ℹ️ 00:02:00 Web socket disconnected for: (no matching target)
        ℹ️ 00:02:59 Web socket connected with errors (see the browser for details)⧘
      `);
    });

    test("6 events, non-fancy", () => {
      expect(print(events.slice(0, 6), { fancy: false }))
        .toMatchInlineSnapshot(`
        ⧙23:59:05 Changed /One.elm
        00:00:11 Web socket connected needing compilation of: One
        (2 more events)
        00:02:00 Web socket disconnected for: (no matching target)
        00:02:59 Web socket connected with errors (see the browser for details)⧘
      `);
    });
  });
});
