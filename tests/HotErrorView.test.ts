// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import { clean, KeyReadStream, stringSnapshotSerializer } from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  fixtureDir,
  nextMsg,
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
        screens.push(clean(stdout.getOutput()));
        for (const key of ["l", "\x1B[B", "\t", "a", "a"]) {
          const handled = nextMsg((msg) => msg.tag === "KeysPressed");
          stdin.press(key);
          await handled;
          screens.push(clean(stdout.getOutput()));
        }
        return "Stop" as const;
      },
    });

    expect(screens.join(`\n${"=".repeat(80)}\n`)).toMatchInlineSnapshot(`
      🚨 ⧙Main⧘: 3 errors ◀
      🚨 Other: 1 error

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Main⧘
      🚨 ⧙13:10:05⧘ Everything up to date.

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

      🚨 error ⧙1⧘/3   file ⧙1⧘/2
      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 ⧙Main⧘: 3 errors ◀
      🚨 Other: 1 error

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Main⧘
      🚨 ⧙13:10:05⧘ Everything up to date.

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

      🚨 error ⧙2⧘/3   file ⧙1⧘/2
      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 ⧙Main⧘: 3 errors ◀
      🚨 Other: 1 error

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Main⧘
      🚨 ⧙13:10:05⧘ Everything up to date.

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

      🚨 error ⧙3⧘/3   file ⧙2⧘/2
      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ error   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ file   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 Main: 3 errors
      🚨 ⧙Other⧘: 1 error ◀

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Main⧘
      🚨 ⧙13:10:05⧘ Everything up to date.

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/Other.elm:7:20

      I cannot do addition with ⧙String⧘ values like this one:

      7|     Html.text (4 + "")
                            ⧙^^⧘
      The (+) operator only works with ⧙Int⧘ and ⧙Float⧘ values.

      ⧙Hint⧘: Switch to the ⧙(++)⧘ operator to append strings!

      🚨 error ⧙1⧘/1
      ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ ⧙error⧘   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙tab⧘⧙]⧘ target   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      ================================================================================
      🚨 Main: 3 errors
      🚨 Other: 1 error

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

      🚨 ⧙4⧘ errors found

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Main⧘
      🚨 ⧙13:10:05⧘ Everything up to date.

      ⧙[⧘⧙a⧘⧙]⧘ show one error at a time
      ================================================================================
      🚨 Main: 3 errors
      🚨 ⧙Other⧘: 1 error ◀

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: Main⧘
      🚨 ⧙13:10:05⧘ Everything up to date.

      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/error-view/src/Other.elm:7:20

      I cannot do addition with ⧙String⧘ values like this one:

      7|     Html.text (4 + "")
                            ⧙^^⧘
      The (+) operator only works with ⧙Int⧘ and ⧙Float⧘ values.

      ⧙Hint⧘: Switch to the ⧙(++)⧘ operator to append strings!

      🚨 error ⧙1⧘/1
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

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures-copies/Hot⧘…
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

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

      🚨 error ⧙2⧘/2   file ⧙2⧘/2
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

        🚨 error ⧙1⧘/1
        ⧙[⧘⧙←⧘⧙→⧘⧙]⧘ ⧙error⧘   ⧙[⧘⧙↑⧘⧙↓⧘⧙]⧘ ⧙file⧘   ⧙[⧘⧙enter⧘⧙]⧘ open in editor   ⧙[⧘⧙a⧘⧙]⧘ show all
      `);
  });
});
