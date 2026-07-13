// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { afterEach, describe, expect, onTestFinished, test } from "vitest";

import { WebSocketToServerMessage } from "../client/WebSocketMessages";
import {
  __ELM_WATCH_ELM_TIMEOUT_MS,
  __ELM_WATCH_EXIT_ON_WORKER_LIMIT,
  __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS,
  __ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS,
  ELM_WATCH_EXIT_ON_STDIN_END,
  ELM_WATCH_OPEN_EDITOR,
  Env,
  NO_COLOR,
} from "../src/Env";
import { LatestEvent, printTimeline } from "../src/Hot";
import { IS_WINDOWS } from "../src/IsWindows";
import { LoggerConfig } from "../src/Logger";
import { markAsAbsolutePath, markAsTargetName } from "../src/Types";
import {
  clean,
  CtrlCReadStream,
  grep,
  onlyErrorMessages,
  rimraf,
  rm,
  rmSymlink,
  SilentReadStream,
  stringSnapshotSerializer,
  TEST_ENV,
  TEST_ENV_WITHOUT_ELM_ERROR_WORKAROUND,
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
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Html⧘
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
        window.Elm?.["Worker"]?.init();
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
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
      ▼ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
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
      web socket ws://localhost:59123/elm-watch
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
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
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
      web socket ws://localhost:59123/elm-watch
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
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      Html: success                            1 ms Q | 1.23 s E /  55 ms W |   9 ms I

      server: http://localhost:59123, network: http://192.168.0.1:59123
      web socket connections: 1

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
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      server: http://localhost:59123, network: http://192.168.0.1:59123
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

  test("successful connect (package)", async () => {
    const { terminal, renders, div } = await run({
      fixture: "package",
      args: ["Main"],
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Main⧘
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
    const dir = path.join(FIXTURES_DIR, fixture);
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

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Main⧘
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
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger cannot be enabled until at least one Elm app has been initialized. (Check the browser console for errors if you expected an Elm app to be initialized by now.)
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
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
      🚨 Removed

      ⧙-- TROUBLE READING OUTPUT ------------------------------------------------------⧘
      ⧙Target: Removed⧘

      I managed to compile your code. Then I tried to read the output:

      /Users/you/project/tests/fixtures/hot/basic/elm-stuff/elm-watch/2.js

      Doing so I encountered this error:

      ENOENT: no such file or directory, open '/Users/you/project/tests/fixtures/hot/basic/elm-stuff/elm-watch/2.js'

      🚨 ⧙1⧘ error found

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Removed⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      target Removed
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
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

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Readonly⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      target Readonly
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
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

  describe("Parse WebSocket connect request url errors", () => {
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
              "TestWebSocket expects the url to be a URL object, not a string!",
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
      let i = 0;
      modifyUrl((url) => {
        i++;
        if (i === 1) {
          url.pathname = "nope";
        }
      });

      const { terminal } = await run({
        fixture: "basic",
        args: ["BadUrl"],
        scripts: ["BadUrl.js"],
        isTTY: false,
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(grep(terminal, /rejected/)).toMatchInlineSnapshot(
        `ℹ️ ⧙13:10:05⧘ ⧙Web socket connection from "http://localhost" rejected due to: wrong URL prefix – "/elm-watch?" != "/nope?elmWa"⧘`,
      );
    });

    test("params decode error and disconnect", async () => {
      modifyUrl((url) => {
        url.searchParams.set("elmCompiledTimestamp", "2021-12-11");
      });

      const { onlyExpandedRenders } = await run({
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

      expect(onlyExpandedRenders).toMatchInlineSnapshot(`
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I ran into trouble parsing the web socket connection URL parameters:

        At root["elmCompiledTimestamp"]:
        Expected a number
        Got: "2021-12-11"

        The URL parameters look like this:

        elmWatchVersion=%25VERSION%25&webSocketToken=37476437-1911-402a-9c87-fd94405770d2&targetName=ParamsDecodeError&elmCompiledTimestamp=2021-12-11

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here.

        Or maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Sleeping
        attempt 1
        sleep 1.01 seconds
        [Reconnect web socket now]
        ▲ 🔌 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
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
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I ran into trouble parsing the web socket connection URL parameters:

        At root["elmCompiledTimestamp"]:
        Expected a number
        Got: "2021-12-11"

        The URL parameters look like this:

        elmWatchVersion=%25VERSION%25&webSocketToken=37476437-1911-402a-9c87-fd94405770d2&targetName=ParamsDecodeError&elmCompiledTimestamp=2021-12-11

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here.

        Or maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 13:10:05 ParamsDecodeError
      `);
    });

    test("wrong version and send message anyway", async () => {
      modifyUrl((url) => {
        url.searchParams.set("elmWatchVersion", "0.0.0");
      });

      const { onlyExpandedRenders } = await run({
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

      expect(onlyExpandedRenders).toMatchInlineSnapshot(`
        target WrongVersion
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
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

    test("omitting the version is ok (useful for third party clients)", async () => {
      modifyUrl((url) => {
        url.searchParams.delete("elmWatchVersion");
      });

      const { onlyExpandedRenders, terminal } = await run({
        fixture: "basic",
        args: ["Html"],
        scripts: ["Html.js"],
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(onlyExpandedRenders).toMatchInlineSnapshot(``);

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Html⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);
    });

    test("wrong token", async () => {
      let i = 0;
      modifyUrl((url) => {
        i++;
        if (i === 1) {
          url.searchParams.set("webSocketToken", "wrong");
        }
      });

      const { terminal } = await run({
        fixture: "basic",
        args: ["WrongToken"],
        scripts: ["WrongToken.js"],
        isTTY: false,
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(grep(terminal, /rejected/)).toMatchInlineSnapshot(
        `ℹ️ ⧙13:10:05⧘ ⧙Web socket connection from "http://localhost" rejected due to: invalid security token⧘`,
      );
    });

    test("target not found", async () => {
      modifyUrl((url) => {
        url.searchParams.set("targetName", "nope");
      });

      const { terminal, onlyExpandedRenders } = await run({
        fixture: "target-not-found",
        args: ["Enabled"],
        scripts: ["Enabled1.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙Target: EnabledNotFound⧘

        You asked me to compile these inputs:

        src/EnabledNotFound.elm ⧙(/Users/you/project/tests/fixtures/hot/target-not-found/src/EnabledNotFound.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?
      `);

      expect(onlyExpandedRenders).toMatchInlineSnapshot(`
        target Enabled1
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
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

      const { onlyExpandedRenders } = await run({
        fixture: "single",
        args: ["Main"],
        scripts: ["Main.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(onlyExpandedRenders).toMatchInlineSnapshot(`
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
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
        "elm-watch.template.json",
      );
      const elmWatchJsonString = fs.readFileSync(
        elmWatchJsonTemplatePath,
        "utf8",
      );
      fs.writeFileSync(elmWatchJsonPath, elmWatchJsonString);

      const { renders } = await run({
        fixture,
        scripts: ["Main.js"],
        isTTY: false,
        init: (node) => {
          try {
            window.Elm?.["Main"]?.init({ node });
          } catch {
            // Ignore elm-watch proxy “error” on reload.
          }
        },
        onIdle: ({ idle }) => {
          switch (idle) {
            case 1:
              fs.writeFileSync(
                elmWatchJsonPath,
                elmWatchJsonString.replace("Main", "Renamed"),
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
        web socket ws://localhost:59123/elm-watch
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

      const { onlyExpandedRenders } = await run({
        fixture: "basic",
        args: ["TargetDisabled"],
        scripts: ["TargetDisabled.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(onlyExpandedRenders).toMatchInlineSnapshot(`
        target TargetDisabled
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
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
        WrongToken
        SendBadJson
        Reconnect
        HttpCaching
        "Esc\\apes"

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

      const { onlyExpandedRenders } = await run({
        fixture: "basic",
        args: ["SendBadJson"],
        scripts: ["SendBadJson.js"],
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
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

      expect(onlyExpandedRenders).toMatchInlineSnapshot(`
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
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
        web socket ws://localhost:59123/elm-watch
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
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["tag"]:
        Expected one of these tags:
         "ChangedCompilationMode",
         "ChangedBrowserUiPosition",
         "ChangedOpenErrorOverlay",
         "FocusedTab",
         "PressedOpenEditor"
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

      const { renders } = await run({
        fixture: "basic",
        args: ["Reconnect"],
        scripts: ["Reconnect.js"],
        expandUiImmediately: true,
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Sleeping
        attempt 2
        sleep 1.04 seconds
        [Reconnect web socket now]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 2
        sleep 1.04 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Sleeping
        attempt 3
        sleep 1.09 seconds
        [Reconnect web socket now]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 3
        sleep 1.09 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
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
        web socket ws://localhost:59123/elm-watch
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
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123/elm-watch
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
        web socket ws://localhost:59123/elm-watch
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
    });

    test("outdated timestamp", async () => {
      modifyUrl((url) => {
        url.searchParams.set("elmCompiledTimestamp", "0");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["Html"],
        scripts: ["Html.js"],
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
        📊 ⧙web socket connections:⧘ 1

        ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Html⧘
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

    const { terminal } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      cwd: "src",
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            touch(roguePath);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.slice(0, -10),
            );
            await wait(1000);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.replace(/"postprocess":.*/, ""),
            );
            return "KeepGoing" as const;
          case 2:
            assert2(div);
            fs.writeFileSync(elmWatchJsonPath2, "{}");
            await wait(100);
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
    const postprocessPath = path.join(FIXTURES_DIR, fixture, "postprocess.js");
    const postprocessTemplatePath = path.join(
      FIXTURES_DIR,
      fixture,
      "postprocess.template.js",
    );
    const roguePath = path.join(FIXTURES_DIR, fixture, "src", "postprocess.js");
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
    const htmlPath = path.join(FIXTURES_DIR, fixture, "src", "Html.elm");
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
    const unusedFolder = path.join(FIXTURES_DIR, fixture, "src", "Unused");

    const { terminal } = await run({
      fixture,
      args: ["HtmlMain1"],
      scripts: ["HtmlMain1.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain1"]?.init({ node });
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

    // The order in which the files are detected by the watcher
    // is not defined when they happen so close to each other.
    const adjustedTerminal = grep(terminal, /Changed|FYI/).replace(
      /\w+\.elm/g,
      "File.elm",
    );

    expect(adjustedTerminal).toMatchInlineSnapshot(`
      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File.elm⧘
      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File.elm⧘
      ✅ ⧙13:10:05⧘ FYI: The above Elm files are not imported by any of the enabled targets. Nothing to do!
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("non interesting .elm files changed, with all targets enabled", async () => {
    const fixture = "non-interesting-elm-files-changed-all-targets";
    const unusedFile1 = path.join(FIXTURES_DIR, fixture, "src", "Unused.elm");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: async ({ div }) => {
        assert(div);
        touch(unusedFile1);
        await wait(100);
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
    const src = path.join(FIXTURES_DIR, fixture, "src");
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
      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
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

    const main = path.join(FIXTURES_DIR, fixture, "src", "Main.elm");

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
        ...TEST_ENV_WITHOUT_ELM_ERROR_WORKAROUND,
        [__ELM_WATCH_ELM_TIMEOUT_MS]: "0",
      },
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
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
    expect(grep(terminal, /[⏳✅]/u)).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ⏳ Dependencies
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ⏳ Main: interrupted
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main: elm make
      ⏳ Main: interrupted
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
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
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);
  });

  test("kill postprocess", async () => {
    const fixture = "kill-postprocess";
    const input = path.join(FIXTURES_DIR, fixture, "src", "Main.elm");
    const tmp = path.join(FIXTURES_DIR, fixture, "postprocess.tmp");
    fs.writeFileSync(tmp, "1");
    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
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

    expect(grep(terminal, /: (?:postprocess|interrupted)/))
      .toMatchInlineSnapshot(`
      ⏳ Main: postprocess
      ⏳ Main: postprocess
      ⏳ Main: interrupted
      ⏳ Main: postprocess
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content before</div>`,
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content after</div>`,
      );
    }
  });

  test("kill postprocess (elm-watch-node)", async () => {
    const fixture = "kill-postprocess-elm-watch-node";
    const input = path.join(FIXTURES_DIR, fixture, "src", "Main.elm");
    const tmp = path.join(FIXTURES_DIR, fixture, "postprocess.tmp");
    fs.writeFileSync(tmp, "1");
    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
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

    expect(grep(terminal, /: (?:postprocess|interrupted)/))
      .toMatchInlineSnapshot(`
        ⏳ Main: postprocess
        ⏳ Main: postprocess
        ⏳ Main: interrupted
        ⏳ Main: postprocess
      `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content before</div>`,
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content after</div>`,
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
        [NO_COLOR]: "",
      },
      init: (node) => {
        const node1 = document.createElement("div");
        const node2 = document.createElement("div");
        node.append(node1, node2);
        window.Elm?.["One"]?.init({ node: node1 });
        window.Elm?.["Two"]?.init({ node: node2 });
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

    // Remove duplicate lines.
    expect(
      grep(terminal, /worker/).replace(/\n(.+)(?:\n\1)+/g, "\n$1"),
    ).toMatchInlineSnapshot(`13:10:05 Terminated 1 superfluous worker`);
  });

  test("persisted compilation mode", async () => {
    const { renders } = await run({
      fixture: "persisted-compilation-mode",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: ({ body }) => {
        assertDebugger(body);
        return "Stop";
      },
    });

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
    const { renders } = await run({
      fixture: "persisted-browser-ui-position",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      expandUiImmediately: true,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988/elm-watch
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988/elm-watch
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
      web socket ws://localhost:9988/elm-watch
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
      web socket ws://localhost:9988/elm-watch
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988/elm-watch
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988/elm-watch
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
      web socket ws://localhost:9988/elm-watch
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
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31

      I am struggling with this boolean operation:

      10|     , view = \\_ -> if True && 5 then Html.text "yes" else Html.text "no"
                                        ⧙^⧘
      Both sides of (&&) must be ⧙Bool⧘ values, but the right side is:

          ⧙number⧘

      ⧙Hint⧘: Only ⧙Int⧘ and ⧙Float⧘ values work as numbers.
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
        window.Elm?.["Main"]?.init({ node });
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

      server: http://localhost:59123, network: http://192.168.0.1:59123
      web socket connections: 1

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
        window.Elm?.["Main"]?.init({ node });
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

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
      ⧙Target: Main⧘

      I ran your postprocess command:

      cd /Users/you/project/tests/fixtures/hot/error-overlay-bold-and-dim
      printf '(function(...;}(this));' | node postprocess.js Main optimize hot

      ⧙It exited with an error:⧘

      exit 1
      ⧙(no output)⧘
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

    const originalWebSocket = WebSocket;

    afterEach(() => {
      window.WebSocket = originalWebSocket;
    });

    const runFailClickErrorLocation = async ({
      env,
      modifyPressedOpenEditor = (message) => message,
    }: {
      env: Env;
      modifyPressedOpenEditor?: (
        message: Extract<
          WebSocketToServerMessage,
          { tag: "PressedOpenEditor" }
        >,
      ) => Extract<WebSocketToServerMessage, { tag: "PressedOpenEditor" }>;
    }): Promise<string> => {
      class TestWebSocket extends WebSocket {
        override send(
          data: string | ArrayBufferLike | Blob | ArrayBufferView,
        ): void {
          if (typeof data === "string") {
            const parsed = Codec.JSON.parse(WebSocketToServerMessage, data);
            switch (parsed.tag) {
              case "DecoderError":
                throw new Error(Codec.format(parsed.error));
              case "Valid":
                if (parsed.value.tag === "PressedOpenEditor") {
                  super.send(
                    Codec.JSON.stringify(
                      WebSocketToServerMessage,
                      modifyPressedOpenEditor(parsed.value),
                    ),
                  );
                  return;
                }
            }
          }
          super.send(data);
        }
      }

      window.WebSocket = TestWebSocket;

      const { renders, onlyExpandedRenders } = await run({
        fixture,
        args: [],
        scripts: ["Main.js"],
        keepElmStuffJson: true,
        env,
        init: (node) => {
          window.Elm?.["Main"]?.init({ node });
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
      return onlyExpandedRenders === "" ? renders : onlyExpandedRenders;
    };

    test("env var not set", async () => {
      const renders = await runFailClickErrorLocation({ env: {} });
      expect(renders).toMatchInlineSnapshot(`
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988/elm-watch
        updated 2022-02-05 13:10:05
        status Compilation error
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◉ Standard
        ◯ Optimize
        [Hide errors]

        ℹ️ Clicking error locations only works if you set it up.
        Check this out: [Clickable error locations](https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations)
        ↑↗
        ·→
        ▲ 🚨 13:10:05 Main
      `);
    });

    test("invalid line number", async () => {
      const renders = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: "true",
        },
        modifyPressedOpenEditor: (message) => ({
          ...message,
          line: -1,
        }),
      });
      expect(renders).toMatchInlineSnapshot(`
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988/elm-watch
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["line"]:
        Expected a non-negative integer
        Got: -1

        The web socket code I generate is supposed to always send correct messages, so something is up here.
        ▲ ❌ 13:10:05 Main
      `);
    });

    test("invalid column number", async () => {
      const renders = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: "true",
        },
        modifyPressedOpenEditor: (message) => ({
          ...message,
          column: 5.8,
        }),
      });
      expect(renders).toMatchInlineSnapshot(`
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988/elm-watch
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["column"]:
        Expected a non-negative integer
        Got: 5.8

        The web socket code I generate is supposed to always send correct messages, so something is up here.
        ▲ ❌ 13:10:05 Main
      `);
    });

    test("invalid file", async () => {
      const renders = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: "true",
        },
        modifyPressedOpenEditor: (message) => ({
          ...message,
          file: markAsAbsolutePath("; echo hacked #"),
        }),
      });
      expect(renders).toMatchInlineSnapshot(`
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988/elm-watch
        updated 2022-02-05 13:10:05
        status Compilation error
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◉ Standard
        ◯ Optimize
        [Hide errors]
        Opening the location in your editor failed!
        I received a command to open the following file in your editor:

        ; echo hacked #

        However, no target imports that file. For security reasons, I never executed any command with that file.
        ↑↗
        ·→
        ▲ 🚨 13:10:05 Main
      `);
    });

    test("unknown command", async () => {
      const renders = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: "nope",
        },
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
          replacement,
        )
        .replace("code 1.", "code 127.");

      expect(cleanedRenders).toMatchInlineSnapshot(`
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988/elm-watch
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
        env: {
          [ELM_WATCH_OPEN_EDITOR]: `node -e "setTimeout(() => process.exit(1), 10000)"`,
          [__ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS]: "10",
        },
      });
      expect(renders).toMatchInlineSnapshot(`
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988/elm-watch
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
        env: {
          [ELM_WATCH_OPEN_EDITOR]: `node -e "process.exit(1)"`,
        },
      });
      expect(renders).toMatchInlineSnapshot(`
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:9988/elm-watch
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
        "click-error-location.txt",
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
          window.Elm?.["Main"]?.init({ node });
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
        `/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31`,
      );
    });
  });

  test("persisted debug mode for Html", async () => {
    // You can set "compilationMode": "debug" for Html and Worker programs in
    // elm-stuff/elm-watch/stuff.json. The only thing that happens is that the disabled
    // "debug" radio button is checked.
    const { onlyExpandedRenders } = await run({
      fixture: "persisted-debug-mode-for-html",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: ({ body }) => {
        // No debugger.
        expect(body.outerHTML).toMatchInlineSnapshot(
          `<body><div>Html</div></body>`,
        );
        expandUi();
        return "Stop";
      },
    });

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988/elm-watch
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
    const { onlyExpandedRenders } = await run({
      fixture: "late-init",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: () => {
        expandUi();
      },
      onIdle: ({ div }) => {
        window.Elm?.["Main"]?.init({ node: div });
        return "Stop";
      },
    });

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger cannot be enabled until at least one Elm app has been initialized. (Check the browser console for errors if you expected an Elm app to be initialized by now.)
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◯ (disabled) Debug The Elm debugger cannot be enabled until at least one Elm app has been initialized. (Check the browser console for errors if you expected an Elm app to be initialized by now.)
      ◉ Standard
      ◯ Optimize
      ↑↗
      ·→
      ▲ ✅ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
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
        window.Elm?.["Main3"]?.init({ node: node1 });
        window.Elm?.["Main4"]?.init({ node: node2 });
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1:
            return "KeepGoing";
          case 2:
            touch(sharedPath);
            return "KeepGoing";
          case 3:
            return "KeepGoing";
          case 4:
            await wait(100);
            touch(main4Path);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(grep(terminal, /elm make/)).toMatchInlineSnapshot(`
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ⏳ Main3: elm make (typecheck only)
      ⏳ Main4: elm make (typecheck only)
      ⏳ Main4: elm make
      ⏳ Main3: elm make
      ⏳ Main4: elm make
      ⏳ Main3: elm make
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ⏳ Main4: elm make
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
        window.Elm?.["One"]?.init({ node: node1 });
        window.Elm?.["Two"]?.init({ node: node2 });
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

    expect(grep(terminal, /(?:One|Two)[:⧙]/)).toMatchInlineSnapshot(`
      ⏳ One: elm make (typecheck only)
      ⏳ Two: elm make (typecheck only)
      ✅ One⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Two⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ⏳ Two: elm make
      ⚪️ One: queued
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ One: elm make
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Two: elm make
      ⚪️ One: queued
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ One: elm make
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ One: elm make
      ⚪️ Two: queued
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Two: elm make
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
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

    const { terminal } = await run({
      fixture,
      args: ["Main"],
      scripts: ["Main.js"],
      isTTY: false,
      // The test has a tendency to hang otherwise (`onIdle` is never called).
      // Maybe `elm` doesn’t like the symlink shenanigans.
      clearElmStuff: true,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
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

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
      ⧙Target: Main⧘

      You asked me to compile these inputs:

      src/Symlink.elm ⧙(/Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Symlink.elm)⧘

      ⧙But they don't exist!⧘

      Is something misspelled? Or do you need to create them?

      …

      ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
      ⧙Target: Main⧘

      Some of your inputs seem to be duplicates!

      src/Main.elm
      src/Symlink.elm ⧙(symlink)⧘
      -> /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Main.elm

      Make sure every input is listed just once!

      Note that at least one of the inputs seems to be a symlink. They can be tricky!

      …

      ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
      ⧙Target: Main⧘

      Some of your inputs seem to be duplicates!

      src/Main.elm
      src/Symlink.elm ⧙(symlink)⧘
      -> /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Main.elm

      Make sure every input is listed just once!

      Note that at least one of the inputs seems to be a symlink. They can be tricky!
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Main</div>`);
    }
  });

  test("missing window.Elm", async () => {
    (window as unknown as { NotElm: unknown }).NotElm = {};
    onTestFinished(() => {
      delete (window as unknown as { NotElm: unknown }).NotElm;
    });

    const { onlyExpandedRenders, div } = await run({
      fixture: "missing-window-elm",
      args: ["Main"],
      scripts: ["Main.js"],
      init: (node) => {
        expect(window.Elm).toBeUndefined();
        (window as unknown as { NotElm: typeof window }).NotElm.Elm?.[
          "Main"
        ]?.init({ node });
      },
      onIdle: () => {
        expandUi();
        return "Stop";
      },
    });

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
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

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Main</div>`);
  });

  test("Move UI", async () => {
    const { onlyExpandedRenders } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
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

    const newRenders = onlyExpandedRenders
      .split(/\n=+\n/)
      // Focus on just the arrow buttons and status emojis.
      .map((segment) => segment.split("\n").slice(-3).join("\n"))
      .join(`\n${"=".repeat(80)}\n`)
      // Remove duplicate renders in a row.
      .replace(/(=+[^=]+)\1/g, "$1");

    expect(newRenders).toMatchInlineSnapshot(`
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

  test("ctrl+c", async () => {
    const stdin = new CtrlCReadStream();
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      stdin,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => {
        stdin.ctrlC();
        return "KeepGoing";
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Html⧘
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

  test("exit when stdin ends", async () => {
    const stdin = new SilentReadStream();
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      stdin,
      env: {
        [ELM_WATCH_EXIT_ON_STDIN_END]: "",
      },
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => {
        stdin.push(null);
        return "KeepGoing";
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: Html⧘
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

  test("reload trouble with http caching", async () => {
    const { onlyExpandedRenders } = await run({
      fixture: "basic",
      args: ["HttpCaching"],
      scripts: ["HttpCaching.js"],
      simulateHttpCacheOnReload: true,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
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

    const cleanedRenders = onlyExpandedRenders.replace(
      /compiled .+? and/,
      "compiled 10/9/2022, 11:36:01 AM, and",
    );

    expect(cleanedRenders).toMatchInlineSnapshot(`
      target HttpCaching
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
      ◉ Standard
      ◯ Optimize
      ↑↗
      ·→
      ▲ ✅ 13:10:05 HttpCaching
      ================================================================================
      target HttpCaching
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
      ◯ (disabled) Standard
      ◉ (disabled) Optimize 🚀
      ↑↗
      ·→
      ▲ 🚀 ⏳ 13:10:05 HttpCaching
      ================================================================================
      target HttpCaching
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
      ◯ (disabled) Standard
      ◉ (disabled) Optimize 🚀
      ↑↗
      ·→
      ▲ 🚀 ⏳ 13:10:05 HttpCaching
      ================================================================================
      target HttpCaching
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
      updated 2022-02-05 13:10:05
      status Reload trouble
      A while ago I reloaded the page to get new compiled JavaScript.
      But it looks like after the last page reload I got the same JavaScript as before, instead of new stuff!
      The old JavaScript was compiled 10/9/2022, 11:36:01 AM, and so was the JavaScript currently running.
      I currently need to reload the page again, but fear a reload loop if I try.
      Do you have accidental HTTP caching enabled maybe?
      Try hard refreshing the page and see if that helps, and consider disabling HTTP caching during development.
      ▲ 🚀 ❌ 13:10:05 HttpCaching
    `);
  });

  test("elm.json further up than elm-watch.json", async () => {
    const fixture = "elm-json-above-elm-watch-json";
    const elmJsonPath = path.join(FIXTURES_DIR, fixture, "elm.json");

    const { terminal } = await run({
      fixture: path.join(fixture, "example"),
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
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
      ✅ Dependencies
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/elm-json-above-elm-watch-json/elm.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("source-directories further up than elm.json and elm-watch.json", async () => {
    const fixture = "source-directories-above-elm-watch-json";
    const elmFile = path.join(FIXTURES_DIR, fixture, "src", "Answer.elm");

    const { terminal } = await run({
      fixture: path.join(fixture, "app", "example"),
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            touch(elmFile);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123⧙, network:⧘ http://192.168.0.1:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/source-directories-above-elm-watch-json/src/Answer.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  describe("printTimeline", () => {
    function print(
      events: Array<LatestEvent>,
      loggerConfig?: Partial<LoggerConfig>,
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
        events,
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
        file: {
          tag: "AbsolutePath",
          absolutePath: markAsAbsolutePath("/One.elm"),
        },
        affectsAnyTarget: true,
      },
      {
        tag: "WebSocketConnectedNeedingCompilation",
        date: new Date("2022-03-06T00:00:11Z"),
        outputPath: {
          tag: "OutputPath",
          theOutputPath: markAsAbsolutePath("/build/One.js"),
          temporaryOutputPath: markAsAbsolutePath("/elm-stuff/elm-watch/1.js"),
          originalString: "build/One.js",
          targetName: markAsTargetName("One"),
        },
      },
      {
        tag: "WatcherEvent",
        date: new Date("2022-03-06T00:01:23Z"),
        eventName: "removed",
        file: {
          tag: "AbsolutePath",
          absolutePath: markAsAbsolutePath("/Two.elm"),
        },
        affectsAnyTarget: true,
      },
      {
        tag: "WatcherEvent",
        date: new Date("2022-03-06T00:01:24Z"),
        eventName: "added",
        file: {
          tag: "AbsolutePath",
          absolutePath: markAsAbsolutePath("/Three.elm"),
        },
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
        `ℹ️ ⧙23:59:05⧘ ⧙Changed /One.elm⧘`,
      );
    });

    test("2 events", () => {
      expect(print(events.slice(0, 2))).toMatchInlineSnapshot(`
        ℹ️ ⧙23:59:05⧘ ⧙Changed /One.elm⧘
        ℹ️ ⧙00:00:11⧘ ⧙Web socket connected needing compilation of: One⧘
      `);
    });

    test("3 events", () => {
      expect(print(events.slice(0, 3))).toMatchInlineSnapshot(`
        ℹ️ ⧙23:59:05⧘ ⧙Changed /One.elm⧘
        ℹ️ ⧙00:00:11⧘ ⧙Web socket connected needing compilation of: One⧘
        ℹ️ ⧙00:01:23⧘ ⧙Removed /Two.elm⧘
      `);
    });

    test("4 events", () => {
      expect(print(events.slice(0, 4))).toMatchInlineSnapshot(`
        ℹ️ ⧙23:59:05⧘ ⧙Changed /One.elm⧘
        ℹ️ ⧙00:00:11⧘ ⧙Web socket connected needing compilation of: One⧘
        ℹ️ ⧙00:01:23⧘ ⧙Removed /Two.elm⧘
        ℹ️ ⧙00:01:24⧘ ⧙Added /Three.elm⧘
      `);
    });

    test("5 events", () => {
      expect(print(events.slice(0, 5))).toMatchInlineSnapshot(`
        ℹ️ ⧙23:59:05⧘ ⧙Changed /One.elm⧘
        ℹ️ ⧙00:00:11⧘ ⧙Web socket connected needing compilation of: One⧘
        ℹ️ ⧙00:01:23⧘ ⧙Removed /Two.elm⧘
        ℹ️ ⧙00:01:24⧘ ⧙Added /Three.elm⧘
        ℹ️ ⧙00:02:00⧘ ⧙Web socket disconnected for: (no matching target)⧘
      `);
    });

    test("6 events", () => {
      expect(print(events.slice(0, 6))).toMatchInlineSnapshot(`
        ℹ️ ⧙23:59:05⧘ ⧙Changed /One.elm⧘
        ℹ️ ⧙00:00:11⧘ ⧙Web socket connected needing compilation of: One⧘
           (2 more events)
        ℹ️ ⧙00:02:00⧘ ⧙Web socket disconnected for: (no matching target)⧘
        ℹ️ ⧙00:02:59⧘ ⧙Web socket connected with errors (see the browser for details)⧘
      `);
    });

    test("6 events, non-fancy", () => {
      expect(print(events.slice(0, 6), { fancy: false }))
        .toMatchInlineSnapshot(`
          ⧙23:59:05⧘ ⧙Changed /One.elm⧘
          ⧙00:00:11⧘ ⧙Web socket connected needing compilation of: One⧘
          (2 more events)
          ⧙00:02:00⧘ ⧙Web socket disconnected for: (no matching target)⧘
          ⧙00:02:59⧘ ⧙Web socket connected with errors (see the browser for details)⧘
        `);
    });
  });
});
