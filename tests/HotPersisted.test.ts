// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
  clickUiButton,
  expandUi,
  fixtureDir,
  getOverlay,
  pressOverlayKey,
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
      ⧙── TYPE MISMATCH ──────────────────────────────────────────── ⧘src/Main.elm⧙:10:31⧘

      I am struggling with this boolean operation:

      10|     , view = \\_ -> if True && 5 then Html.text "yes" else Html.text "no"
                                        ⧙^⧘
      Both sides of (&&) must be ⧙Bool⧘ values, but the right side is:

          ⧙number⧘

      ⧙Hint⧘: Only ⧙Int⧘ and ⧙Float⧘ values work as numbers.

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
    `);

    expect(getOverlay()).toMatchInlineSnapshot(`
      <overlay visible>
      <div id="0"><div><h2>TYPE MISMATCH</h2><span></span><span><button>src/Main.elm<span>:10:31</span></button></span></div>
      <pre>I am struggling with this boolean operation:

      10|     , view = \\_ -&gt; if True &amp;&amp; 5 then Html.text "yes" else Html.text "no"
                                        <span style="color: rgb(241, 76, 76)">^</span>
      Both sides of (&amp;&amp;) must be <span style="color: rgb(229, 229, 16)">Bool</span> values, but the right side is:

          <span style="color: rgb(229, 229, 16)">number</span>

      <u>Hint</u>: Only <span style="color: rgb(35, 209, 139)">Int</span> and <span style="color: rgb(35, 209, 139)">Float</span> values work as numbers.</pre></div>
      --------------------------------------------------------------------------------
      <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [a] show all | [esc] close (again to reopen)</footer>
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
        [NO_COLOR]: "1",
      },
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      Main: 1 error                                                765 ms T /  50 ms W
      http://localhost:59123

      ── TYPE MISMATCH ──────────────────────────────────────────── src/Main.elm:10:31

      I am struggling with this boolean operation:

      10|     , view = \\_ -> if True && 5 then Html.text "yes" else Html.text "no"
                                        ^
      Both sides of (&&) must be Bool values, but the right side is:

          number

      Hint: Only Int and Float values work as numbers.

      13:10:05 Up to date   web socket connected: Main

      error 1/1  [←→] error   [↑↓] file   [enter] open in editor   [a] show all
    `);

    expect(getOverlay()).toMatchInlineSnapshot(`
      <overlay visible>
      <div id="0"><div><h2>TYPE MISMATCH</h2><span></span><span><button>src/Main.elm<span>:10:31</span></button></span></div>
      <pre>I am struggling with this boolean operation:

      10|     , view = \\_ -&gt; if True &amp;&amp; 5 then Html.text "yes" else Html.text "no"
                                        ^
      Both sides of (&amp;&amp;) must be Bool values, but the right side is:

          number

      Hint: Only Int and Float values work as numbers.</pre></div>
      --------------------------------------------------------------------------------
      <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [a] show all | [esc] close (again to reopen)</footer>
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
      ⧙── UNEXPECTED ELM OUTPUT ────────────────────────────────────────── ⧘⧙Target: Main⧘

      I ran the following commands:

      cd /Users/you/project/tests/fixtures/hot/error-overlay-bold-and-dim
      elm make --report=json --optimize --output=elm-stuff/elm-watch/0.js src/Main.elm

      I expected it to either exit 0 with no output (success),
      or exit 1 with JSON on stderr (compile errors).

      ⧙But it exited like this:⧘

      exit 2
      ⧙(no output)⧘

      ℹ️ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙compilation mode "optimize": Main⧘
    `);

    expect(getOverlay()).toMatchInlineSnapshot(`
      <overlay visible>
      <div id="0"><div><h2>UNEXPECTED ELM OUTPUT</h2><span></span><span><span>Target: Main</span></span></div>
      <pre>I ran the following commands:

      cd /Users/you/project/tests/fixtures/hot/error-overlay-bold-and-dim
      elm make --report=json --optimize --output=elm-stuff/elm-watch/0.js src/Main.elm

      I expected it to either exit 0 with no output (success),
      or exit 1 with JSON on stderr (compile errors).

      <b>But it exited like this:</b>

      exit 2
      <span style="opacity: 0.6">(no output)</span></pre></div>
      --------------------------------------------------------------------------------
      <footer>🚨 error 1/1 | [__] error | [__] file | [a] show all | [esc] close (again to reopen)</footer>
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
    }): Promise<{ renders: string; notice: string }> => {
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
      return {
        renders: onlyExpandedRenders === "" ? renders : onlyExpandedRenders,
        // Open editor failures are shown in the error overlay, where the
        // location was clicked.
        notice:
          /<notice>[^]*<\/notice>/.exec(getOverlay())?.[0] ?? "(no notice)",
      };
    };

    describe("choose editor in the browser", () => {
      const openedUrls: Array<string> = [];

      beforeEach(() => {
        openedUrls.length = 0;
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
          function (this: HTMLAnchorElement) {
            openedUrls.push(clean(this.href));
          },
        );
      });

      afterEach(() => {
        vi.restoreAllMocks();
      });

      const stuffJsonPath = (): string =>
        path.join(fixtureDir(fixture), "elm-stuff", "elm-watch", "stuff.json");

      const readChosenEditor = (): unknown =>
        (
          JSON.parse(fs.readFileSync(stuffJsonPath(), "utf8")) as {
            editor?: unknown;
          }
        ).editor;

      const writeChosenEditor = (editor: string): void => {
        const json = JSON.parse(
          fs.readFileSync(stuffJsonPath(), "utf8"),
        ) as Record<string, unknown>;
        fs.writeFileSync(stuffJsonPath(), JSON.stringify({ ...json, editor }));
      };

      test("env var not set: choose a preset", async () => {
        let chooser = "";
        let other = "";

        await run({
          fixture,
          args: [],
          scripts: ["Main.js"],
          keepElmStuffJson: true,
          env: {},
          init: (node) => {
            window.Elm?.["Main"]?.init({ node });
          },
          onIdle: async () => {
            clickFirstErrorLocation();
            chooser = getOverlay();
            clickUiButton("[6] Other");
            other = /<chooser>[^]*<\/chooser>/.exec(getOverlay())?.[0] ?? "";
            clickUiButton("[1] VS Code");
            await waitFor(() => readChosenEditor() === "vscode");
            return "Stop" as const;
          },
        });

        expect(chooser).toMatchInlineSnapshot(`
          <overlay visible>
          <div id="0"><div><h2>TYPE MISMATCH</h2><span></span><span><button>src/Main.elm<span>:10:31</span></button></span></div>
          <pre>I am struggling with this boolean operation:

          10|     , view = \\_ -&gt; if True &amp;&amp; 5 then Html.text "yes" else Html.text "no"
                                            <span style="color: rgb(241, 76, 76)">^</span>
          Both sides of (&amp;&amp;) must be <span style="color: rgb(229, 229, 16)">Bool</span> values, but the right side is:

              <span style="color: rgb(229, 229, 16)">number</span>

          <u>Hint</u>: Only <span style="color: rgb(35, 209, 139)">Int</span> and <span style="color: rgb(35, 209, 139)">Float</span> values work as numbers.</pre></div>
          --------------------------------------------------------------------------------
          <chooser>
          Which editor should I open this in?
          [[1] VS Code]
          [[2] Cursor]
          [[3] Zed]
          [[4] IntelliJ IDEA]
          [[5] WebStorm]
          [[6] Other]
          </chooser>
          --------------------------------------------------------------------------------
          <footer>🚨 error 1/1 | [esc] cancel</footer>
          </overlay>
        `);
        expect(other).toMatchInlineSnapshot(`
          <chooser>
          Which editor should I open this in?
          [[1] VS Code]
          [[2] Cursor]
          [[3] Zed]
          [[4] IntelliJ IDEA]
          [[5] WebStorm]
          [[6] Other]
          To use another editor, set the ELM_WATCH_OPEN_EDITOR environment variable. The easiest way to get started is to run:
          elm-watch editor
          </chooser>
        `);
        expect(openedUrls).toMatchInlineSnapshot(`
          [
            vscode://file/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31,
          ]
        `);
        expect(grep(getOverlay(), /footer/)).toMatchInlineSnapshot(
          `<footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in VS Code | [e] change editor | [a] show all | [esc] close (again to reopen)</footer>`,
        );
      });

      test("keyboard: enter, number, e, a and escape", async () => {
        const footers: Array<string> = [];

        await run({
          fixture,
          args: [],
          scripts: ["Main.js"],
          keepElmStuffJson: true,
          env: {},
          init: (node) => {
            window.Elm?.["Main"]?.init({ node });
          },
          onIdle: async () => {
            // “e” is not offered before choosing an editor.
            pressOverlayKey("e");
            footers.push(grep(getOverlay(), /footer|chooser/));
            pressOverlayKey("Enter");
            footers.push(grep(getOverlay(), /footer/));
            pressOverlayKey("Escape");
            footers.push(grep(getOverlay(), /footer|chooser/));
            pressOverlayKey("Enter");
            pressOverlayKey("5");
            await waitFor(() => readChosenEditor() === "webstorm");
            footers.push(grep(getOverlay(), /footer/));
            pressOverlayKey("e");
            footers.push(grep(getOverlay(), /pressed|footer/));
            pressOverlayKey("6");
            footers.push(grep(getOverlay(), /Other|another editor|footer/));
            // The presets can still be chosen after showing “Other”.
            pressOverlayKey("1");
            await waitFor(() => readChosenEditor() === "vscode");
            // “e” works when showing all errors, too.
            pressOverlayKey("a");
            footers.push(grep(getOverlay(), /footer/));
            pressOverlayKey("e");
            footers.push(grep(getOverlay(), /Open error locations|footer/));
            return "Stop" as const;
          },
        });

        expect(footers.join("\n")).toMatchInlineSnapshot(`
          <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [a] show all | [esc] close (again to reopen)</footer>
          <footer>🚨 error 1/1 | [esc] cancel</footer>
          <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [a] show all | [esc] close (again to reopen)</footer>
          <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in WebStorm | [e] change editor | [a] show all | [esc] close (again to reopen)</footer>
          [[5] WebStorm] (pressed)
          <footer>🚨 error 1/1 | [esc] cancel</footer>
          [[6] Other]
          To use another editor, set the ELM_WATCH_OPEN_EDITOR environment variable. The easiest way to get started is to run:
          <footer>🚨 error 1/1 | [esc] cancel</footer>
          <footer>🚨 1 error | [e] change editor | [a] show one error at a time | [esc] close (again to reopen)</footer>
          Open error locations in:
          <footer>🚨 1 error | [esc] cancel</footer>
        `);
        expect(openedUrls).toMatchInlineSnapshot(`
          [
            webstorm://open?file=/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm&line=10&column=30,
            vscode://file/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31,
          ]
        `);
      });

      test("env var set to a URL, and switching to a preset and back", async () => {
        const overlays: Array<string> = [];
        const chosen: Array<unknown> = [];

        await run({
          fixture,
          args: [],
          scripts: ["Main.js"],
          keepElmStuffJson: true,
          env: {
            [ELM_WATCH_OPEN_EDITOR]:
              "myeditor://open?file={file}&line={line0}&column={column0}",
          },
          init: (node) => {
            window.Elm?.["Main"]?.init({ node });
          },
          onIdle: async () => {
            // The env var is used without asking.
            clickFirstErrorLocation();
            overlays.push(grep(getOverlay(), /footer/));
            // But you can switch to a preset for this project.
            pressOverlayKey("e");
            overlays.push(grep(getOverlay(), /pressed|ELM_WATCH|footer/));
            pressOverlayKey("2");
            await waitFor(() => readChosenEditor() === "cursor");
            chosen.push(readChosenEditor());
            overlays.push(grep(getOverlay(), /footer/));
            // And back to the env var.
            pressOverlayKey("e");
            overlays.push(grep(getOverlay(), /pressed|ELM_WATCH/));
            pressOverlayKey("6");
            await waitFor(() => readChosenEditor() === undefined);
            chosen.push(readChosenEditor());
            return "Stop" as const;
          },
        });

        expect(overlays.join("\n")).toMatchInlineSnapshot(`
          <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [e] change editor | [a] show all | [esc] close (again to reopen)</footer>
          [[6] ELM_WATCH_OPEN_EDITOR] (pressed)
          <footer>🚨 error 1/1 | [esc] cancel</footer>
          <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in Cursor | [e] change editor | [a] show all | [esc] close (again to reopen)</footer>
          [[2] Cursor] (pressed)
          [[6] ELM_WATCH_OPEN_EDITOR]
        `);
        expect(chosen).toStrictEqual(["cursor", undefined]);
        expect(openedUrls).toMatchInlineSnapshot(`
          [
            myeditor://open?file=/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm&line=9&column=30,
            cursor://file/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:10:31,
            myeditor://open?file=/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm&line=9&column=30,
          ]
        `);
      });

      test("env var set to an invalid URL", async () => {
        const { notice } = await runFailClickErrorLocation({
          env: { [ELM_WATCH_OPEN_EDITOR]: "myeditor://open?line={line}" },
        });
        expect(openedUrls).toEqual([]);
        expect(grep(notice, /URL|placeholders/)).toMatchInlineSnapshot(`
          Your ELM_WATCH_OPEN_EDITOR environment variable looks like a URL:
          But it is not a valid URL for opening an editor: The URL must contain {file}.
          These placeholders are replaced: {file} {line} {column} {line0} {column0}
        `);
      });

      test("custom URL in stuff.json (from an earlier version) is ignored", async () => {
        fixtureDir(fixture);
        writeChosenEditor("myeditor://open?file={file}");
        let chooser = "";

        await run({
          fixture,
          args: [],
          scripts: ["Main.js"],
          keepElmStuffJson: true,
          env: {},
          init: (node) => {
            window.Elm?.["Main"]?.init({ node });
          },
          onIdle: () => {
            clickFirstErrorLocation();
            chooser = getOverlay();
            return "Stop" as const;
          },
        });

        expect(openedUrls).toEqual([]);
        expect(grep(chooser, /Which editor/)).toMatchInlineSnapshot(
          `Which editor should I open this in?`,
        );
      });

      test("editor from stuff.json", async () => {
        fixtureDir(fixture);
        writeChosenEditor("webstorm");
        let overlay = "";

        await run({
          fixture,
          args: [],
          scripts: ["Main.js"],
          keepElmStuffJson: true,
          env: {},
          init: (node) => {
            window.Elm?.["Main"]?.init({ node });
          },
          onIdle: () => {
            clickFirstErrorLocation();
            overlay = getOverlay();
            return "Stop" as const;
          },
        });

        expect(openedUrls).toMatchInlineSnapshot(`
          [
            webstorm://open?file=/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm&line=10&column=30,
          ]
        `);
        expect(grep(overlay, /footer|chooser/)).toMatchInlineSnapshot(
          `<footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in WebStorm | [e] change editor | [a] show all | [esc] close (again to reopen)</footer>`,
        );
      });

      test("env var works with elm-watch options too", async () => {
        await run({
          fixture,
          args: [],
          scripts: ["Main.js"],
          keepElmStuffJson: true,
          env: {
            [ELM_WATCH_OPEN_EDITOR]: "myeditor://open?file={file}",
          },
          useElmWatchFunction: true,
          init: (node) => {
            window.Elm?.["Main"]?.init({ node });
          },
          onIdle: () => {
            clickFirstErrorLocation();
            return "Stop" as const;
          },
        });

        expect(openedUrls).toMatchInlineSnapshot(`
          [
            myeditor://open?file=/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm,
          ]
        `);
      });
    });

    test("invalid line number", async () => {
      const { renders } = await runFailClickErrorLocation({
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
      const { renders } = await runFailClickErrorLocation({
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
      const { notice } = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: "true",
        },
        modifyPressedOpenEditor: (message) => ({
          ...message,
          file: markAsAbsolutePath("; echo hacked #"),
        }),
      });
      expect(notice).toMatchInlineSnapshot(`
        <notice>
        Opening the location in your editor failed!
        I received a command to open the following file in your editor:

        ; echo hacked #

        However, no target imports that file. For security reasons, I never executed any command with that file.
        </notice>
      `);
    });

    test("unknown command", async () => {
      const { notice } = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: "nope",
        },
      });

      const replacement = "nope: command not found";

      const cleanedNotice = notice
        // macOS
        .replace("/bin/sh: nope: command not found", replacement)
        // Linux
        .replace("/bin/sh: 1: nope: not found", replacement)
        // Windows
        .replace(
          /'nope' is not recognized as an internal or external command,\r?\noperable program or batch file\./,
          replacement,
        )
        .replace("code 1.", "code 127.");

      expect(cleanedNotice).toMatchInlineSnapshot(`
        <notice>
        Opening the location in your editor failed!
        I ran your command for opening an editor (set via the ELM_WATCH_OPEN_EDITOR environment variable):

        cd /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay
        nope

        I ran the command with these extra environment variables:

        {
         "file": "/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm",
         "line": "10",
         "column": "31",
         "line0": "9",
         "column0": "30"
        }

        The command exited with code 127.

        nope: command not found

        Run "elm-watch editor" to try out changes to ELM_WATCH_OPEN_EDITOR without restarting elm-watch.
        </notice>
      `);
    });

    test("timeout", async () => {
      const { notice } = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: `node -e "setTimeout(() => process.exit(1), 10000)"`,
          [__ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS]: "10",
        },
      });
      expect(notice).toMatchInlineSnapshot(`
        <notice>
        Opening the location in your editor failed!
        I ran your command for opening an editor (set via the ELM_WATCH_OPEN_EDITOR environment variable):

        cd /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay
        node -e "setTimeout(() => process.exit(1), 10000)"

        I ran the command with these extra environment variables:

        {
         "file": "/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm",
         "line": "10",
         "column": "31",
         "line0": "9",
         "column0": "30"
        }

        The command took too long to run, and was killed after 10 ms.

        (no output)

        Run "elm-watch editor" to try out changes to ELM_WATCH_OPEN_EDITOR without restarting elm-watch.
        </notice>
      `);
    });

    test("exit 1", async () => {
      const { notice } = await runFailClickErrorLocation({
        env: {
          [ELM_WATCH_OPEN_EDITOR]: `node -e "process.exit(1)"`,
        },
      });
      expect(notice).toMatchInlineSnapshot(`
        <notice>
        Opening the location in your editor failed!
        I ran your command for opening an editor (set via the ELM_WATCH_OPEN_EDITOR environment variable):

        cd /Users/you/project/tests/fixtures/hot/persisted-open-error-overlay
        node -e "process.exit(1)"

        I ran the command with these extra environment variables:

        {
         "file": "/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm",
         "line": "10",
         "column": "31",
         "line0": "9",
         "column0": "30"
        }

        The command exited with code 1.

        (no output)

        Run "elm-watch editor" to try out changes to ELM_WATCH_OPEN_EDITOR without restarting elm-watch.
        </notice>
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

  test("env var command with elm-watch options runs in root", async () => {
    const fixture = "persisted-open-error-overlay";
    const outputFile = path.join(
      fixtureDir(fixture),
      "click-error-location-shell-command.txt",
    );
    rm(outputFile);

    const arg = IS_WINDOWS
      ? `"%file%:%line0%:%column0%"`
      : `"$file:$line0:$column0"`;

    await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      env: {
        [ELM_WATCH_OPEN_EDITOR]: `node -e "require('fs').writeFileSync('click-error-location-shell-command.txt', process.argv[1])" ${arg}`,
      },
      useElmWatchFunction: true,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: async () => {
        clickFirstErrorLocation();
        await waitFor(() => fs.existsSync(outputFile));
        return "Stop" as const;
      },
    });

    expect(clean(fs.readFileSync(outputFile, "utf-8"))).toMatchInlineSnapshot(
      `/Users/you/project/tests/fixtures/hot/persisted-open-error-overlay/src/Main.elm:9:30`,
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
      [Hide until reload or error]
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
