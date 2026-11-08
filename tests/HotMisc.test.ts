// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, onTestFinished, test } from "vitest";

import { type LatestEvent, printTimeline } from "../src/Hot.ts";
import type { LoggerConfig } from "../src/Logger.ts";
import { markAsAbsolutePath, markAsTargetName } from "../src/Types.ts";
import {
  clean,
  CtrlCReadStream,
  grep,
  onlyErrorMessages,
  rmSymlink,
  SilentReadStream,
  stringSnapshotSerializer,
  testExceptWindows,
  touch,
  wait,
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

      📊 ⧙server:⧘ http://localhost:59123
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

  test("exit when stdin ends, using signal", async () => {
    const stdin = new SilentReadStream();
    // This is how the removed ELM_WATCH_EXIT_ON_STDIN_END works nowadays.
    const controller = new AbortController();
    stdin.on("end", () => {
      controller.abort();
    });
    stdin.resume();
    const { terminal, renders } = await run({
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
      ✅ TargetDisabled
      ✅ SendBadJson
      ✅ Reconnect
      ✅ HttpCaching
      ✅ "Esc\\apes"

      📊 ⧙server:⧘ http://localhost:59123
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
    const elmJsonPath = path.join(fixtureDir(fixture), "elm.json");

    const { terminal } = await run({
      fixture: path.join(fixture, "example"),
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: ({ idle, stdout }) => {
        switch (idle) {
          case 1:
            // Make room for the long absolute path in the timeline, so it isn’t
            // truncated before being replaced with a stable path.
            stdout.resize(1000);
            touch(elmJsonPath);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ Main⧙                                                      1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/elm-json-above-elm-watch-json/elm.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
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
      onIdle: ({ idle, stdout }) => {
        switch (idle) {
          case 1:
            // Make room for the long absolute path in the timeline, so it isn’t
            // truncated before being replaced with a stable path.
            stdout.resize(1000);
            touch(elmFile);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                                      1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙server:⧘ http://localhost:59123
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
          rows: 24,
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
        eventName: "changed",
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
        ℹ️ ⧙00:01:24⧘ ⧙Changed /Three.elm⧘
      `);
    });

    test("5 events", () => {
      expect(print(events.slice(0, 5))).toMatchInlineSnapshot(`
        ℹ️ ⧙23:59:05⧘ ⧙Changed /One.elm⧘
        ℹ️ ⧙00:00:11⧘ ⧙Web socket connected needing compilation of: One⧘
        ℹ️ ⧙00:01:23⧘ ⧙Removed /Two.elm⧘
        ℹ️ ⧙00:01:24⧘ ⧙Changed /Three.elm⧘
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

    test("truncated to terminal width", () => {
      expect(print(events.slice(0, 2), { columns: 30 })).toMatchInlineSnapshot(`
        ℹ️ ⧙23:59:05⧘ ⧙Changed /One.elm⧘
        ℹ️ ⧙00:00:11⧘ ⧙Web socket connec⧘…
      `);
    });

    test("truncated to terminal width, non-fancy", () => {
      expect(print(events.slice(0, 2), { columns: 30, fancy: false }))
        .toMatchInlineSnapshot(`
        ⧙23:59:05⧘ ⧙Changed /One.elm⧘
        ⧙00:00:11⧘ ⧙Web socket connect⧘...
      `);
    });

    test("truncated in the middle of the time", () => {
      expect(print(events.slice(0, 1), { columns: 8 })).toMatchInlineSnapshot(
        `ℹ️ ⧙23:5⧘…`,
      );
    });
  });
});
