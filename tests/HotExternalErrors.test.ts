// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import { createErrorReporter } from "../src/index.ts";
import {
  clean,
  KeyReadStream,
  stringSnapshotSerializer,
  waitFor,
} from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  clickFirstErrorLocation,
  expandUi,
  fixtureDir,
  getOverlay,
  isOverlayVisible,
  nextMsg,
  run,
  waitForElmWatchIdle,
  withoutConnectionAttempts,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot external errors", () => {
  afterEach(cleanupAfterEachTest);

  test("shown in the terminal and in the browser, and updated while running", async () => {
    const fixture = "error-view";
    // Only Main has errors.
    fs.writeFileSync(
      path.join(fixtureDir(fixture), "src", "Other.elm"),
      'module Other exposing (main)\n\nimport Html\n\n\nmain =\n    Html.text "4"\n',
    );
    const errors = createErrorReporter();
    errors.set("esbuild", [
      {
        message: "Expected \x1B[1m;\x1B[0m but found \x1B[31mfoo\x1B[0m",
        location: { file: "ts/main.ts", line: 12, column: 9 },
      },
    ]);
    const stdin = new KeyReadStream();
    const screens: Array<string> = [];
    const overlays: Array<string> = [];

    // Everything above the error.
    const top = (output: string): string =>
      clean(output).split("\n").slice(0, 4).join("\n");

    // From the overlay footer: “error 1/4”
    const numOverlayErrors = (): number =>
      Number(/error \d+\/(\d+)/.exec(getOverlay())?.[1]);

    // The first error in the overlay.
    const firstOverlayError = (): string =>
      getOverlay().split("-".repeat(80))[0] ?? "";

    const setErrors = async (
      ...args: Parameters<typeof errors.set>
    ): Promise<void> => {
      const handled = nextMsg((msg) => msg.tag === "ExternalErrorsChanged");
      errors.set(...args);
      await handled;
      await waitForElmWatchIdle();
    };

    const { lastRender } = await run({
      fixture,
      scripts: ["Main.js"],
      stdin,
      useElmWatchFunction: { errors },
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ stdout }) => {
        // The browser gets the external errors when connecting.
        await waitFor(() => numOverlayErrors() === 4);

        // The external errors are listed (and selected) first.
        screens.push(top(stdout.getOutput()));
        overlays.push(firstOverlayError());

        // Tab goes to Main.
        const handled = nextMsg((msg) => msg.tag === "KeysPressed");
        stdin.press("\t");
        await handled;
        screens.push(clean(stdout.getOutput()));

        // Clearing the errors.
        await setErrors("esbuild", []);
        await waitFor(() => numOverlayErrors() === 3);
        screens.push(top(stdout.getOutput()));

        // Setting new errors.
        await setErrors("translations", [{ message: "Missing key: goodbye" }]);
        await waitFor(() => numOverlayErrors() === 4);
        screens.push(top(stdout.getOutput()));
        // The selected error is kept, so the new error is before it.
        overlays.push(getOverlay());
        expandUi();

        return "Stop" as const;
      },
    });

    expect(isOverlayVisible()).toBe(true);
    expect(screens.join(`\n${"=".repeat(80)}\n`)).toMatchInlineSnapshot(`
      🚨 ⧙esbuild⧘: 1 error ◀
      🚨 Main: 3 errors
      ✅ Other⧙                                            1 ms Q | 765 ms T ¦  50 ms W⧘
      🌐 http://localhost:59123
      ================================================================================
      🚨 esbuild: 1 error
      🚨 ⧙Main⧘: 3 errors ◀
      ✅ Other⧙                                            1 ms Q | 765 ms T ¦  50 ms W⧘
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
      🚨 Main: 3 errors
      ✅ Other
      🌐 http://localhost:59123

      ================================================================================
      🚨 translations: 1 error
      🚨 ⧙Main⧘: 3 errors ◀
      ✅ Other
      🌐 http://localhost:59123
    `);
    expect(overlays.join(`\n${"=".repeat(80)}\n`)).toMatchInlineSnapshot(`
      <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
      <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">ESBUILD</span><p><button>/Users/you/project/tests/fixtures/hot/error-view/ts/main.ts:12:9</button></p></div>
      <pre>Expected ; but found foo</pre></div>

      ================================================================================
      <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
      <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/error-view/src/A.elm:6:5</button></p></div>
      <pre>Something is off with the body of the \`a\` definition:

      6|     1
             <span style="color: rgb(241, 76, 76)">^</span>
      The body is a number of type:

          <span style="color: rgb(229, 229, 16)">number</span>

      But the type annotation on \`a\` says it should be:

          <span style="color: rgb(229, 229, 16)">String</span>

      <u>Hint</u>: Try using <span style="color: rgb(35, 209, 139)">String.fromInt</span> to convert it to a string?</pre></div>
      --------------------------------------------------------------------------------
      <footer>🚨 error 2/4   file 2/3 | [←→] error | [↑↓] file | [enter] open in editor | [a] show all</footer>
      </overlay>
    `);
    expect(lastRender).toMatchInlineSnapshot(`
      ▲ 🚨
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Hide errors]
      [Close elm-watch]
      🚨 translations 1 error
      🚨 Main Compilation error · 13:10:05
      Compilation mode for Main
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger isn't available at this point.
      Drag emoji or press shift+arrows to move
    `);
  });

  test("external errors while Elm is fine, and opening them in the editor", async () => {
    const fixture = "error-view";
    for (const name of ["Main", "Other"]) {
      fs.writeFileSync(
        path.join(fixtureDir(fixture), "src", `${name}.elm`),
        `module ${name} exposing (main)\n\nimport Html\n\n\nmain =\n    Html.text "4"\n`,
      );
    }
    const errors = createErrorReporter();
    errors.set("codegen", [
      {
        message: "Bad JSON",
        location: { file: "translations.json", line: 3 },
      },
    ]);
    const calls: Array<unknown> = [];
    const overlayVisible: Array<boolean> = [];

    const { renders } = await run({
      fixture,
      scripts: ["Main.js"],
      useElmWatchFunction: {
        errors,
        openEditor: (location: unknown) => {
          calls.push(location);
        },
      },
      init: () => {
        // Do nothing.
      },
      onIdle: async () => {
        await waitFor(isOverlayVisible);
        overlayVisible.push(isOverlayVisible());
        clickFirstErrorLocation();
        await waitFor(() => calls.length > 0);

        const handled = nextMsg((msg) => msg.tag === "ExternalErrorsChanged");
        errors.set("codegen", []);
        await handled;
        await waitForElmWatchIdle();
        await waitFor(() => !isOverlayVisible());
        overlayVisible.push(isOverlayVisible());
        return "Stop" as const;
      },
    });

    expect(overlayVisible).toStrictEqual([true, false]);
    expect(withoutConnectionAttempts(renders)).toMatchInlineSnapshot(`
      ▼ 🔌
      ================================================================================
      ▼ ⏳
      ================================================================================
      ▼ 🚨
      ================================================================================
      ▼ 🔌
      ================================================================================
      ▼ ⏳
      ================================================================================
      ▼ 🚨
      ================================================================================
      ▼ ✅
    `);
    expect(clean(JSON.stringify(calls))).toMatchInlineSnapshot(
      `[{"file":"/Users/you/project/tests/fixtures/hot/error-view/translations.json","line":3,"column":1}]`,
    );
  });

  test("errors set while restarting reach connected browsers", async () => {
    const fixture = "error-view";
    for (const name of ["Main", "Other"]) {
      fs.writeFileSync(
        path.join(fixtureDir(fixture), "src", `${name}.elm`),
        `module ${name} exposing (main)\n\nimport Html\n\n\nmain =\n    Html.text "4"\n`,
      );
    }
    const elmJsonPath = path.join(fixtureDir(fixture), "elm.json");
    const errors = createErrorReporter();

    await run({
      fixture,
      scripts: ["Main.js"],
      useElmWatchFunction: { errors },
      init: () => {
        // Do nothing.
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1: {
            // Changing elm.json restarts elm-watch, but the browser stays
            // connected.
            const restarting = nextMsg(
              (msg) => msg.tag === "SleepBeforeNextActionDone",
            );
            fs.writeFileSync(
              elmJsonPath,
              `${fs.readFileSync(elmJsonPath, "utf8")}\n`,
            );
            await restarting;
            // Not subscribed to by any elm-watch run right now.
            errors.set("codegen", [{ message: "Set while restarting" }]);
            return "KeepGoing" as const;
          }
          default:
            await waitFor(isOverlayVisible);
            return "Stop" as const;
        }
      },
    });

    expect(getOverlay()).toContain("CODEGEN");
  });
});
