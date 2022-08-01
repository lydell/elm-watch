/**
 * @jest-environment jsdom
 */
import * as path from "path";

import { stringSnapshotSerializer, touch, wait, waitOneFrame } from "./Helpers";
import {
  assertCompilationMode,
  assertDebugDisabled,
  assertDebugger,
  cleanupBeforeEachTest,
  click,
  FIXTURES_DIR,
  runHotReload,
  switchCompilationMode,
} from "./HotHelpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

// Note: These tests excessively uses snapshots, since they don’t stop execution on failure.
// That results in a much better debugging experience (fewer timeouts).
describe("hot reloading", () => {
  beforeEach(cleanupBeforeEachTest);

  test("Html", async () => {
    const { replace, go } = runHotReload({
      name: "HtmlMain",
      programType: "Html",
      compilationMode: "standard",
    });

    let probe: HTMLElement | null = null;

    const { renders } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assertDebugDisabled();
          assertInit(div);
          replace((content) =>
            content.replace("hot reload", "simple text change")
          );
          return "KeepGoing";
        case 2:
          assertHotReload(div);
          replace((content) =>
            content.replace("simple text change", "hot reload")
          );
          return "KeepGoing";
        case 3:
          switchCompilationMode("optimize");
          return "KeepGoing";
        case 4:
          assertCompilationMode("optimize");
          assertDebugDisabled();
          assertInit(div);
          replace((content) =>
            content.replace("hot reload", "simple text change")
          );
          return "KeepGoing";
        default:
          assertHotReload(div);
          return "Stop";
      }
    });

    expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 HtmlMain
        ================================================================================
        ▼ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ 🔌 13:10:05 HtmlMain
        ================================================================================
        ▼ 🔌 13:10:05 HtmlMain
        ================================================================================
        ▼ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ✅ 13:10:05 HtmlMain
        ================================================================================
        target HtmlMain
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ▲ ✅ 13:10:05 HtmlMain
        ================================================================================
        ▼ ✅ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ✅ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ✅ 13:10:05 HtmlMain
        ================================================================================
        target HtmlMain
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ▲ ✅ 13:10:05 HtmlMain
        ================================================================================
        target HtmlMain
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize 🚀
        ▲ 🚀 ⏳ 13:10:05 HtmlMain
        ================================================================================
        target HtmlMain
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize 🚀
        ▲ 🚀 ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ 🚀 🔌 13:10:05 HtmlMain
        ================================================================================
        ▼ 🚀 🔌 13:10:05 HtmlMain
        ================================================================================
        ▼ 🚀 ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ 🚀 ✅ 13:10:05 HtmlMain
        ================================================================================
        target HtmlMain
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ Standard
        ◉ Optimize 🚀
        ▲ 🚀 ✅ 13:10:05 HtmlMain
        ================================================================================
        ▼ 🚀 ✅ 13:10:05 HtmlMain
        ================================================================================
        ▼ 🚀 ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ 🚀 ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ 🚀 ✅ 13:10:05 HtmlMain
      `);

    function assertInit(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><h1 class="probe">hot reload</h1></div>`
      );
      probe = div.querySelector(".probe");
      expect(probe?.outerHTML).toMatchInlineSnapshot(
        `<h1 class="probe">hot reload</h1>`
      );
    }

    function assertHotReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><h1 class="probe">simple text change</h1></div>`
      );
      expect(div.querySelector(".probe") === probe).toMatchInlineSnapshot(
        `true`
      );
    }
  });

  test.each([
    ["Sandbox", "standard"],
    ["Sandbox", "debug"],
    ["Sandbox", "optimize"],
    ["Element", "standard"],
    ["Element", "debug"],
    ["Element", "optimize"],
    ["Document", "standard"],
    ["Document", "debug"],
    ["Document", "optimize"],
    ["Application", "standard"],
    ["Application", "debug"],
    ["Application", "optimize"],
  ] as const)(
    "DOM and Msg change: %s / %s",
    async (programType, compilationMode) => {
      const { replace, go } = runHotReload({
        name: "DomAndMsgChange",
        programType,
        compilationMode,
      });

      let probe: HTMLElement | null = null;

      await go(async ({ idle, body, main }) => {
        switch (idle) {
          case 1:
            assertCompilationMode(compilationMode);
            if (compilationMode === "debug") {
              assertDebugger(body);
            }
            await assertInit(main);
            replace((content) =>
              content
                .replace("Before hot reload", "After hot reload")
                .replace(
                  "onClick OriginalButtonClicked",
                  "onClick NewButtonClicked"
                )
            );
            return "KeepGoing";
          default:
            await assertHotReload(main);
            return "Stop";
        }
      });

      async function assertInit(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 0
            newButtonClicked: 0
            </pre></main>
          `);

        probe = main.querySelector(".probe");
        expect(probe?.outerHTML).toMatchInlineSnapshot(
          `<h1 class="probe">Before hot reload</h1>`
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 0
            </pre></main>
          `);
      }

      async function assertHotReload(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 0
            </pre></main>
          `);

        expect(main.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `true`
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 1
            </pre></main>
          `);
      }
    }
  );

  test.each(["standard", "debug", "optimize"] as const)(
    "Application URL messages change: %s",
    async (compilationMode) => {
      const { replace, go } = runHotReload({
        name: "Application",
        programType: "Application",
        compilationMode,
      });

      await go(async ({ idle, main }) => {
        switch (idle) {
          case 1:
            await assertInit(main);
            replace((content) =>
              content
                .replace("Before hot reload", "After hot reload")
                .replace(
                  "onUrlRequest = OriginalUrlRequested",
                  "onUrlRequest = NewUrlRequested"
                )
                .replace(
                  "onUrlChange = OriginalUrlChanged",
                  "onUrlChange = NewUrlChanged"
                )
            );
            return "KeepGoing";
          default:
            await assertHotReload(main);
            return "Stop";
        }
      });

      async function assertInit(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/
            originalUrlRequested: 0
            originalUrlChanged: 0
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `);

        click(main, "a");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/link
            originalUrlRequested: 1
            originalUrlChanged: 1
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `);

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `);
      }

      async function assertHotReload(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `);

        click(main, "a");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/link
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 1
            newUrlChanged: 1
            </pre></main>
          `);

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 1
            newUrlChanged: 2
            </pre></main>
          `);
      }
    }
  );

  test.each([
    ["Element", "standard"],
    ["Element", "debug"],
    ["Element", "optimize"],
    ["Document", "standard"],
    ["Document", "debug"],
    ["Document", "optimize"],
    ["Application", "standard"],
    ["Application", "debug"],
    ["Application", "optimize"],
    ["Worker", "standard"],
    ["Worker", "optimize"],
  ] as const)("Port change: %s / %s", async (programType, compilationMode) => {
    const { replace, sendToElm, lastValueFromElm, go } = runHotReload({
      name: "PortChange",
      programType,
      compilationMode,
    });

    await go(async ({ idle }) => {
      switch (idle) {
        case 1:
          await assertInit();
          replace((content) =>
            content.replace("fromJs OriginalFromJs", "fromJs NewFromJs")
          );
          return "KeepGoing";
        default:
          await assertHotReload();
          return "Stop";
      }
    });

    async function assertInit(): Promise<void> {
      sendToElm(1);
      await waitOneFrame();
      expect(lastValueFromElm.value).toMatchInlineSnapshot(
        `Before hot reload: [1]`
      );
    }

    async function assertHotReload(): Promise<void> {
      sendToElm(2);
      await waitOneFrame();
      expect(lastValueFromElm.value).toMatchInlineSnapshot(
        `Before: [1]. After hot reload: [2]`
      );
    }
  });

  test.each([
    ["Element", "standard"],
    ["Element", "debug"],
    ["Element", "optimize"],
    ["Document", "standard"],
    ["Document", "debug"],
    ["Document", "optimize"],
    ["Application", "standard"],
    ["Application", "debug"],
    ["Application", "optimize"],
  ] as const)(
    "Add subscription: %s / %s",
    async (programType, compilationMode) => {
      const { replace, go } = runHotReload({
        name: "AddSubscription",
        programType,
        compilationMode,
      });

      const { browserConsole } = await go(async ({ idle, main }) => {
        switch (idle) {
          case 1:
            await assertInit(main);
            replace((content) =>
              content.replace(/-- /g, "").replace("Sub.none", "")
            );
            return "KeepGoing";
          default:
            if (compilationMode === "optimize") {
              await assertReloadForOptimize(main);
            } else {
              await assertHotReload(main);
            }
            return "Stop";
        }
      });

      if (compilationMode === "optimize") {
        assertBrowserConsoleOptimize();
      } else {
        assertBrowserConsole();
      }

      function assertBrowserConsole(): void {
        expect(browserConsole).toMatchInlineSnapshot(``);
      }

      function assertBrowserConsoleOptimize(): void {
        expect(browserConsole).toMatchInlineSnapshot(`
            elm-watch: I did a full page reload because record field mangling in optimize mode was different than last time.
            (target: AddSubscription)
          `);
      }

      async function assertInit(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>0</main>`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>-1</main>`);
      }

      async function assertHotReload(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>-1</main>`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>8</main>`);
      }

      async function assertReloadForOptimize(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>0</main>`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>9</main>`);
      }
    }
  );

  test("remove input file", async () => {
    const elmJsonPath = path.join(FIXTURES_DIR, "hot-reload", "elm.json");

    const { replace, removeInput, go } = runHotReload({
      name: "RemoveInput",
      programType: "Sandbox",
      compilationMode: "standard",
      isTTY: false,
    });

    const { terminal } = await go(async ({ idle, div }) => {
      switch (idle) {
        case 1:
          await assert1(div);
          removeInput();
          return "KeepGoing";
        case 2:
          touch(elmJsonPath);
          replace((content) =>
            content.replace("hot reload", "simple text change")
          );
          return "KeepGoing" as const;
        default:
          assert2(div);
          return "Stop";
      }
    });

    expect(terminal).toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ RemoveInput: elm make (typecheck only)
        ✅ RemoveInput⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ RemoveInput: elm make
        ✅ RemoveInput⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: RemoveInput⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: RemoveInput
        ℹ️ 13:10:05 Web socket connected for: RemoveInput⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
        🚨 RemoveInput

        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙Target: RemoveInput⧘

        You asked me to compile these inputs:

        src/RemoveInput.elm ⧙(/Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm⧘
        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ RemoveInput: elm make
        ✅ RemoveInput⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      `);

    async function assert1(div: HTMLDivElement): Promise<void> {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1>hot reload</h1><button>Button</button><pre>0</pre></div></div>`
      );

      click(div, "button");
      await waitOneFrame();
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1>hot reload</h1><button>Button</button><pre>1</pre></div></div>`
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1>simple text change</h1><button>Button</button><pre>1</pre></div></div>`
      );
    }
  });

  test("Flags change", async () => {
    let initCount = 0;

    const { replace, go } = runHotReload({
      name: "FlagsChange",
      programType: "Element",
      compilationMode: "standard",
      init: (node) => {
        initCount++;
        window.Elm?.FlagsChange?.init({
          node,
          flags: initCount === 1 ? { one: "one" } : { one: "one", two: 2 },
        });
      },
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assert1(div);
          replace((content) => content.replace(/-- /g, ""));
          return "KeepGoing";
        default:
          assert2(div);
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because the flags type in \`Elm.FlagsChange\` changed and now the passed flags aren't correct anymore. The idea is to try to run with new flags!
        This is the error:
        Problem with the given value:

        {
                "one": "one"
            }

        Expecting an OBJECT with a field named \`two\`
        (target: FlagsChange)
      `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>one</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>one 2</div>`);
    }
  });

  test.each(["standard", "debug", "optimize"] as const)(
    "Add Msg: %s",
    async (compilationMode) => {
      const { replace, go } = runHotReload({
        name: "AddMsg",
        programType: "Element",
        compilationMode,
      });

      const { browserConsole } = await go(async ({ idle, main }) => {
        switch (idle) {
          case 1:
            await assert1(main);
            replace((content) => content.replace(/-- /g, ""));
            return "KeepGoing";
          default:
            if (compilationMode === "debug") {
              await assert2Debug(main);
            } else {
              await assert2(main);
            }
            return "Stop";
        }
      });

      if (compilationMode === "debug") {
        assertBrowserConsoleDebug();
      } else {
        assertBrowserConsole();
      }

      function assertBrowserConsole(): void {
        expect(browserConsole).toMatchInlineSnapshot(``);
      }

      function assertBrowserConsoleDebug(): void {
        expect(browserConsole).toMatchInlineSnapshot(`
            elm-watch: I did a full page reload because the message type in \`Elm.AddMsg\` changed in debug mode ("debug metadata" changed).
            (target: AddMsg)
          `);
      }

      async function assert1(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>init</main>`);
        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>Msg1</main>`);
      }

      async function assert2(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>Msg1</main>`);
        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>AddedMsg</main>`);
      }

      async function assert2Debug(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>init</main>`);
        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(`<main>AddedMsg</main>`);
      }
    }
  );

  test("Init tweak value", async () => {
    const { replace, go } = runHotReload({
      name: "InitTweakValue",
      programType: "Element",
      compilationMode: "standard",
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assert1(div);
          replace((content) => content.replace(/-- /g, ""));
          return "KeepGoing";
        default:
          assert2(div);
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because \`Elm.InitTweakValue.init\` returned something different than last time. Let's start fresh!
        (target: InitTweakValue)
      `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>init</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>init_tweaked</div>`);
    }
  });

  test("Init new field", async () => {
    const { replace, go } = runHotReload({
      name: "InitNewField",
      programType: "Element",
      compilationMode: "standard",
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assert1(div);
          replace((content) => content.replace(/-- /g, ""));
          return "KeepGoing";
        default:
          assert2(div);
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because \`Elm.InitNewField.init\` returned something different than last time. Let's start fresh!
        (target: InitNewField)
      `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>field1</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>field1 with newField</div>`
      );
    }
  });

  describe("Init change cmd", () => {
    // eslint-disable-next-line no-console
    const originalConsoleInfo = console.info;

    afterEach(() => {
      // eslint-disable-next-line no-console
      console.info = originalConsoleInfo;
    });

    test("Init change cmd", async () => {
      const mockConsoleInfo = jest.fn();
      // eslint-disable-next-line no-console
      console.info = mockConsoleInfo;

      const { replace, lastValueFromElm, go } = runHotReload({
        name: "InitChangeCmd",
        programType: "Element",
        compilationMode: "standard",
      });

      const { browserConsole } = await go(({ idle }) => {
        switch (idle) {
          case 1:
            assert1();
            replace((content) =>
              content.replace("module", "port module").replace(/-- /g, "")
            );
            return "KeepGoing";
          default:
            assert2();
            return "Stop";
        }
      });

      expect(browserConsole).toMatchInlineSnapshot(`
          elm-watch: I did a full page reload because \`Elm.InitChangeCmd.init\` returned something different than last time. Let's start fresh!
          (target: InitChangeCmd)
        `);

      expect(mockConsoleInfo.mock.calls).toMatchInlineSnapshot(`
          Array [
            Array [
              elm-watch: A new port 'toJs' was added. You might want to reload the page!,
            ],
          ]
        `);

      function assert1(): void {
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`undefined`);
      }

      function assert2(): void {
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`sent on init!`);
      }
    });
  });

  test("Change program type", async () => {
    const { write, go } = runHotReload({
      name: "ChangeProgramType",
      programType: "Sandbox",
      compilationMode: "standard",
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assert1(div);
          write(2);
          return "KeepGoing";
        default:
          assert2(div);
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because \`Elm.ChangeProgramType.main\` changed from \`Browser.sandbox\` to \`Browser.element\`.
        (target: ChangeProgramType)
      `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Browser.sandbox</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Browser.element</div>`);
    }
  });

  test("View fails after hot reload", async () => {
    const { replace, go } = runHotReload({
      name: "ViewFailsAfterHotReload",
      programType: "Element",
      compilationMode: "standard",
    });

    const { browserConsole } = await go(async ({ idle, main }) => {
      switch (idle) {
        case 1:
          await assert1(main);
          replace((content) =>
            content
              .replace("Maybe Int", "Maybe String")
              .replace("String.fromInt", "String.toUpper")
              .replace("1337", '"Just"')
          );
          return "KeepGoing";
        default:
          await assert2(main);
          return "Stop";
      }
    });

    expect(
      browserConsole.replace(/(\n\s*at _String_toUpper).*(\n\s*at.+)*/, "$1")
    ).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because hot reload for \`Elm.ViewFailsAfterHotReload\` failed, probably because of incompatible model changes.
        This is the error:
        TypeError: str.toUpperCase is not a function
        TypeError: str.toUpperCase is not a function
            at _String_toUpper
        (target: ViewFailsAfterHotReload)
      `);

    async function assert1(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(`<main>Nothing</main>`);
      main.click();
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(`<main>1337</main>`);
    }

    async function assert2(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(`<main>Nothing</main>`);
      main.click();
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(`<main>JUST</main>`);
    }
  });

  test("Init with non-cancelable Task", async () => {
    const { replace, go } = runHotReload({
      name: "InitFocus",
      programType: "Element",
      compilationMode: "standard",
    });

    const { browserConsole } = await go(async ({ idle, div }) => {
      switch (idle) {
        case 1:
          await assert1(div);
          replace((content) => content.replace("Count:", "Hot count:"));
          return "KeepGoing";
        default:
          assert2(div);
          return "Stop";
      }
    });

    // This should not list any reloads. (It’s tricky because Elm mutates Tasks.)
    expect(browserConsole).toMatchInlineSnapshot(``);

    async function assert1(div: HTMLDivElement): Promise<void> {
      const button = div.querySelector("button");
      if (button === null) {
        throw new Error("Could not find button!");
      }
      expect(document.activeElement).toBe(button);
      expect(button.outerHTML).toMatchInlineSnapshot(
        `<button id="id">Count: 0</button>`
      );
      button.click();
      await waitOneFrame();
      expect(button.outerHTML).toMatchInlineSnapshot(
        `<button id="id">Count: 1</button>`
      );
    }

    function assert2(div: HTMLDivElement): void {
      const button = div.querySelector("button");
      if (button === null) {
        throw new Error("Could not find button!");
      }
      expect(document.activeElement).toBe(button);
      expect(button.outerHTML).toMatchInlineSnapshot(
        `<button id="id">Hot count: 1</button>`
      );
    }
  });

  describe("Init with cancelable Task", () => {
    // eslint-disable-next-line no-console
    const originalConsoleError = console.error;

    afterEach(() => {
      // eslint-disable-next-line no-console
      console.error = originalConsoleError;
    });

    test("Init with cancelable Task", async () => {
      const mockConsoleError = jest.fn();
      // eslint-disable-next-line no-console
      console.error = mockConsoleError;

      const { replace, go } = runHotReload({
        name: "InitHttp",
        programType: "Element",
        compilationMode: "standard",
      });

      const { browserConsole } = await go(async ({ idle, div }) => {
        switch (idle) {
          case 1:
            await assert1(div);
            replace((content) => content.replace("Count:", "Hot count:"));
            return "KeepGoing";
          default:
            assert2(div);
            return "Stop";
        }
      });

      // This should not list any reloads. (It’s tricky because Elm mutates Tasks.)
      expect(browserConsole).toMatchInlineSnapshot(``);

      async function assert1(div: HTMLDivElement): Promise<void> {
        const button = div.querySelector("button");
        if (button === null) {
          throw new Error("Could not find button!");
        }
        expect(button.outerHTML).toMatchInlineSnapshot(
          `<button>Count: 0</button>`
        );
        button.click();
        await waitOneFrame();
        expect(button.outerHTML).toMatchInlineSnapshot(
          `<button>Count: 1</button>`
        );
      }

      function assert2(div: HTMLDivElement): void {
        const button = div.querySelector("button");
        if (button === null) {
          throw new Error("Could not find button!");
        }
        expect(button.outerHTML).toMatchInlineSnapshot(
          `<button>Hot count: 1</button>`
        );

        // The HTTP request made in the test fails, and jsdom logs that using `console.error`.
        expect(mockConsoleError).toHaveBeenCalled();
      }
    });
  });

  describe("Html.Lazy", () => {
    // eslint-disable-next-line no-console
    const originalConsoleLog = console.log;

    afterEach(() => {
      // eslint-disable-next-line no-console
      console.log = originalConsoleLog;
    });

    test("Html.Lazy", async () => {
      const mockConsoleLog = jest.fn();
      // eslint-disable-next-line no-console
      console.log = (...args) => {
        if (
          typeof args[0] === "string" &&
          args[0].startsWith("ELM_LAZY_TEST")
        ) {
          mockConsoleLog(...args);
        } else {
          originalConsoleLog(...args);
        }
      };

      const { replace, go } = runHotReload({
        name: "Lazy",
        programType: "Element",
        compilationMode: "standard",
      });

      await go(async ({ idle, main }) => {
        switch (idle) {
          case 1:
            await assert1(main);
            replace((content) =>
              content.replace("Is divisible by", "HOT RELOADED $&")
            );
            return "KeepGoing";
          default:
            await assert2(main);
            return "Stop";
        }
      });

      expect(mockConsoleLog.mock.calls).toMatchInlineSnapshot(`
          Array [
            Array [
              ELM_LAZY_TEST isDivisible: True,
            ],
            Array [
              ELM_LAZY_TEST isDivisible: False,
            ],
            Array [
              ELM_LAZY_TEST isDivisible: False,
            ],
            Array [
              ELM_LAZY_TEST isDivisible: True,
            ],
          ]
        `);

      async function assert1(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><p>Number: 0</p><p>Is divisible by 4? Yes.</p></main>`
        );
        expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`1`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><p>Number: 1</p><p>Is divisible by 4? No.</p></main>`
        );
        expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`2`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><p>Number: 2</p><p>Is divisible by 4? No.</p></main>`
        );
        expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`2`);
      }

      async function assert2(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><p>Number: 2</p><p>HOT RELOADED Is divisible by 4? No.</p></main>`
        );
        expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`3`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><p>Number: 3</p><p>HOT RELOADED Is divisible by 4? No.</p></main>`
        );
        expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`3`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><p>Number: 4</p><p>HOT RELOADED Is divisible by 4? Yes.</p></main>`
        );
        expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`4`);
      }
    });
  });

  test("Html.map", async () => {
    const { replace, go } = runHotReload({
      name: "Map",
      programType: "Element",
      compilationMode: "standard",
    });

    await go(async ({ idle, main }) => {
      switch (idle) {
        case 1:
          await assert1(main);
          replace((content) => content.replace("Count", "HOT RELOADED $&"));
          return "KeepGoing";
        case 2:
          await assert2(main);
          replace((content) => content.replace("(*) 2", "(+) 2"));
          return "KeepGoing";
        case 3:
          await assert3(main);
          replace((content) =>
            content
              .replace("Html.map Clicked", "Html.map NewClicked")
              .replace(/-- /g, "")
          );
          return "KeepGoing";
        case 4:
          await assert4(main);
          replace((content) =>
            content
              .replace("onClick 1", "onClick (NewClicked 5)")
              .replace(/\|> Html\.map .+/g, "")
          );
          return "KeepGoing";
        default:
          await assert5(main);
          return "Stop";
      }
    });

    async function assert1(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>Count: 0</button></main>`
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>Count: 2</button></main>`
      );
    }

    async function assert2(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 2</button></main>`
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 4</button></main>`
      );
    }

    async function assert3(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 4</button></main>`
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 7</button></main>`
      );
    }

    async function assert4(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 7</button></main>`
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 4</button></main>`
      );
    }

    async function assert5(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 4</button></main>`
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: -1</button></main>`
      );
    }
  });

  describe("Unexpected/unhandled error at eval", () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPromiseReject = Promise.reject;
    afterEach(() => {
      Promise.reject = originalPromiseReject;
    });

    test("Unexpected/unhandled error at eval", async () => {
      const error = new Error("Very unexpected error");

      const mockPromiseReject = jest.fn();

      Promise.reject = <T>(reason: unknown): Promise<T> => {
        if (reason === error) {
          mockPromiseReject(reason);
          return undefined as unknown as Promise<T>;
        } else {
          return originalPromiseReject.call(Promise, reason) as Promise<T>;
        }
      };

      const { replace, go } = runHotReload({
        name: "HtmlMain",
        programType: "Html",
        compilationMode: "standard",
        expandUiImmediately: true,
      });

      const { renders } = await go(({ idle, div }) => {
        switch (idle) {
          case 1:
            assertInit(div);
            Object.defineProperty(window.Elm?.HtmlMain, "__elmWatchApps", {
              get() {
                throw error;
              },
            });
            replace((content) =>
              content.replace("hot reload", "simple text change")
            );
            return "KeepGoing";
          default:
            assertInit(div);
            return "Stop";
        }
      });

      expect(renders).toMatchInlineSnapshot(`
          ▼ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Connecting
          attempt 1
          sleep 1.01 seconds
          [Connecting web socket…]
          ▲ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          Compilation mode
          ◯ (disabled) Debug The Elm debugger isn't available at this point.
          ◯ (disabled) Standard
          ◯ (disabled) Optimize
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          Compilation mode
          ◯ (disabled) Debug The Elm debugger isn't available at this point.
          ◉ (disabled) Standard
          ◯ (disabled) Optimize
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          ▼ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Connecting
          attempt 1
          sleep 1.01 seconds
          [Connecting web socket…]
          ▲ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Connecting
          attempt 1
          sleep 1.01 seconds
          [Connecting web socket…]
          ▲ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          Compilation mode
          ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
          ◉ (disabled) Standard
          ◯ (disabled) Optimize
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Successfully compiled
          Compilation mode
          ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
          ◉ Standard
          ◯ Optimize
          ▲ ✅ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          window.Elm does not look like expected! This is the error message:
          At root["Elm"]["HtmlMain"]["__elmWatchApps"]:
          Very unexpected error
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          window.Elm does not look like expected! This is the error message:
          At root["Elm"]["HtmlMain"]["__elmWatchApps"]:
          Very unexpected error
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Eval error
          Check the console in the browser developer tools to see errors!
          ▲ ⛔️ 13:10:05 HtmlMain
        `);

      expect(mockPromiseReject.mock.calls).toMatchInlineSnapshot(`
          Array [
            Array [
              [Error: Very unexpected error],
            ],
          ]
        `);

      function assertInit(div: HTMLDivElement): void {
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div><h1 class="probe">hot reload</h1></div>`
        );
      }
    });
  });

  test("One target is active, one is idle (outputsWithoutAction)", async () => {
    const { go } = runHotReload({
      name: "OutputsWithoutAction",
      programType: "Html",
      compilationMode: "standard",
    });

    const { terminal } = await go(() => "Stop");

    expect(terminal).toMatchInlineSnapshot(`
      ✅ OutputsWithoutAction⧙                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ✅ OutputsWithoutActionOther1

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: OutputsWithoutAction
      ℹ️ 13:10:05 Web socket connected for: OutputsWithoutAction⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);
  });

  test("Multiple targets with batched reload messages", async () => {
    const { replace, go } = runHotReload({
      name: "MultipleTargets",
      programType: "Element",
      compilationMode: "debug",
      expandUiImmediately: true,
      includeProxyReloads: true,
      extraScripts: ["MultipleTargetsOther1.js"],
      extraElmWatchStuffJson: {
        MultipleTargetsOther1: {
          compilationMode: "debug",
        },
      },
      init: (node) => {
        const node1 = document.createElement("div");
        const node2 = document.createElement("div");
        node.append(node1, node2);
        window.Elm?.MultipleTargets?.init({ node: node1 });
        window.Elm?.MultipleTargetsOther1?.init({ node: node2 });
      },
    });

    const { renders, browserConsole } = await go(({ idle }) => {
      switch (idle) {
        case 1:
          return "KeepGoing"; // First script has loaded.
        case 2:
          replace((content) => content.replace(/RenameMe/g, "Renamed"));
          return "KeepGoing";
        case 3:
          return "KeepGoing"; // First script has reloaded.
        default:
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
        Proxy file reload!

        elm-watch: I did a full page reload because:

        MultipleTargets
        - the message type in \`Elm.MultipleTargets\` changed in debug mode ("debug metadata" changed).

        MultipleTargetsOther1
        - the message type in \`Elm.MultipleTargetsOther1\` changed in debug mode ("debug metadata" changed).
      `);

    expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't available at this point.
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛 The Elm debugger isn't available at this point.
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛 The Elm debugger isn't available at this point.
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛 The Elm debugger isn't available at this point.
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛 The Elm debugger isn't available at this point.
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for reload
        Waiting for other targets to finish compiling…
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🐛 🔌 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug 🐛
        ◯ Standard
        ◯ Optimize
        ▲ 🐛 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug 🐛
        ◯ Standard
        ◯ Optimize
        ▲ 🐛 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug 🐛
        ◯ Standard
        ◯ Optimize
        ▲ 🐛 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ✅ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ✅ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        target MultipleTargetsOther1
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for reload
        Waiting for other targets to finish compiling…
        ▲ 🐛 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        target MultipleTargetsOther1
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for reload
        Waiting for other targets to finish compiling…
        ▲ 🐛 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for reload
        Waiting for other targets to finish compiling…
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🐛 🔌 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🐛 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug 🐛
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🐛 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug 🐛
        ◯ Standard
        ◯ Optimize
        ▲ 🐛 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug 🐛
        ◯ Standard
        ◯ Optimize
        ▲ 🐛 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug 🐛
        ◯ Standard
        ◯ Optimize
        ▲ 🐛 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🐛 ✅ 13:10:05 MultipleTargetsOther1
      `);
  });

  test("Change Elm file while `elm make` is running", async () => {
    const { replace, go } = runHotReload({
      name: "InterruptElm",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
      bin: "delay",
    });

    const { terminal } = await go(async ({ idle, div }) => {
      switch (idle) {
        case 1:
          assertInit(div);
          replace((content) => content.replace("1", "2"));
          await wait(60);
          replace((content) => content.replace("2", "3"));
          return "KeepGoing";
        default:
          assertHotReload(div);
          return "Stop";
      }
    });

    expect(terminal).toMatchInlineSnapshot(`
        ⏳ InterruptElm: elm make (typecheck only)
        ✅ InterruptElm⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ InterruptElm: elm make
        ✅ InterruptElm⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: InterruptElm⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: InterruptElm
        ℹ️ 13:10:05 Web socket connected for: InterruptElm⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
        ⏳ InterruptElm: elm make
        ⏳ InterruptElm: interrupted
        ⏳ InterruptElm: elm make
        ✅ InterruptElm⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/hot-reload/src/InterruptElm.elm
        ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/hot-reload/src/InterruptElm.elm⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      `);

    function assertInit(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Text1</div>`);
    }

    function assertHotReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Text3</div>`);
    }
  });

  test("Restart while `elm make` is running", async () => {
    const elmJsonPath = path.join(FIXTURES_DIR, "hot-reload", "elm.json");

    const { replace, go } = runHotReload({
      name: "InterruptElm",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
      bin: "delay",
    });

    const { terminal } = await go(async ({ idle }) => {
      switch (idle) {
        case 1:
          replace((content) => content.replace("1", "2"));
          await wait(60);
          touch(elmJsonPath);
          return "KeepGoing";
        default:
          return "Stop";
      }
    });

    expect(terminal).toMatchInlineSnapshot(`
        ⏳ InterruptElm: elm make (typecheck only)
        ✅ InterruptElm⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ InterruptElm: elm make
        ✅ InterruptElm⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: InterruptElm⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: InterruptElm
        ℹ️ 13:10:05 Web socket connected for: InterruptElm⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
        ⏳ InterruptElm: elm make
        ⏳ InterruptElm: interrupted
        ⏳ InterruptElm: elm make
        ✅ InterruptElm⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/hot-reload/src/InterruptElm.elm
        ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/hot-reload/elm.json⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("Restart while installing dependencies", async () => {
    const elmJsonPath = path.join(FIXTURES_DIR, "hot-reload", "elm.json");

    const { go } = runHotReload({
      name: "InterruptElm",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
      bin: "delay",
    });

    const [{ terminal }] = await Promise.all([
      go(() => "Stop"),
      (async () => {
        await wait(60);
        touch(elmJsonPath);
      })(),
    ]);

    expect(terminal).toMatchInlineSnapshot(`
        ⏳ InterruptElm: elm make (typecheck only)
        ✅ InterruptElm⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/hot-reload/elm.json⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ InterruptElm: elm make
        ✅ InterruptElm⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: InterruptElm⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: InterruptElm
        ℹ️ 13:10:05 Web socket connected for: InterruptElm⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);
  });

  test("Switching to optimize mode with Debug.log and switching back", async () => {
    const { go } = runHotReload({
      name: "DebugLog",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
    });

    const { terminal, renders } = await go(({ idle }) => {
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

    expect(terminal).toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ DebugLog: elm make (typecheck only)
        ✅ DebugLog⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ DebugLog: elm make
        ✅ DebugLog⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: DebugLog⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: DebugLog
        ℹ️ 13:10:05 Web socket connected for: DebugLog⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
        ⏳ DebugLog: elm make --optimize
        🚨 DebugLog

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

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Changed compilation mode to "optimize" of: DebugLog⧘
        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ DebugLog: elm make
        ✅ DebugLog⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Changed compilation mode to "standard" of: DebugLog⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      `);

    expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 DebugLog
        ================================================================================
        ▼ ⏳ 13:10:05 DebugLog
        ================================================================================
        ▼ ⏳ 13:10:05 DebugLog
        ================================================================================
        ▼ 🔌 13:10:05 DebugLog
        ================================================================================
        ▼ 🔌 13:10:05 DebugLog
        ================================================================================
        ▼ ⏳ 13:10:05 DebugLog
        ================================================================================
        ▼ ✅ 13:10:05 DebugLog
        ================================================================================
        target DebugLog
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ▲ ✅ 13:10:05 DebugLog
        ================================================================================
        target DebugLog
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize 🚀
        ▲ 🚀 ⏳ 13:10:05 DebugLog
        ================================================================================
        target DebugLog
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize 🚀
        ▲ 🚀 ⏳ 13:10:05 DebugLog
        ================================================================================
        target DebugLog
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Compilation error
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ Standard
        ◉ Optimize 🚀 Note: The code currently running is in standard mode.
        Check the terminal to see errors!
        ▲ 🚀 🚨 13:10:05 DebugLog
        ================================================================================
        target DebugLog
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 DebugLog
        ================================================================================
        target DebugLog
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 DebugLog
        ================================================================================
        target DebugLog
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 DebugLog
        ================================================================================
        target DebugLog
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ▲ ✅ 13:10:05 DebugLog
      `);
  });

  test("Changed record fields in optimize with postprocess", async () => {
    const { replace, go } = runHotReload({
      fixture: "hot-reload-postprocess",
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
        `<div>Text and new text</div>`
      );
    }
  });

  test("Connect while compiling", async () => {
    const { go } = runHotReload({
      fixture: "hot-reload-postprocess",
      name: "SlowPostprocess",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
    });

    const { terminal, browserConsole } = await go(async ({ idle }) => {
      switch (idle) {
        case 1:
          switchCompilationMode("optimize");
          await wait(200);
          window.__ELM_WATCH_DISCONNECT(/^SlowPostprocess$/);
          return "KeepGoing";
        default:
          return "Stop";
      }
    });

    expect(terminal).toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ SlowPostprocess: elm make (typecheck only)
        ✅ SlowPostprocess⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙elm-watch-node workers:⧘ 1
        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
        ⏳ SlowPostprocess: elm make
        🟢 SlowPostprocess: elm make done
        ⏳ SlowPostprocess: postprocess
        ✅ SlowPostprocess⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

        📊 ⧙elm-watch-node workers:⧘ 1
        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: SlowPostprocess⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙elm-watch-node workers:⧘ 1
        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: SlowPostprocess
        ℹ️ 13:10:05 Web socket connected for: SlowPostprocess⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
        ⏳ SlowPostprocess: elm make --optimize
        🟢 SlowPostprocess: elm make done
        ⏳ SlowPostprocess: postprocess
        ✅ SlowPostprocess⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

        📊 ⧙elm-watch-node workers:⧘ 1
        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Changed compilation mode to "optimize" of: SlowPostprocess
        ℹ️ 13:10:05 Web socket disconnected for: SlowPostprocess
        ℹ️ 13:10:05 Web socket connected needing compilation of: SlowPostprocess⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

        📊 ⧙elm-watch-node workers:⧘ 1
        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: SlowPostprocess
        ℹ️ 13:10:05 Web socket connected for: SlowPostprocess⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

    expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because compilation mode changed from standard to optimize.
        (target: SlowPostprocess)
      `);
  });
});
