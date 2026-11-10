// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { __ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS } from "../src/Env.ts";
import {
  onlyErrorMessages,
  stringSnapshotSerializer,
  TerminalColorReadStream,
  testExceptWindows,
} from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  closeOverlay,
  expandUi,
  fixtureDir,
  getOverlay,
  getOverlayAnnouncement,
  hideErrors,
  isOverlayVisible,
  pressOverlayKey,
  nextMsg,
  nextWatcherEventHandled,
  pressEscape,
  runHotReload,
  showErrors,
  switchCompilationMode,
  waitForElmWatchIdle,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot reloading", () => {
  afterEach(cleanupAfterEachTest);

  test("Switching to optimize mode with Debug.log and switching back", async () => {
    const { go } = runHotReload({
      name: "DebugLog",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
    });

    const { terminal, onlyExpandedRenders } = await go(({ idle }) => {
      switch (idle) {
        case 1:
          switchCompilationMode("optimize");
          return "KeepGoing";
        case 2:
          switchCompilationMode("standard");
          return "KeepGoing";
        default:
          return "Stop";
      }
    });

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- DEBUG REMNANTS --------------------------------------------------------------⧘
      ⧙Target: DebugLog⧘

      There are uses of the \`Debug\` module in the following modules:

          ⧙DebugLog⧘

      But the --optimize flag only works if all \`Debug\` functions are removed!

      ⧙Note⧘: The issue is that --optimize strips out info needed by \`Debug\` functions.
      Here are two examples:

          (1) It shortens record field names. This makes the generated JavaScript is
          smaller, but \`Debug.toString\` cannot know the real field names anymore.

          (2) Values like \`type Height = Height Float\` are unboxed. This reduces
          allocation, but it also means that \`Debug.toString\` cannot tell if it is
          looking at a \`Height\` or \`Float\` value.

      There are a few other cases like that, and it will be much worse once we start
      inlining code. That optimization could move \`Debug.log\` and \`Debug.todo\` calls,
      resulting in unpredictable behavior. I hope that clarifies why this restriction
      exists!
    `);

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      ▲ ✅
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ✅ DebugLog Successfully compiled · 13:10:05
      Compilation mode for DebugLog
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
      ⏳ DebugLog Waiting for compilation · 13:10:05
      Compilation mode for DebugLog
      ◯ (disabled) Debug
      ◯ (disabled) Standard
      ◉ (disabled) Optimize
      The Elm debugger isn't supported by \`Html\` programs.
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ 🚨🚀
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Hide errors]
      [Close elm-watch]
      🚨 DebugLog Compilation error · 13:10:05
      Compilation mode for DebugLog
      ◯ (disabled) Debug
      ◯ Standard
      ◉ Optimize
      The Elm debugger isn't supported by \`Html\` programs.
      Note: The code currently running is in standard mode.
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ ⏳
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Hide errors]
      [Close elm-watch]
      ⏳ DebugLog Waiting for compilation · 13:10:05
      Compilation mode for DebugLog
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
      ✅ DebugLog Successfully compiled · 13:10:05
      Compilation mode for DebugLog
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger isn't supported by \`Html\` programs.
      Drag emoji or press shift+arrows to move
    `);
  });

  test("Changed record fields in optimize with postprocess", async () => {
    const { replace, go } = runHotReload({
      fixture: "hot-reload-postprocess",
      useElmWatchFunction: true,
      name: "ChangedRecordFields",
      programType: "Element",
      compilationMode: "optimize",
      expandUiImmediately: true,
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assertInit(div);
          replace((content) => content.replace(/-- /g, ""));
          return "KeepGoing";
        default:
          assertHotReload(div);
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because record field mangling in optimize mode was different than last time.
        (target: ChangedRecordFields)
      `);

    function assertInit(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Text</div>`);
    }

    function assertHotReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>Text and new text</div>`,
      );
    }
  });

  // Usually when connecting, it should trigger a compile check. But if we’re already compiling,
  // we can just wait for that. There isn’t really any output showing this happening, but the
  // test is needed for code coverage.
  test("Connect while compiling", async () => {
    const { go } = runHotReload({
      fixture: "hot-reload-postprocess",
      useElmWatchFunction: true,
      name: "SlowPostprocess",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
    });

    const { browserConsole } = await go(async ({ idle }) => {
      switch (idle) {
        case 1: {
          // Once elm-watch has received the new compilation mode, it is
          // compiling (and the postprocess is slow).
          const compiling = nextMsg(
            (msg) => msg.tag === "WebSocketMessageReceived",
          );
          switchCompilationMode("optimize");
          await compiling;
          window.__ELM_WATCH.DISCONNECT(/^SlowPostprocess$/);
          return "KeepGoing";
        }
        default:
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because compilation mode changed from standard to optimize.
        (target: SlowPostprocess)
      `);
  });

  test("hot reload code postprocessed to ESM", async () => {
    const { go, replace } = runHotReload({
      fixture: "hot-reload-postprocess",
      useElmWatchFunction: true,
      name: "ESM",
      programType: "Html",
      compilationMode: "standard",
      init: (node, allExports) => {
        expect(allExports).toHaveLength(1);
        const onlyExport = allExports[0];
        if (
          typeof onlyExport !== "object" ||
          onlyExport === null ||
          !("default" in onlyExport)
        ) {
          throw new Error(`Unexpected export: ${JSON.stringify(onlyExport)}`);
        }
        expect(window.Elm).toStrictEqual(onlyExport.default);
        return window.Elm?.["ESM"]?.init({ node });
      },
    });

    await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          expectInit(div);
          replace((content) =>
            content.replace("original text", "hot reloaded text"),
          );
          return "KeepGoing";
        default:
          expectReload(div);
          return "Stop";
      }
    });

    function expectInit(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>original text</div>`);
    }

    function expectReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>hot reloaded text</div>`,
      );
    }
  });

  test("Delay init Cmds until first hot reload", async () => {
    const { inputPath, replace, go } = runHotReload({
      name: "InitCmds",
      programType: "Element",
      compilationMode: "standard",
    });

    await go(async ({ idle, div }) => {
      switch (idle) {
        case 1: {
          expectInit(div);

          // Close the tab:
          await window.__ELM_WATCH.KILL_MATCHING(/^/);
          div.replaceChildren();

          // Make a change with the tab closed:
          const changed = nextWatcherEventHandled(inputPath);
          replace((content) => content.replace("OLD", "NEW"));
          await changed;
          await waitForElmWatchIdle();

          // Open the tab again. It is first going to load the old code,
          // and then immediately get a hot reload with the new code.
          // By delaying the init Cmds until then, we get the Cmds handled
          // with the new code without a page reload.
          window.__ELM_WATCH.RELOAD_PAGE(undefined);
          return "KeepGoing";
        }
        default:
          expectReload(div);
          return "Stop";
      }
    });

    function expectInit(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>Model set via Cmd from OLD code</div>`,
      );
    }

    function expectReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>Model set via Cmd from NEW code</div>`,
      );
    }
  });

  test.each(["standard", "optimize"] as const)(
    "List.sortWith bug: %s",
    async (compilationMode) => {
      const { replace, go } = runHotReload({
        name: "SortWithBug",
        programType: "Sandbox",
        compilationMode,
        isTTY: false,
      });

      await go(({ idle, div }) => {
        switch (idle) {
          case 1:
            assertInit(div);
            replace((content) =>
              content.replace("hot reload", "simple text change"),
            );
            return "KeepGoing";
          default:
            assertHotReload(div);
            return "Stop";
        }
      });

      function assertInit(div: HTMLDivElement): void {
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div><div title="hot reload">ab</div></div>`,
        );
      }

      function assertHotReload(div: HTMLDivElement): void {
        // The text in the `div` is supposed to say “ab” (not “ba”) even after the hot reload.
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div><div title="simple text change">ab</div></div>`,
        );
      }
    },
  );

  describe("error overlay", () => {
    const fixture = "error-overlay";
    const replaceHelper = (
      name: string,
      f: (content: string) => string,
    ): void => {
      const src = path.join(fixtureDir(fixture), "src");
      fs.writeFileSync(
        path.join(src, name),
        f(fs.readFileSync(path.join(src, name), "utf-8")),
      );
    };

    const joinOverlays = (overlays: Array<string>): string =>
      overlays.join(`\n${"=".repeat(80)}\n`);

    beforeEach(() => {
      const dir = fixtureDir(fixture);
      const template = path.join(dir, "template");
      const src = path.join(dir, "src");
      fs.mkdirSync(src);
      for (const name of fs.readdirSync(template)) {
        fs.copyFileSync(path.join(template, name), path.join(src, name));
      }
    });

    test("multiple targets", async () => {
      const { go } = runHotReload({
        fixture,
        name: "App",
        programType: "Html",
        compilationMode: "standard",
        extraScripts: ["AppOther.js"],
        env: {
          [__ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS]: "0",
        },
        init: (node) => {
          const node1 = document.createElement("div");
          const node2 = document.createElement("div");
          node.append(node1, node2);
          window.Elm?.["App"]?.init({ node: node1 });
          return window.Elm?.["AppOther"]?.init({ node: node2 });
        },
      });

      const overlays: Array<string> = [];
      const visibility: Array<boolean> = [];
      const announcements: Array<string> = [];

      await go(({ idle }) => {
        switch (idle) {
          case 1:
            return "KeepGoing"; // The first script has loaded.
          case 2:
            replaceHelper("AppHelpers.elm", (content) =>
              content.replace(/"/g, "'"),
            );
            return "KeepGoing";
          case 3:
            // The overlay opens by itself.
            overlays.push(getOverlay());
            closeOverlay();
            visibility.push(isOverlayVisible());
            replaceHelper("AppOtherHelpers.elm", (content) =>
              content.replace("=", ":="),
            );
            return "KeepGoing";
          case 4:
            // New errors from another target open the overlay again.
            overlays.push(getOverlay());
            replaceHelper("Shared.elm", (content) =>
              content.replace("text", "textTypo"),
            );
            return "KeepGoing";
          case 5:
            return "KeepGoing"; // First script finished.
          case 6:
            overlays.push(getOverlay());
            announcements.push(getOverlayAnnouncement());
            // The errors of all targets are navigated together.
            pressOverlayKey("ArrowDown");
            overlays.push(getOverlay());
            announcements.push(getOverlayAnnouncement());
            pressOverlayKey("l");
            announcements.push(getOverlayAnnouncement());
            pressOverlayKey("ArrowLeft");
            overlays.push(getOverlay());
            announcements.push(getOverlayAnnouncement());
            pressOverlayKey("a");
            overlays.push(getOverlay());
            announcements.push(getOverlayAnnouncement());
            pressOverlayKey("a");
            // The overlay is shared by all targets.
            expandUi();
            hideErrors();
            visibility.push(isOverlayVisible());
            expandUi();
            showErrors();
            visibility.push(isOverlayVisible());
            return "Stop";
          default:
            return "Stop";
        }
      });

      expect(visibility).toStrictEqual([false, false, true]);

      // For screen readers.
      expect(announcements).toMatchInlineSnapshot(`
        [
          Error 1 of 3: NEEDS DOUBLE QUOTES,
          Error 2 of 3: UNKNOWN EXPORT,
          Error 3 of 3: PROBLEM IN TYPE ANNOTATION,
          Error 2 of 3: UNKNOWN EXPORT,
          3 errors,
        ]
      `);

      expect(joinOverlays(overlays)).toMatchInlineSnapshot(`
        <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">NEEDS DOUBLE QUOTES</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppHelpers.elm:3:8</button></p></div>
        <pre>The following string uses single quotes:

        3| text = 'App'
                  <span style="color: rgb(241, 76, 76)">^^^^^</span>
        Please switch to double quotes instead:

            <span style="color: rgb(229, 229, 16)">'this'</span> =&gt; <span style="color: rgb(35, 209, 139)">"this"</span>

        <u>Note</u>: Elm uses double quotes for strings like "hello", whereas it uses single
        quotes for individual characters like 'a' and 'ø'. This distinction helps with
        code like (String.any (\\c -&gt; c == 'X') "90210") where you are inspecting
        individual characters.</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [a] show all</footer>
        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">NEEDS DOUBLE QUOTES</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppHelpers.elm:3:8</button></p></div>
        <pre>The following string uses single quotes:

        3| text = 'App'
                  <span style="color: rgb(241, 76, 76)">^^^^^</span>
        Please switch to double quotes instead:

            <span style="color: rgb(229, 229, 16)">'this'</span> =&gt; <span style="color: rgb(35, 209, 139)">"this"</span>

        <u>Note</u>: Elm uses double quotes for strings like "hello", whereas it uses single
        quotes for individual characters like 'a' and 'ø'. This distinction helps with
        code like (String.any (\\c -&gt; c == 'X') "90210") where you are inspecting
        individual characters.</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 error 1/2   file 1/2 | [_→] error | [_↓] file | [enter] open in editor | [a] show all</footer>
        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">NEEDS DOUBLE QUOTES</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppHelpers.elm:3:8</button></p></div>
        <pre>The following string uses single quotes:

        3| text = 'App'
                  <span style="color: rgb(241, 76, 76)">^^^^^</span>
        Please switch to double quotes instead:

            <span style="color: rgb(229, 229, 16)">'this'</span> =&gt; <span style="color: rgb(35, 209, 139)">"this"</span>

        <u>Note</u>: Elm uses double quotes for strings like "hello", whereas it uses single
        quotes for individual characters like 'a' and 'ø'. This distinction helps with
        code like (String.any (\\c -&gt; c == 'X') "90210") where you are inspecting
        individual characters.</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 error 1/3   file 1/3 | [_→] error | [_↓] file | [enter] open in editor | [a] show all</footer>
        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">UNKNOWN EXPORT</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/Shared.elm:1:25</button></p></div>
        <pre>You are trying to expose a value named \`textTypo\` but I cannot find its
        definition.

        Maybe you want <span style="color: rgb(229, 229, 16)">text</span> instead?</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 error 2/3   file 2/3 | [←→] error | [↑↓] file | [enter] open in editor | [a] show all</footer>
        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">UNKNOWN EXPORT</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/Shared.elm:1:25</button></p></div>
        <pre>You are trying to expose a value named \`textTypo\` but I cannot find its
        definition.

        Maybe you want <span style="color: rgb(229, 229, 16)">text</span> instead?</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 error 2/3   file 2/3 | [←→] error | [↑↓] file | [enter] open in editor | [a] show all</footer>
        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">NEEDS DOUBLE QUOTES</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppHelpers.elm:3:8</button></p></div>
        <pre>The following string uses single quotes:

        3| text = 'App'
                  <span style="color: rgb(241, 76, 76)">^^^^^</span>
        Please switch to double quotes instead:

            <span style="color: rgb(229, 229, 16)">'this'</span> =&gt; <span style="color: rgb(35, 209, 139)">"this"</span>

        <u>Note</u>: Elm uses double quotes for strings like "hello", whereas it uses single
        quotes for individual characters like 'a' and 'ø'. This distinction helps with
        code like (String.any (\\c -&gt; c == 'X') "90210") where you are inspecting
        individual characters.</pre></div>
        --------------------------------------------------------------------------------
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="1"><div><span style="background-color: rgb(32, 30, 30);">UNKNOWN EXPORT</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/Shared.elm:1:25</button></p></div>
        <pre>You are trying to expose a value named \`textTypo\` but I cannot find its
        definition.

        Maybe you want <span style="color: rgb(229, 229, 16)">text</span> instead?</pre></div>
        --------------------------------------------------------------------------------
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="2"><div><span style="background-color: rgb(32, 30, 30);">PROBLEM IN TYPE ANNOTATION</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppOtherHelpers.elm:3:7</button></p></div>
        <pre>I was partway through parsing the \`text\` type annotation, but I got stuck here:

        3| text := "AppOther"
                 <span style="color: rgb(241, 76, 76)">^</span>
        I was expecting to see a type next. Try putting <span style="color: rgb(229, 229, 16)">Int</span> or <span style="color: rgb(229, 229, 16)">String</span> for now?</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 3 errors | [a] show one error at a time</footer>
        </overlay>
      `);
    });

    test("the overlay opens automatically, and can be closed and re-opened", async () => {
      const { replace, go } = runHotReload({
        fixture,
        name: "App",
        programType: "Html",
        compilationMode: "standard",
      });

      const overlays: Array<string> = [];
      const visibility: Array<boolean> = [];

      await go(({ idle }) => {
        switch (idle) {
          case 1:
            replace((content) => content.replace("++", "+"));
            return "KeepGoing";

          case 2:
            overlays.push(getOverlay());
            visibility.push(isOverlayVisible());
            pressEscape();
            visibility.push(isOverlayVisible());
            pressEscape();
            visibility.push(isOverlayVisible());
            closeOverlay();
            visibility.push(isOverlayVisible());
            replace((content) => content.replace("+", "++"));
            return "KeepGoing";

          case 3:
            overlays.push(getOverlay());
            // Another compilation with errors opens the overlay again, even
            // though it was closed.
            replace((content) => content.replace("++", "+"));
            return "KeepGoing";

          case 4:
            visibility.push(isOverlayVisible());
            replace((content) => content.replace("module", ""));
            return "KeepGoing";

          default:
            overlays.push(getOverlay());
            return "Stop";
        }
      });

      expect(visibility).toStrictEqual([true, false, true, false, true]);

      expect(joinOverlays(overlays)).toMatchInlineSnapshot(`
        <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/App.elm:7:19</button></p></div>
        <pre>I cannot do addition with <span style="color: rgb(229, 229, 16)">String</span> values like this one:

        7| main = Html.text (AppHelpers.text + Shared.text)
                             <span style="color: rgb(241, 76, 76)">^^^^^^^^^^^^^^^</span>
        The (+) operator only works with <span style="color: rgb(229, 229, 16)">Int</span> and <span style="color: rgb(229, 229, 16)">Float</span> values.

        <u>Hint</u>: Switch to the <span style="color: rgb(35, 209, 139)">(++)</span> operator to append strings!</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [a] show all</footer>
        </overlay>
        ================================================================================
        <overlay hidden style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">

        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <div style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);" id="0"><div><span style="background-color: rgb(32, 30, 30);">SYNTAX PROBLEM</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/App.elm:1:2</button></p></div>
        <pre>I got stuck here:

        1|  App exposing (main)
            <span style="color: rgb(241, 76, 76)">^</span>
        I am not sure what is going on, but I recommend starting an Elm file with the
        following lines:

            <span style="color: rgb(41, 184, 219)">import</span> Html
            
            main =
              Html.text <span style="color: rgb(229, 229, 16)">"Hello!"</span>

        You should be able to copy those lines directly into your file. Check out the
        examples at &lt;https://elm-lang.org/examples&gt; for more help getting started!

        <u>Note</u>: This can also happen when something is indented too much!</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [a] show all</footer>
        </overlay>
      `);
    });

    testExceptWindows("terminal theme", async () => {
      const { replace, go } = runHotReload({
        fixture,
        name: "App",
        programType: "Html",
        compilationMode: "standard",
        stdin: new TerminalColorReadStream(),
      });

      let overlay = "(not set)";

      await go(({ idle }) => {
        switch (idle) {
          case 1:
            replace((content) => content.replace("++", "+"));
            return "KeepGoing";

          case 2:
            overlay = getOverlay();
            return "Stop";

          default:
            return "Stop";
        }
      });

      expect(overlay).toMatchInlineSnapshot(`
        <overlay visible style="background-color: rgb(170, 187, 204); color: rgb(17, 34, 51);">
        <div style="background-color: rgb(170, 187, 204); color: rgb(17, 34, 51);" id="0"><div><span style="background-color: rgb(170, 187, 204);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/App.elm:7:19</button></p></div>
        <pre>I cannot do addition with <span style="color: #333333">String</span> values like this one:

        7| main = Html.text (AppHelpers.text + Shared.text)
                             <span style="color: #999999">^^^^^^^^^^^^^^^</span>
        The (+) operator only works with <span style="color: #333333">Int</span> and <span style="color: #333333">Float</span> values.

        <u>Hint</u>: Switch to the <span style="color: #aaaaaa">(++)</span> operator to append strings!</pre></div>
        --------------------------------------------------------------------------------
        <footer>🚨 error 1/1 | [__] error | [__] file | [enter] open in editor | [a] show all</footer>
        </overlay>
      `);
    });
  });
});
