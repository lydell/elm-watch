// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { afterEach, describe, expect, test } from "vitest";

import { WebSocketToServerMessage } from "../client/WebSocketMessages.ts";
import {
  __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS,
  ELM_WATCH_OPEN_EDITOR,
  type Env,
  NO_COLOR,
} from "../src/Env.ts";
import { IS_WINDOWS } from "../src/IsWindows.ts";
import { markAsAbsolutePath } from "../src/Types.ts";
import {
  clean,
  grep,
  onlyErrorMessages,
  rm,
  stringSnapshotSerializer,
  waitFor,
} from "./Helpers.ts";
import {
  assertDebugger,
  cleanupAfterEachTest,
  clickFirstErrorLocation,
  expandUi,
  fixtureDir,
  getOverlay,
  run,
  switchCompilationMode,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  afterEach(cleanupAfterEachTest);

  test("persisted compilation mode", async () => {
    const { lastRender } = await run({
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

    expect(lastRender).toMatchInlineSnapshot(`▼ ✅`);
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
      Main: 1 error
      http://localhost:59123

      -- TYPE MISMATCH ---------------------------------------------------------------
      /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31

      I am struggling with this boolean operation:

      10|     , view = \\_ -> if True && 5 then Html.text "yes" else Html.text "no"
                                        ^
      Both sides of (&&) must be Bool values, but the right side is:

          number

      Hint: Only Int and Float values work as numbers.

      13:10:05 Up to date   web socket connected: Main
      error 1/1
      [←→] error   [↑↓] file   [enter] open in editor   [a] show all
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
      bin: "exit-2-in-optimize",
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
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

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
      ⧙Target: Main⧘

      I ran the following commands:

      cd /Users/you/project/tests/fixtures/hot/error-overlay-bold-and-dim
      elm make --report=json --optimize --output=elm-stuff/elm-watch/0.js src/Main.elm

      I expected it to either exit 0 with no output (success),
      or exit 1 with JSON on stderr (compile errors).

      ⧙But it exited like this:⧘

      exit 2
      ⧙(no output)⧘
    `);

    expect(getOverlay()).toMatchInlineSnapshot(`
      <overlay visible style="background-color: rgb(32, 30, 30);">
      <details open="" id="0" data-target-names="Main" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
      <summary><span style="background-color: rgb(32, 30, 30);">UNEXPECTED ELM OUTPUT</span><p>Target: Main</p></summary>
      <pre>I ran the following commands:

      cd /Users/you/project/tests/fixtures/hot/error-overlay-bold-and-dim
      elm make --report=json --optimize --output=elm-stuff/elm-watch/0.js src/Main.elm

      I expected it to either exit 0 with no output (success),
      or exit 1 with JSON on stderr (compile errors).

      <b>But it exited like this:</b>

      exit 2
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
      useElmWatchFunction = false,
      modifyPressedOpenEditor = (message) => message,
    }: {
      env: Env;
      useElmWatchFunction?: boolean | Record<string, unknown>;
      modifyPressedOpenEditor?: (
        message: Extract<
          WebSocketToServerMessage,
          { tag: "PressedOpenEditor" }
        >,
      ) => Extract<WebSocketToServerMessage, { tag: "PressedOpenEditor" }>;
    }): Promise<string> => {
      class TestWebSocket extends WebSocket {
        override send(data: Parameters<WebSocket["send"]>[0]): void {
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
        useElmWatchFunction,
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
        ▲ 🚨
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Hide errors]
        [Close elm-watch]
        🚨 Main Compilation error · 13:10:05
        Compilation mode for Main
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't available at this point.
        ℹ️ Clicking error locations only works if you set it up.
        Check this out: [Clickable error locations](https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations)
        Drag emoji or press shift+arrows to move
      `);
    });

    test("env var is ignored with elm-watch options", async () => {
      const renders = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: "true",
        },
        useElmWatchFunction: true,
      });
      expect(renders).toMatchInlineSnapshot(`
        ▲ 🚨
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Hide errors]
        [Close elm-watch]
        🚨 Main Compilation error · 13:10:05
        Compilation mode for Main
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't available at this point.
        ℹ️ Clicking error locations only works if you set it up.
        Check this out: [Clickable error locations](https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations)
        Drag emoji or press shift+arrows to move
      `);
    });

    test("openEditor function throws", async () => {
      const renders = await runFailClickErrorLocation({
        env: {},
        useElmWatchFunction: {
          openEditor: () => {
            // oxlint-disable-next-line typescript/only-throw-error
            throw "Editor not found";
          },
        },
      });
      expect(renders).toMatchInlineSnapshot(`
        ▲ 🚨
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Hide errors]
        [Close elm-watch]
        🚨 Main Compilation error · 13:10:05
        Compilation mode for Main
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't available at this point.
        Opening the location in your editor failed!
        I called your openEditor function with:

        {
         "file": "/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm",
         "line": 10,
         "column": 31
        }

        It threw an error:

        "Editor not found"
        Drag emoji or press shift+arrows to move
      `);
    });

    test("openEditor function rejects", async () => {
      const renders = await runFailClickErrorLocation({
        env: {},
        useElmWatchFunction: {
          openEditor: async () => {
            await Promise.resolve();
            // oxlint-disable-next-line typescript/only-throw-error
            throw "Async editor not found";
          },
        },
      });
      expect(grep(renders, /Async editor not found/)).toMatchInlineSnapshot(
        `"Async editor not found"`,
      );
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
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ Main Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["line"]:
        Expected a non-negative integer
        Got: -1

        The web socket code I generate is supposed to always send correct messages, so something is up here.
        Drag emoji or press shift+arrows to move
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
        ▲ ❌
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Close elm-watch]
        ❌ Main Unexpected error · 13:10:05
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["column"]:
        Expected a non-negative integer
        Got: 5.8

        The web socket code I generate is supposed to always send correct messages, so something is up here.
        Drag emoji or press shift+arrows to move
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
        ▲ 🚨
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Hide errors]
        [Close elm-watch]
        🚨 Main Compilation error · 13:10:05
        Compilation mode for Main
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't available at this point.
        Opening the location in your editor failed!
        I received a command to open the following file in your editor:

        ; echo hacked #

        However, no target imports that file. For security reasons, I never executed any command with that file.
        Drag emoji or press shift+arrows to move
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
        ▲ 🚨
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Hide errors]
        [Close elm-watch]
        🚨 Main Compilation error · 13:10:05
        Compilation mode for Main
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't available at this point.
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
        Drag emoji or press shift+arrows to move
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
        ▲ 🚨
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Hide errors]
        [Close elm-watch]
        🚨 Main Compilation error · 13:10:05
        Compilation mode for Main
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't available at this point.
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
        Drag emoji or press shift+arrows to move
      `);
    });

    test("exit 1", async () => {
      const renders = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: `node -e "process.exit(1)"`,
        },
      });
      expect(renders).toMatchInlineSnapshot(`
        ▲ 🚨
        --------------------------------------------------------------------------------
        elm-watch %VERSION%
        [Hide errors]
        [Close elm-watch]
        🚨 Main Compilation error · 13:10:05
        Compilation mode for Main
        ◯ (disabled) Debug
        ◉ Standard
        ◯ Optimize
        The Elm debugger isn't available at this point.
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
        Drag emoji or press shift+arrows to move
      `);
    });

    test("successful execution", async () => {
      const outputFile = path.join(
        fixtureDir(fixture),
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
          await waitFor(() => fs.existsSync(outputFile));
          return "Stop" as const;
        },
      });

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌
        ================================================================================
        ▼ ⏳
        ================================================================================
        ▼ 🚨
      `);
      expect(clean(fs.readFileSync(outputFile, "utf-8"))).toMatchInlineSnapshot(
        `/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31`,
      );
    });
  });

  test("openEditor function", async () => {
    const fixture = "persisted-open-error-overlay";
    const calls: Array<unknown> = [];

    const { renders } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      useElmWatchFunction: {
        openEditor: (location: unknown) => {
          calls.push(location);
        },
      },
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: async () => {
        clickFirstErrorLocation();
        await waitFor(() => calls.length > 0);
        return "Stop" as const;
      },
    });

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌
      ================================================================================
      ▼ ⏳
      ================================================================================
      ▼ 🚨
    `);
    expect(clean(JSON.stringify(calls))).toMatchInlineSnapshot(
      `[{"file":"/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm","line":10,"column":31}]`,
    );
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
      ▲ ✅
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ✅ Main Successfully compiled · 13:10:05
      Compilation mode for Main
      ◉ (disabled) Debug
      ◯ Standard
      ◯ Optimize
      The Elm debugger isn't supported by \`Html\` programs.
      Drag emoji or press shift+arrows to move
    `);
  });
});
