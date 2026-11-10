// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, onTestFinished, test } from "vitest";

import { type LatestEvent, summarizeEvents } from "../src/LatestEvent.ts";
import { markAsAbsolutePath, markAsTargetName } from "../src/Types.ts";
import {
  CtrlCReadStream,
  grep,
  onlyErrorMessages,
  rmSymlink,
  SilentReadStream,
  stringSnapshotSerializer,
  testExceptWindows,
  touch,
} from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  expandUi,
  fixtureDir,
  moveUi,
  run,
  switchCompilationMode,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  afterEach(cleanupAfterEachTest);

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
      ▲ 🔌
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      🔌 Main Connecting · 13:10:05
      Drag emoji or press shift+arrows to move
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
      ▲ ✅
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ✅ Main Successfully compiled · 13:10:05
      Compilation mode for Main
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger cannot be enabled until at least one Elm app has been initialized. (Check the browser console for errors if you expected an Elm app to be initialized by now.)
      Drag emoji or press shift+arrows to move
      ================================================================================
      ▲ ✅
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ✅ Main Successfully compiled · 13:10:05
      Compilation mode for Main
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger isn't supported by \`Html\` programs.
      Drag emoji or press shift+arrows to move
    `);
  });

  test("typecheck only", async () => {
    const fixture = "typecheck-only";
    const main4Path = path.join(fixtureDir(fixture), "src", "Main4.elm");
    const sharedPath = path.join(fixtureDir(fixture), "src", "Shared.elm");

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

    const lines = grep(terminal, /elm make/).split("\n");

    // Main3 and Main4 connect at about the same time, so the order of their
    // first full compilation depends on timing.
    expect(lines.splice(4, 2).sort()).toStrictEqual([
      "⏳ Main3: elm make",
      "⏳ Main4: elm make",
    ]);

    expect(lines.join("\n")).toMatchInlineSnapshot(`
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ⏳ Main3: elm make (typecheck only)
      ⏳ Main4: elm make (typecheck only)
      ⏳ Main4: elm make
      ⏳ Main3: elm make
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ⏳ Main4: elm make
    `);
  });

  test("prioritize last focused target", async () => {
    const fixture = "prioritization";
    const sharedFile = path.join(fixtureDir(fixture), "src", "Shared.elm");
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

    const lines = grep(terminal, /(?:One|Two)[:⧙]/).split("\n");

    // The initial compilation order depends on whether both scripts happened
    // to connect at the same time, so only check that both were compiled.
    // Then, the rest is about prioritization.
    const secondRound = lines.findIndex(
      (line, index) =>
        index > 0 &&
        line.includes(" I⧘") &&
        lines.slice(0, index).some((previous) => previous.includes(" I⧘")),
    );
    expect(
      lines
        .slice(0, secondRound + 1)
        .filter((line) => !line.includes("queued"))
        .sort()
        .join("\n"),
    ).toMatchInlineSnapshot(`
        ⏳ One: elm make
        ⏳ One: elm make (typecheck only)
        ⏳ Two: elm make
        ⏳ Two: elm make (typecheck only)
        ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
        ✅ One⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
        ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
        ✅ Two⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      `);

    expect(lines.slice(secondRound + 1).join("\n")).toMatchInlineSnapshot(`
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
    const dir = fixtureDir(fixture);
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
      useElmWatchFunction: true,
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
      ▲ ✅
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ✅ Main Successfully compiled · 13:10:05
      Compilation mode for Main
      ◯ (disabled) Debug
      ◉ Standard
      ◯ Optimize
      The Elm debugger isn't supported by \`Html\` programs.
      Drag emoji or press shift+arrows to move
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Main</div>`);
  });

  test("Move UI", async () => {
    window.localStorage.removeItem("elm-watch:ui-position");
    const classNames: Array<string> = [];

    await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: () => {
        classNames.push(
          moveUi("ArrowUp"),
          moveUi("ArrowRight"),
          moveUi("ArrowUp"),
          moveUi("ArrowUp"),
          moveUi("ArrowUp"),
          moveUi("ArrowUp"),
          moveUi("ArrowDown"),
          moveUi("ArrowLeft"),
        );
        return "Stop";
      },
    });

    expect(classNames).toStrictEqual([
      "root rootBottomHalf",
      "root rootBottomHalf rootRight",
      "root rootRight",
      "root rootRight",
      "root rootRight rootTopEdge",
      "root rootRight rootTopEdge",
      "root rootRight",
      "root",
    ]);

    expect(window.localStorage.getItem("elm-watch:ui-position")).toBe(
      `{"side":"left","y":0.25}`,
    );
  });

  test("ctrl+c", async () => {
    const stdin = new CtrlCReadStream();
    let cursorVisible: () => boolean = () => true;
    const { terminal, lastRender } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      stdin,
      init: (node) => {
        window.Elm?.["HtmlMain"]?.init({ node });
      },
      onIdle: ({ stdout }) => {
        expect(stdout.cursorVisible).toBe(false);
        cursorVisible = () => stdout.cursorVisible;
        stdin.ctrlC();
        return "KeepGoing";
      },
    });

    // The cursor is hidden while running, and shown again on exit.
    expect(cursorVisible()).toBe(true);

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      🌐 http://localhost:59123

      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Html⧘
    `);

    expect(lastRender).toMatchInlineSnapshot(`▼ ✅`);
  });

  test("exit when stdin ends, using signal", async () => {
    const stdin = new SilentReadStream();
    // This is how the removed ELM_WATCH_EXIT_ON_STDIN_END works nowadays.
    const controller = new AbortController();
    stdin.on("end", () => {
      controller.abort();
    });
    stdin.resume();
    const { terminal, lastRender } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      stdin,
      useElmWatchFunction: { signal: controller.signal },
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
      ✅ Worker
      ✅ Removed
      ✅ Readonly
      ✅ InjectError
      ✅ BadUrl
      ✅ ParamsDecodeError
      ✅ WrongVersion
      ✅ WrongToken
      ✅ HostOrOriginNotAllowed
      ✅ ProtocolError
      ✅ TargetDisabled
      ✅ SendBadJson
      ✅ Reconnect
      ✅ HttpCaching
      ✅ "Esc\\apes"
      🌐 http://localhost:59123

      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Html⧘
    `);

    expect(lastRender).toMatchInlineSnapshot(`▼ ✅`);
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
      ▲ ✅
      --------------------------------------------------------------------------------
      elm-watch %VERSION%
      [Close elm-watch]
      ✅ HttpCaching Successfully compiled · 13:10:05
      Compilation mode for HttpCaching
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
      ⏳ HttpCaching Waiting for compilation · 13:10:05
      Compilation mode for HttpCaching
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
      ❌ HttpCaching Reload trouble · 13:10:05
      A while ago I reloaded the page to get new compiled JavaScript.
      But it looks like after the last page reload I got the same JavaScript as before, instead of new stuff!
      The old JavaScript was compiled 10/9/2022, 11:36:01 AM, and so was the JavaScript currently running.
      I currently need to reload the page again, but fear a reload loop if I try.
      Do you have accidental HTTP caching enabled maybe?
      Try hard refreshing the page and see if that helps, and consider disabling HTTP caching during development.
      Drag emoji or press shift+arrows to move
    `);
  });

  test("elm.json further up than elm-watch.json", async () => {
    const fixture = "elm-json-above-elm-watch-json";
    const elmJsonPath = path.join(fixtureDir(fixture), "elm.json");

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
      🌐 http://localhost:59123

      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed ../elm.json⧘
    `);
  });

  test("source-directories further up than elm.json and elm-watch.json", async () => {
    const fixture = "source-directories-above-elm-watch-json";
    const elmFile = path.join(fixtureDir(fixture), "src", "Answer.elm");

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
      🌐 http://localhost:59123

      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed ../../src/Answer.elm⧘
    `);
  });

  describe("summarizeEvents", () => {
    const root = markAsAbsolutePath("/project");

    function summarize(
      events: Array<LatestEvent>,
      hasDisabledTargets: boolean = false,
    ): string | undefined {
      return summarizeEvents(events, root, hasDisabledTargets);
    }

    function watcherEvent(
      eventName: "changed" | "removed",
      file: string,
      affectsAnyTarget: boolean = true,
    ): LatestEvent {
      return {
        tag: "WatcherEvent",
        eventName,
        file: {
          tag: "AbsolutePath",
          absolutePath: markAsAbsolutePath(`/project/${file}`),
        },
        affectsAnyTarget,
      };
    }

    const webSocketConnected: LatestEvent = {
      tag: "WebSocketConnectedNeedingCompilation",
      outputPath: {
        tag: "OutputPath",
        theOutputPath: markAsAbsolutePath("/project/build/One.js"),
        temporaryOutputPath: markAsAbsolutePath(
          "/project/elm-stuff/elm-watch/1.js",
        ),
        originalString: "build/One.js",
        targetName: markAsTargetName("One"),
      },
    };

    test("0 events", () => {
      expect(summarize([])).toMatchInlineSnapshot(`undefined`);
    });

    test("1 event", () => {
      expect(
        summarize([watcherEvent("changed", "src/One.elm")]),
      ).toMatchInlineSnapshot(`changed src/One.elm`);
    });

    test("several events: the latest one is shown", () => {
      expect(
        summarize([
          watcherEvent("changed", "src/One.elm"),
          webSocketConnected,
          watcherEvent("removed", "src/Two.elm"),
        ]),
      ).toMatchInlineSnapshot(`removed src/Two.elm +2 more`);
    });

    test("only files not imported by any target", () => {
      expect(
        summarize([
          watcherEvent("changed", "src/One.elm", false),
          watcherEvent("changed", "src/Two.elm", false),
        ]),
      ).toMatchInlineSnapshot(
        `src/Two.elm +1 more – not imported by any target`,
      );
    });

    test("only files not imported by any enabled target", () => {
      expect(
        summarize([watcherEvent("changed", "src/One.elm", false)], true),
      ).toMatchInlineSnapshot(
        `src/One.elm – not imported by any enabled target`,
      );
    });

    test("web socket events", () => {
      expect(summarize([webSocketConnected])).toMatchInlineSnapshot(
        `web socket connected: One`,
      );
      expect(
        summarize([
          {
            tag: "WebSocketConnectionRejected",
            origin: "https://example.com",
            reason: { tag: "WrongToken" },
          },
        ]),
      ).toMatchInlineSnapshot(
        `rejected web socket from "https://example.com": invalid security token`,
      );
    });
  });
});
