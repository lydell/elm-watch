// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";
import NodeWebSocket from "ws";

import type { WebSocketToServerMessage } from "../client/WebSocketMessages.ts";
import {
  grep,
  onlyErrorMessages,
  stringSnapshotSerializer,
  wait,
  waitOneFrame,
} from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  expandUi,
  failInit,
  fixtureDir,
  nextMsg,
  run,
  switchCompilationMode,
  waitForElmWatchIdle,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  afterEach(cleanupAfterEachTest);

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

          // oxlint-disable-next-line typescript/no-this-alias
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
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ ParamsDecodeError Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        I ran into trouble parsing the web socket connection URL parameters:

        At root["elmCompiledTimestamp"]:
        Expected a number
        Got: "2021-12-11"

        The URL parameters look like this:

        elmWatchVersion=%25VERSION%25&webSocketToken=37476437-1911-402a-9c87-fd94405770d2&targetName=ParamsDecodeError&elmCompiledTimestamp=2021-12-11

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here.

        Or maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ 🔌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        🔌 ParamsDecodeError Sleeping · 13:10:05
        Attempt 1 failed. Trying again in 1.01 seconds.
        [Reconnect now]
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ 🔌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        🔌 ParamsDecodeError Connecting · 13:10:05
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ ⏳
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ⏳ ParamsDecodeError Waiting for compilation · 13:10:05
        Compilation mode for ParamsDecodeError
        ◯ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        The Elm debugger isn't available at this point.
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ ParamsDecodeError Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        I ran into trouble parsing the web socket connection URL parameters:

        At root["elmCompiledTimestamp"]:
        Expected a number
        Got: "2021-12-11"

        The URL parameters look like this:

        elmWatchVersion=%25VERSION%25&webSocketToken=37476437-1911-402a-9c87-fd94405770d2&targetName=ParamsDecodeError&elmCompiledTimestamp=2021-12-11

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here.

        Or maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        Drag emoji or press shift+arrows to move
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
          let received = 0;
          const allReceived = nextMsg(
            (msg) => msg.tag === "WebSocketMessageReceived" && ++received === 2,
          );
          send({
            tag: "ChangedCompilationMode",
            compilationMode: "optimize",
          });
          send({ tag: "FocusedTab" });
          // Wait for the above messages to be processed before stopping (needed
          // for code coverage).
          await allReceived;
          await waitForElmWatchIdle();
          return "Stop" as const;
        },
      });

      expect(onlyExpandedRenders).toMatchInlineSnapshot(`
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ WrongVersion Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it was compiled with:

        elm-watch 0.0.0

        But the server is:

        elm-watch %VERSION%

        Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        Drag emoji or press shift+arrows to move
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
        🌐 http://localhost:59123

        ✅ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Html +1 more⧘
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

    test("host or origin not allowed", async () => {
      let webSocketUrl: string | undefined = undefined;
      modifyUrl((url) => {
        webSocketUrl = url.href;
      });

      const { terminal } = await run({
        fixture: "basic",
        args: ["HostOrOriginNotAllowed"],
        scripts: ["HostOrOriginNotAllowed.js"],
        isTTY: false,
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: async () => {
          if (webSocketUrl === undefined) {
            throw new Error("Expected webSocketUrl to be set.");
          }
          for (const headers of [
            { Host: "evil.com:1234" },
            { Host: "evil.com/" },
            { Origin: "https://evil.com" },
            { Origin: "not a url" },
          ]) {
            await connectRejectedNodeWebSocket(webSocketUrl, headers);
          }
          return "Stop" as const;
        },
      });

      expect(grep(terminal, /rejected/)).toMatchInlineSnapshot(`
        ℹ️ ⧙13:10:05⧘ ⧙Web socket connection from unknown origin rejected due to: Host header not allowed – add "evil.com" to allowedHosts (see https://lydell.github.io/elm-watch/server/#allowed-hosts)⧘
        ℹ️ ⧙13:10:05⧘ ⧙Web socket connection from unknown origin rejected due to: invalid Host header: "evil.com/"⧘
        ℹ️ ⧙13:10:05⧘ ⧙Web socket connection from "https://evil.com" rejected due to: origin not allowed – add "evil.com" to allowedHosts (see https://lydell.github.io/elm-watch/server/#allowed-hosts)⧘
        ℹ️ ⧙13:10:05⧘ ⧙Web socket connection from "not a url" rejected due to: invalid origin: "not a url"⧘
      `);
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
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ Enabled1 Unexpected error · 13:10:05
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
        Drag emoji or press shift+arrows to move
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
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ Main Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        nope

        But I can't find that target in elm-watch.json!

        These targets are available in elm-watch.json:

        Main

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        If so, try reloading the page.
        Drag emoji or press shift+arrows to move
      `);
    });

    test("target not found (elm-watch options)", async () => {
      modifyUrl((url) => {
        url.searchParams.set("targetName", "nope");
      });

      const { onlyExpandedRenders } = await run({
        fixture: "single",
        args: ["Main"],
        scripts: ["Main.js"],
        useElmWatchFunction: true,
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(onlyExpandedRenders).toMatchInlineSnapshot(`
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ Main Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        nope

        But I can't find that target in the elm-watch options!

        These targets are available in the elm-watch options:

        Main

        Maybe this target used to exist in the elm-watch options, but you removed or changed it?
        If so, try reloading the page.
        Drag emoji or press shift+arrows to move
      `);
    });

    test("change target name", async () => {
      const fixture = "change-target-name";
      const dir = fixtureDir(fixture);
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
        ▼ 🔌
        ================================================================================
        ▼ ⏳
        ================================================================================
        ▼ 🔌
        ================================================================================
        ▼ ⏳
        ================================================================================
        ▼ ✅
        ================================================================================
        ▼ ⏳
        ================================================================================
        ▼ 🔌
        ================================================================================
        ▼ ⏳
        ================================================================================
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ Main Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        Main

        But I can't find that target in elm-watch.json!

        These targets are available in elm-watch.json:

        Renamed

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        If so, try reloading the page.
        Drag emoji or press shift+arrows to move
        ================================================================================
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
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ TargetDisabled Unexpected error · 13:10:05
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
        HostOrOriginNotAllowed
        SendBadJson
        Reconnect
        HttpCaching
        "Esc\\apes"

        If you want to have this target compiled, restart elm-watch either with more CLI arguments or no CLI arguments at all!
        Drag emoji or press shift+arrows to move
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
        ▲ ✅
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ✅ SendBadJson Successfully compiled · 13:10:05
        Compilation mode for SendBadJson
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't supported by \`Html\` programs.
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ ⏳🚀
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ⏳ SendBadJson Waiting for compilation · 13:10:05
        Compilation mode for SendBadJson
        ◯ (disabled) Debug
        ◯ (disabled) Standard
        ◉ (disabled) Optimize
        The Elm debugger isn't supported by \`Html\` programs.
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ ❌🚀
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ SendBadJson Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["tag"]:
        Expected one of these tags:
         "ChangedCompilationMode",
         "FocusedTab",
         "PressedOpenEditor"
        Got: "Nope"

        The web socket code I generate is supposed to always send correct messages, so something is up here.
        Drag emoji or press shift+arrows to move
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
        ▼ 🔌
        ================================================================================
        ▲ 🔌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        🔌 Reconnect Connecting · 13:10:05
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ 🔌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        🔌 Reconnect Sleeping · 13:10:05
        Attempt 2 failed. Trying again in 1.04 seconds.
        [Reconnect now]
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ 🔌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        🔌 Reconnect Connecting · 13:10:05
        Attempt 2.
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ 🔌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        🔌 Reconnect Sleeping · 13:10:05
        Attempt 3 failed. Trying again in 1.09 seconds.
        [Reconnect now]
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ 🔌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        🔌 Reconnect Connecting · 13:10:05
        Attempt 3.
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ ⏳
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ⏳ Reconnect Waiting for compilation · 13:10:05
        Compilation mode for Reconnect
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
        ⏳ Reconnect Waiting for compilation · 13:10:05
        Compilation mode for Reconnect
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
        🔌 Reconnect Connecting · 13:10:05
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ ⏳
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ⏳ Reconnect Waiting for compilation · 13:10:05
        Compilation mode for Reconnect
        ◯ (disabled) Debug
        ◉ (disabled) Standard
        ◯ (disabled) Optimize
        The Elm debugger isn't supported by \`Html\` programs.
        Drag emoji or press shift+arrows to move
        ================================================================================
        ▲ ✅
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ✅ Reconnect Successfully compiled · 13:10:05
        Compilation mode for Reconnect
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't supported by \`Html\` programs.
        Drag emoji or press shift+arrows to move
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
        🌐 http://localhost:59123

        ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Html +1 more⧘
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
    });
  });

  describe("web socket lifecycle", () => {
    const originalWebSocket = WebSocket;
    // oxlint-disable-next-line no-console
    const originalConsoleError = console.error;
    let webSockets: Array<WebSocket> = [];
    let sentMessages: Array<string> = [];
    let consoleErrors: Array<string> = [];

    afterEach(() => {
      window.WebSocket = originalWebSocket;
      // oxlint-disable-next-line no-console
      console.error = originalConsoleError;
      webSockets = [];
      sentMessages = [];
      consoleErrors = [];
    });

    function setupTestWebSocket({
      failConnectionIndex,
    }: { failConnectionIndex?: number } = {}): void {
      class TestWebSocket extends WebSocket {
        constructor(url: URL | string) {
          const actualUrl = new URL(url);
          if (webSockets.length === failConnectionIndex) {
            actualUrl.port = "65252"; // Hopefully unused port.
          }
          super(actualUrl);
          webSockets.push(this);
        }

        override send(message: string): void {
          sentMessages.push(message);
          super.send(message);
        }
      }

      window.WebSocket = TestWebSocket;

      // oxlint-disable-next-line no-console
      console.error = (...args: Array<unknown>) => {
        // For example “elm-watch: Failed to send WebSocket message”.
        consoleErrors.push(args.map(String).join(" "));
      };
    }

    function getLastWebSocket(): WebSocket {
      const webSocket = webSockets.at(-1);
      if (webSocket === undefined) {
        throw new Error("No WebSocket!");
      }
      return webSocket;
    }

    async function closeAndWait(webSocket: WebSocket): Promise<void> {
      await new Promise((resolve) => {
        webSocket.addEventListener("close", resolve, { once: true });
        webSocket.close();
      });
    }

    function focus(): void {
      window.dispatchEvent(new CustomEvent("focus", { detail: "Reconnect" }));
    }

    test("window listeners work even if the first connection failed", async () => {
      // The page is reloaded once after the first compilation (index 0). Fail
      // the first connection after that reload.
      setupTestWebSocket({ failConnectionIndex: 1 });

      await run({
        fixture: "basic",
        args: ["Reconnect"],
        scripts: ["Reconnect.js"],
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: async () => {
          const acknowledged = new Promise((resolve) => {
            getLastWebSocket().addEventListener("message", resolve, {
              once: true,
            });
          });
          focus();
          // Don’t wait forever if `FocusedTab` was never sent.
          await Promise.race([acknowledged, wait(1000)]);
          return "Stop" as const;
        },
      });

      // Connection before page reload + failed connection + reconnection.
      expect(webSockets).toHaveLength(3);
      expect(sentMessages).toStrictEqual([
        JSON.stringify({ tag: "FocusedTab" }),
      ]);
      expect(consoleErrors).toStrictEqual([]);
    });

    test("events from previous web sockets are ignored", async () => {
      setupTestWebSocket();
      let oldWebSocket: WebSocket | undefined = undefined;
      let numWebSocketsBefore = 0;

      const { renders } = await run({
        fixture: "basic",
        args: ["Reconnect"],
        scripts: ["Reconnect.js"],
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: async ({ idle }) => {
          switch (idle) {
            case 1:
              oldWebSocket = getLastWebSocket();
              numWebSocketsBefore = webSockets.length;
              await closeAndWait(oldWebSocket);
              return "KeepGoing";
            default:
              if (oldWebSocket === undefined) {
                throw new Error("Expected an old WebSocket!");
              }
              // Simulate late events from the previous, closed, web socket.
              // They used to make the client reconnect again (leaving the
              // current web socket open) and handle messages twice.
              oldWebSocket.dispatchEvent(
                new MessageEvent("message", { data: "not json" }),
              );
              oldWebSocket.dispatchEvent(new Event("error"));
              oldWebSocket.dispatchEvent(new Event("close"));
              // The client handles these right away. Give it a frame to render.
              await waitOneFrame();
              return "Stop";
          }
        },
      });

      expect(webSockets).toHaveLength(numWebSocketsBefore + 1);
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
        ================================================================================
        ▼ 🔌
        ================================================================================
        ▼ ⏳
        ================================================================================
        ▼ ✅
      `);
    });

    test("focus while connecting does not close the new connection", async () => {
      setupTestWebSocket();
      let numWebSocketsBefore = 0;

      const { renders } = await run({
        fixture: "basic",
        args: ["Reconnect"],
        scripts: ["Reconnect.js"],
        init: (node) => {
          window.Elm?.["HtmlMain"]?.init({ node });
        },
        onIdle: async ({ idle }) => {
          switch (idle) {
            case 1:
              numWebSocketsBefore = webSockets.length;
              // Like on iOS: The web socket closes while the phone is locked.
              await closeAndWait(getLastWebSocket());
              // When unlocking, "visibilitychange" triggers an immediate
              // reconnect, quickly followed by "focus".
              window.dispatchEvent(new Event("visibilitychange"));
              focus();
              return "KeepGoing";
            default:
              // The new web socket used to be closed due to a missing
              // `FocusedTabAcknowledged`. That timeout only starts when
              // `FocusedTab` is sent, which `sentMessages` below checks.
              return "Stop";
          }
        },
      });

      expect(webSockets).toHaveLength(numWebSocketsBefore + 1);
      expect(sentMessages).toStrictEqual([]);
      expect(consoleErrors).toStrictEqual([]);
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
        ================================================================================
        ▼ 🔌
        ================================================================================
        ▼ ⏳
        ================================================================================
        ▼ ✅
      `);
    });
  });
});

async function connectRejectedNodeWebSocket(
  url: string,
  headers: Record<string, string>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const webSocket = new NodeWebSocket(url, { headers });
    webSocket.on("open", () => {
      webSocket.close();
      reject(new Error(`Expected the connection to be rejected: ${url}`));
    });
    webSocket.on("unexpected-response", () => {
      resolve();
    });
    webSocket.on("error", reject);
  });
}
