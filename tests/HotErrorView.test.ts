// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import { clean, KeyReadStream, stringSnapshotSerializer } from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  fixtureDir,
  getOverlay,
  nextMsg,
  nextWatcherEventHandled,
  pressOverlayKey,
  run,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot error view", () => {
  afterEach(cleanupAfterEachTest);

  test("navigate errors with the keyboard", async () => {
    const stdin = new KeyReadStream();
    const screens: Array<string> = [];

    await run({
      fixture: "error-view",
      args: [],
      scripts: ["Main.js"],
      stdin,
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ stdout }) => {
        expect(stdout.cursorVisible).toBe(false);
        // The key hints are at the very bottom, not followed by an empty line.
        expect(stdout.isCursorOnLastLine()).toBe(true);
        screens.push(clean(stdout.getOutput()));
        for (const key of ["l", "\x1B[B", "\t", "a", "a"]) {
          const handled = nextMsg((msg) => msg.tag === "KeysPressed");
          stdin.press(key);
          await handled;
          expect(stdout.isCursorOnLastLine()).toBe(true);
          screens.push(clean(stdout.getOutput()));
        }
        return "Stop" as const;
      },
    });

    expect(screens.join(`\n${"=".repeat(80)}\n`)).toMatchInlineSnapshot(`
      🚨 ⧙Main⧘: 3 errors ◀
      🚨 Other: 1 error
      🌐 http://localhost:59123

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/A.elm:6:5

      Something is off with the body of the \`a\` definition:

      6|     1
             ⧙^⧘
      The body is a number of type:

          ⧙number⧘

      But the type annotation on \`a\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
      🚨 error 1/3   file 1/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 ⧙Main⧘: 3 errors ◀
      🚨 Other: 1 error
      🌐 http://localhost:59123

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/A.elm:11:5

      Something is off with the body of the \`b\` definition:

      11|     2
              ⧙^⧘
      The body is a number of type:

          ⧙number⧘

      But the type annotation on \`b\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
      🚨 error 2/3   file 1/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 ⧙Main⧘: 3 errors ◀
      🚨 Other: 1 error
      🌐 http://localhost:59123

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/B.elm:6:5

      Something is off with the body of the \`c\` definition:

      6|     3
             ⧙^⧘
      The body is a number of type:

          ⧙number⧘

      But the type annotation on \`c\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
      🚨 error 3/3   file 2/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 Main: 3 errors
      🚨 ⧙Other⧘: 1 error ◀
      🌐 http://localhost:59123

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/Other.elm:7:20

      I cannot do addition with ⧙String⧘ values like this one:

      7|     Html.text (4 + "")
                            ⧙^^⧘
      The (+) operator only works with ⧙Int⧘ and ⧙Float⧘ values.

      ⧙Hint⧘: Switch to the ⧙(++)⧘ operator to append strings!

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
      🚨 error 1/1

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ ⧙error⧘   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 Main: 3 errors
      🚨 Other: 1 error
      🌐 http://localhost:59123

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/A.elm:6:5

      Something is off with the body of the \`a\` definition:

      6|     1
             ⧙^⧘
      The body is a number of type:

          ⧙number⧘

      But the type annotation on \`a\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/A.elm:11:5

      Something is off with the body of the \`b\` definition:

      11|     2
              ⧙^⧘
      The body is a number of type:

          ⧙number⧘

      But the type annotation on \`b\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/B.elm:6:5

      Something is off with the body of the \`c\` definition:

      6|     3
             ⧙^⧘
      The body is a number of type:

          ⧙number⧘

      But the type annotation on \`c\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/Other.elm:7:20

      I cannot do addition with ⧙String⧘ values like this one:

      7|     Html.text (4 + "")
                            ⧙^^⧘
      The (+) operator only works with ⧙Int⧘ and ⧙Float⧘ values.

      ⧙Hint⧘: Switch to the ⧙(++)⧘ operator to append strings!

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
      🚨 4 errors

      ⧙[⧘⧙a⧘⧙]⧘ show one error at a time
      ================================================================================
      🚨 Main: 3 errors
      🚨 ⧙Other⧘: 1 error ◀
      🌐 http://localhost:59123

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/Other.elm:7:20

      I cannot do addition with ⧙String⧘ values like this one:

      7|     Html.text (4 + "")
                            ⧙^^⧘
      The (+) operator only works with ⧙Int⧘ and ⧙Float⧘ values.

      ⧙Hint⧘: Switch to the ⧙(++)⧘ operator to append strings!

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
      🚨 error 1/1

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ ⧙error⧘   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
    `);
  });

  test("fixing the selected error selects the next one", async () => {
    const fixture = "error-view";
    const a = path.join(fixtureDir(fixture), "src", "A.elm");
    const stdin = new KeyReadStream();

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      stdin,
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1: {
            // Select the second error in A.elm, and fix it.
            const handled = nextMsg((msg) => msg.tag === "KeysPressed");
            stdin.press("l");
            await handled;
            fs.writeFileSync(
              a,
              fs.readFileSync(a, "utf8").replace("    2", '    "2"'),
            );
            return "KeepGoing";
          }
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      🚨 ⧙Main⧘: 2 errors ◀
      🚨 Other: 1 error
      🌐 http://localhost:59123

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/B.elm:6:5

      Something is off with the body of the \`c\` definition:

      6|     3
             ⧙^⧘
      The body is a number of type:

          ⧙number⧘

      But the type annotation on \`c\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?

      ℹ️ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed src/A.elm⧘
      🚨 error 2/2   file 2/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
    `);
  });

  test("open in editor without it being set up", async () => {
    const stdin = new KeyReadStream();
    let screen = "";

    await run({
      fixture: "error-view",
      args: ["Other"],
      scripts: ["Other.js"],
      stdin,
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ stdout }) => {
        const failed = nextMsg(
          (msg) => msg.tag === "OpenEditorFromTerminalFailed",
        );
        stdin.press("o");
        await failed;
        screen = clean(stdout.getOutput());
        return "Stop" as const;
      },
    });

    expect(screen.slice(screen.indexOf("Opening errors")))
      .toMatchInlineSnapshot(`
        Opening errors in your editor only works if you set it up, using the ELM_WATCH_OPEN_EDITOR environment variable or the openEditor option.

        Check this out: https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations

        ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Other⧘
        🚨 error 1/1

        ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ ⧙error⧘   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      `);
  });

  test("one-line info message for files not imported by any target", async () => {
    const fixture = "error-view";
    const unused = path.join(fixtureDir(fixture), "src", "Unused.elm");
    let screen = "";

    await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ stdout }) => {
        const handled = nextWatcherEventHandled(unused);
        fs.writeFileSync(unused, "module Unused exposing (x)\n\nx = 1\n");
        await handled;
        screen = clean(stdout.getOutput());
        return "Stop" as const;
      },
    });

    expect(screen.split("\n").at(-3)).toMatchInlineSnapshot(
      `🚨 error 1/3   file 1/2`,
    );
  });

  test("several targets but only one with errors: no highlight, and tab does nothing", async () => {
    const fixture = "error-view";
    fs.writeFileSync(
      path.join(fixtureDir(fixture), "src", "Other.elm"),
      'module Other exposing (main)\n\nimport Html\n\n\nmain =\n    Html.text "4"\n',
    );
    const stdin = new KeyReadStream();
    const screens: Array<string> = [];

    await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      stdin,
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ stdout }) => {
        screens.push(clean(stdout.getOutput()));
        const handled = nextMsg((msg) => msg.tag === "KeysPressed");
        stdin.press("\t");
        await handled;
        screens.push(clean(stdout.getOutput()));
        return "Stop" as const;
      },
    });

    const [before, after] = screens;
    expect(after).toBe(before);
    const lines = before?.split("\n") ?? [];
    expect([...lines.slice(0, 3), "…", ...lines.slice(-2)].join("\n"))
      .toMatchInlineSnapshot(`
        🚨 Main: 3 errors
        ✅ Other⧙                                            1 ms Q | 765 ms T ¦  50 ms W⧘
        🌐 http://localhost:59123
        …

        ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      `);
  });

  test("selection and show all are kept across restarts", async () => {
    const fixture = "error-view";
    const elmJsonPath = path.join(fixtureDir(fixture), "elm.json");
    const stdin = new KeyReadStream();
    const press = async (key: string): Promise<void> => {
      const handled = nextMsg((msg) => msg.tag === "KeysPressed");
      stdin.press(key);
      await handled;
    };
    const footers: Array<string> = [];
    const footer = (output: string): string =>
      clean(output).split("\n").slice(-3).join("\n");

    await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      stdin,
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ idle, stdout }) => {
        switch (idle) {
          case 1:
            // Go to error 2/3, and show all errors.
            await press("l");
            await press("a");
            footers.push(footer(stdout.getOutput()));
            // Touching elm.json restarts elm-watch.
            fs.writeFileSync(elmJsonPath, fs.readFileSync(elmJsonPath));
            return "KeepGoing";
          default:
            // Still showing all errors after the restart.
            footers.push(footer(stdout.getOutput()));
            // Back to one at a time: Still at error 2/3.
            await press("a");
            footers.push(footer(stdout.getOutput()));
            return "Stop";
        }
      },
    });

    expect(footers.join("\n---\n")).toMatchInlineSnapshot(`
      🚨 4 errors

      ⧙[⧘⧙a⧘⧙]⧘ show one error at a time
      ---
      🚨 4 errors

      ⧙[⧘⧙a⧘⧙]⧘ show one error at a time
      ---
      🚨 error 2/3   file 1/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
    `);
  });

  test("collapse and expand long code excerpts", async () => {
    const stdin = new KeyReadStream();
    const screens: Array<string> = [];
    const overlays: Array<string> = [];
    const press = async (key: string): Promise<void> => {
      const handled = nextMsg((msg) => msg.tag === "KeysPressed");
      stdin.press(key);
      await handled;
    };
    // Everything below the server line.
    const screen = (output: string): string =>
      clean(output).split("\n").slice(3).join("\n");
    const lastLines = (output: string): string =>
      clean(output).split("\n").slice(-3).join("\n");

    await run({
      fixture: "error-view-collapse",
      args: [],
      scripts: ["Main.js"],
      stdin,
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ stdout }) => {
        // Collapsed by default.
        screens.push(screen(stdout.getOutput()));
        await press(" ");
        screens.push(screen(stdout.getOutput()));
        // Nothing to collapse in the other error: No space key hint.
        await press("l");
        screens.push(lastLines(stdout.getOutput()));
        // Still expanded when going back.
        await press("h");
        screens.push(lastLines(stdout.getOutput()));

        // The browser has its own state, and is collapsed by default too.
        overlays.push(getOverlay());
        pressOverlayKey(" ");
        overlays.push(getOverlay());
        // Space scrolls as usual when there is nothing to collapse.
        pressOverlayKey("l");
        const space = new KeyboardEvent("keydown", {
          key: " ",
          cancelable: true,
        });
        window.dispatchEvent(space);
        expect(space.defaultPrevented).toBe(false);
        return "Stop" as const;
      },
    });

    expect(screens.join(`\n${"=".repeat(80)}\n`)).toMatchInlineSnapshot(`
      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view-collapse/src/Main.elm:19:5

      Something is off with the body of the \`f\` definition:

      19|⧙>⧘    String.length <|
      20|⧙>⧘        case t of
      21|⧙>⧘            C1 ->
      22|⧙>⧘                "1"
      23|⧙>⧘
      24|⧙>⧘            C2 ->
        ¦⧙ (16 lines)⧘
      41|⧙>⧘
      42|⧙>⧘            C8 ->
      43|⧙>⧘                "8"

      The body is:

          ⧙Int⧘

      But the type annotation on \`f\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Want to convert an Int into a String? Use the ⧙String.fromInt⧘ function!

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
      🚨 error 1/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙space⧘⧙]⧘ expand   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view-collapse/src/Main.elm:19:5

      Something is off with the body of the \`f\` definition:

      19|⧙>⧘    String.length <|
      20|⧙>⧘        case t of
      21|⧙>⧘            C1 ->
      22|⧙>⧘                "1"
      23|⧙>⧘
      24|⧙>⧘            C2 ->
      25|⧙>⧘                "2"
      26|⧙>⧘
      27|⧙>⧘            C3 ->
      28|⧙>⧘                "3"
      29|⧙>⧘
      30|⧙>⧘            C4 ->
      31|⧙>⧘                "4"
      32|⧙>⧘
      33|⧙>⧘            C5 ->
      34|⧙>⧘                "5"
      35|⧙>⧘
      36|⧙>⧘            C6 ->
      37|⧙>⧘                "6"
      38|⧙>⧘
      39|⧙>⧘            C7 ->
      40|⧙>⧘                "7"
      41|⧙>⧘
      42|⧙>⧘            C8 ->
      43|⧙>⧘                "8"

      The body is:

          ⧙Int⧘

      But the type annotation on \`f\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Want to convert an Int into a String? Use the ⧙String.fromInt⧘ function!

      ℹ️ ⧙13:10:05⧘ Up to date   ⧙web socket connected: Main⧘
      🚨 error 1/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙space⧘⧙]⧘ collapse   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 error 2/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 error 1/2

      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙space⧘⧙]⧘ collapse   ⧙[⧘⧙a⧘⧙]⧘ show all
    `);
    expect(overlays.join(`\n${"=".repeat(80)}\n`)).toMatchInlineSnapshot(`
      <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
      <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/error-view-collapse/src/Main.elm:19:5</button></p></div>
      <pre>Something is off with the body of the \`f\` definition:

      19|<span style="color: rgb(241, 76, 76)">&gt;</span>    String.length &lt;|
      20|<span style="color: rgb(241, 76, 76)">&gt;</span>        case t of
      21|<span style="color: rgb(241, 76, 76)">&gt;</span>            C1 -&gt;
      22|<span style="color: rgb(241, 76, 76)">&gt;</span>                "1"
      23|<span style="color: rgb(241, 76, 76)">&gt;</span>
      24|<span style="color: rgb(241, 76, 76)">&gt;</span>            C2 -&gt;
        ¦<span style="opacity: 0.6"> (16 lines)</span>
      41|<span style="color: rgb(241, 76, 76)">&gt;</span>
      42|<span style="color: rgb(241, 76, 76)">&gt;</span>            C8 -&gt;
      43|<span style="color: rgb(241, 76, 76)">&gt;</span>                "8"

      The body is:

          <span style="color: rgb(229, 229, 16)">Int</span>

      But the type annotation on \`f\` says it should be:

          <span style="color: rgb(229, 229, 16)">String</span>

      <u>Hint</u>: Want to convert an Int into a String? Use the <span style="color: rgb(35, 209, 139)">String.fromInt</span> function!</pre></div>
      --------------------------------------------------------------------------------
      <footer>🚨 error 1/2 | [_→] error | [__] file | [enter] open in editor | [space] expand | [a] show all</footer>
      </overlay>
      ================================================================================
      <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
      <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/error-view-collapse/src/Main.elm:19:5</button></p></div>
      <pre>Something is off with the body of the \`f\` definition:

      19|<span style="color: rgb(241, 76, 76)">&gt;</span>    String.length &lt;|
      20|<span style="color: rgb(241, 76, 76)">&gt;</span>        case t of
      21|<span style="color: rgb(241, 76, 76)">&gt;</span>            C1 -&gt;
      22|<span style="color: rgb(241, 76, 76)">&gt;</span>                "1"
      23|<span style="color: rgb(241, 76, 76)">&gt;</span>
      24|<span style="color: rgb(241, 76, 76)">&gt;</span>            C2 -&gt;
      25|<span style="color: rgb(241, 76, 76)">&gt;</span>                "2"
      26|<span style="color: rgb(241, 76, 76)">&gt;</span>
      27|<span style="color: rgb(241, 76, 76)">&gt;</span>            C3 -&gt;
      28|<span style="color: rgb(241, 76, 76)">&gt;</span>                "3"
      29|<span style="color: rgb(241, 76, 76)">&gt;</span>
      30|<span style="color: rgb(241, 76, 76)">&gt;</span>            C4 -&gt;
      31|<span style="color: rgb(241, 76, 76)">&gt;</span>                "4"
      32|<span style="color: rgb(241, 76, 76)">&gt;</span>
      33|<span style="color: rgb(241, 76, 76)">&gt;</span>            C5 -&gt;
      34|<span style="color: rgb(241, 76, 76)">&gt;</span>                "5"
      35|<span style="color: rgb(241, 76, 76)">&gt;</span>
      36|<span style="color: rgb(241, 76, 76)">&gt;</span>            C6 -&gt;
      37|<span style="color: rgb(241, 76, 76)">&gt;</span>                "6"
      38|<span style="color: rgb(241, 76, 76)">&gt;</span>
      39|<span style="color: rgb(241, 76, 76)">&gt;</span>            C7 -&gt;
      40|<span style="color: rgb(241, 76, 76)">&gt;</span>                "7"
      41|<span style="color: rgb(241, 76, 76)">&gt;</span>
      42|<span style="color: rgb(241, 76, 76)">&gt;</span>            C8 -&gt;
      43|<span style="color: rgb(241, 76, 76)">&gt;</span>                "8"

      The body is:

          <span style="color: rgb(229, 229, 16)">Int</span>

      But the type annotation on \`f\` says it should be:

          <span style="color: rgb(229, 229, 16)">String</span>

      <u>Hint</u>: Want to convert an Int into a String? Use the <span style="color: rgb(35, 209, 139)">String.fromInt</span> function!</pre></div>
      --------------------------------------------------------------------------------
      <footer>🚨 error 1/2 | [_→] error | [__] file | [enter] open in editor | [space] collapse | [a] show all</footer>
      </overlay>
    `);
  });
});
