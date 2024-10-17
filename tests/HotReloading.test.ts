// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";

import { __ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS } from "../src/Env";
import {
  grep,
  onlyErrorMessages,
  removeIndents,
  rimraf,
  stringSnapshotSerializer,
  TerminalColorReadStream,
  testExceptWindows,
  touch,
  wait,
  waitOneFrame,
} from "./Helpers";
import {
  assertCompilationMode,
  assertDebugDisabled,
  assertDebugger,
  cleanupAfterEachTest,
  click,
  closeOverlay,
  expandUi,
  FIXTURES_DIR,
  getOverlay,
  hideErrors,
  runHotReload,
  showErrors,
  switchCompilationMode,
} from "./HotHelpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot reloading", () => {
  afterEach(cleanupAfterEachTest);

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
            content.replace("hot reload", "simple text change"),
          );
          return "KeepGoing";
        case 2:
          assertHotReload(div);
          replace((content) =>
            content.replace("simple text change", "hot reload"),
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
            content.replace("hot reload", "simple text change"),
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
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      expect(div.outerHTML).toStrictEqual(
        `<div><h1 class="probe">hot reload</h1></div>`,
      );
      probe = div.querySelector(".probe");
      expect(probe?.outerHTML).toStrictEqual(
        `<h1 class="probe">hot reload</h1>`,
      );
    }

    function assertHotReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toStrictEqual(
        `<div><h1 class="probe">simple text change</h1></div>`,
      );
      expect(div.querySelector(".probe")).toBe(probe);
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
                  "onClick NewButtonClicked",
                ),
            );
            return "KeepGoing";
          default:
            await assertHotReload(main);
            return "Stop";
        }
      });

      async function assertInit(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 0
            newButtonClicked: 0
            </pre></main>
          `),
        );

        probe = main.querySelector(".probe");
        expect(probe?.outerHTML).toStrictEqual(
          removeIndents(`<h1 class="probe">Before hot reload</h1>`),
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 0
            </pre></main>
          `),
        );
      }

      async function assertHotReload(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">After hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 0
            </pre></main>
          `),
        );

        expect(main.querySelector(".probe")).toBe(probe);

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">After hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 1
            </pre></main>
          `),
        );
      }
    },
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
                  "onUrlRequest = NewUrlRequested",
                )
                .replace(
                  "onUrlChange = OriginalUrlChanged",
                  "onUrlChange = NewUrlChanged",
                ),
            );
            return "KeepGoing";
          default:
            await assertHotReload(main);
            return "Stop";
        }
      });

      async function assertInit(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/
            originalUrlRequested: 0
            originalUrlChanged: 0
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `),
        );

        click(main, "a");
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/link
            originalUrlRequested: 1
            originalUrlChanged: 1
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `),
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `),
        );
      }

      async function assertHotReload(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `),
        );

        click(main, "a");
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/link
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 1
            newUrlChanged: 1
            </pre></main>
          `),
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(
          removeIndents(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 1
            newUrlChanged: 2
            </pre></main>
          `),
        );
      }
    },
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
            content.replace("fromJs OriginalFromJs", "fromJs NewFromJs"),
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
      expect(lastValueFromElm.value).toStrictEqual(
        removeIndents(`Before hot reload: [1]`),
      );
    }

    async function assertHotReload(): Promise<void> {
      sendToElm(2);
      await waitOneFrame();
      expect(lastValueFromElm.value).toStrictEqual(
        removeIndents(`Before: [1]. After hot reload: [2]`),
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
              content.replace(/-- /g, "").replace("Sub.none", ""),
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
        expect(browserConsole).toStrictEqual("");
      }

      function assertBrowserConsoleOptimize(): void {
        expect(browserConsole).toStrictEqual(
          removeIndents(`
            elm-watch: I did a full page reload because record field mangling in optimize mode was different than last time.
            (target: AddSubscription)
          `),
        );
      }

      async function assertInit(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(`<main>0</main>`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(`<main>-1</main>`);
      }

      async function assertHotReload(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(`<main>-1</main>`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(`<main>8</main>`);
      }

      async function assertReloadForOptimize(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(`<main>0</main>`);

        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(`<main>9</main>`);
      }
    },
  );

  test("Program types that do and don’t support the debugger in the same output", async () => {
    const container = document.createElement("div");
    onTestFinished(() => {
      container.remove();
    });

    let sendToWorker = (): void => {
      throw new Error("sendToWorker was never reassigned.");
    };

    const { replace, go } = runHotReload({
      name: "AllProgramTypes",
      programType: "Element",
      compilationMode: "debug",
      init: () => {
        const base = window.Elm?.["AllProgramTypes"];
        if (base === undefined) {
          throw new Error("Could not find Elm.AllProgramTypes.");
        }

        document.documentElement.appendChild(container);

        for (const appName of [
          "HtmlProgram",
          "SandboxProgram",
          "ElementProgram",
        ] as const) {
          const node = document.createElement("div");
          container.append(node);
          base[appName]?.init({ node });
        }

        base["ApplicationProgram"]?.init();

        const workerNode = document.createElement("p");
        container.append(workerNode);
        const workerApp = base["WorkerProgram"]?.init();
        if (workerApp?.ports === undefined) {
          throw new Error("WorkerProgram should have ports.");
        }
        const subscribe = workerApp.ports["output"]?.subscribe;
        if (subscribe === undefined) {
          throw new Error(
            "WorkerProgram app.ports.output.subscribe should exist.",
          );
        }
        subscribe((value: unknown) => {
          workerNode.textContent = String(value);
        });
        const send = workerApp.ports["input"]?.send;
        if (send === undefined) {
          throw new Error("WorkerProgram app.ports.input.send should exist.");
        }
        sendToWorker = () => {
          send(null);
        };
        sendToWorker();

        return undefined;
      },
    });

    await go(({ idle, body }) => {
      switch (idle) {
        case 1:
          assertDebugger(body);
          assert1(body);
          replace((content) => content.replace("(1)", "(2)"));
          return "KeepGoing";
        default:
          sendToWorker();
          assert2(body);
          return "Stop";
      }
    });

    function assert1(body: HTMLBodyElement): void {
      expect(removeDebugger(body)).toMatchInlineSnapshot(
        `<body><p>ApplicationProgram (1)</p></body>`,
      );

      expect(removeDebugger(container)).toMatchInlineSnapshot(
        `<div><p>HtmlProgram (1)</p><p>SandboxProgram (1)</p><p>ElementProgram (1)</p><p>WorkerProgram (1)</p></div>`,
      );
    }

    function assert2(body: HTMLBodyElement): void {
      expect(removeDebugger(body)).toMatchInlineSnapshot(
        `<body><p>ApplicationProgram (2)</p></body>`,
      );

      expect(removeDebugger(container)).toMatchInlineSnapshot(
        `<div><p>HtmlProgram (2)</p><p>SandboxProgram (2)</p><p>ElementProgram (2)</p><p>WorkerProgram (2)</p></div>`,
      );
    }

    function removeDebugger(element: HTMLElement): string {
      const clone = element.cloneNode(true) as HTMLElement;
      // In this test, we know that we render no `<div>`s, so all `<div>`s must be debugger elements.
      for (const div of clone.querySelectorAll("div")) {
        div.remove();
      }
      return clone.outerHTML;
    }
  });

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
            content.replace("hot reload", "simple text change"),
          );
          return "KeepGoing" as const;
        default:
          assert2(div);
          return "Stop";
      }
    });

    expect(onlyErrorMessages(terminal)).toMatchInlineSnapshot(`
      ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
      ⧙Target: RemoveInput⧘

      You asked me to compile these inputs:

      src/RemoveInput.elm ⧙(/Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm)⧘

      ⧙But they don't exist!⧘

      Is something misspelled? Or do you need to create them?
    `);

    async function assert1(div: HTMLDivElement): Promise<void> {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1>hot reload</h1><button>Button</button><pre>0</pre></div></div>`,
      );

      click(div, "button");
      await waitOneFrame();
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1>hot reload</h1><button>Button</button><pre>1</pre></div></div>`,
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1>simple text change</h1><button>Button</button><pre>1</pre></div></div>`,
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
        return window.Elm?.["FlagsChange"]?.init({
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
        expect(browserConsole).toStrictEqual("");
      }

      function assertBrowserConsoleDebug(): void {
        expect(browserConsole).toStrictEqual(
          removeIndents(`
            elm-watch: I did a full page reload because the message type in \`Elm.AddMsg\` changed in debug mode ("debug metadata" changed).
            (target: AddMsg)
          `),
        );
      }

      async function assert1(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(`<main>init</main>`);
        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(`<main>Msg1</main>`);
      }

      async function assert2(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(`<main>Msg1</main>`);
        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(`<main>AddedMsg</main>`);
      }

      async function assert2Debug(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toStrictEqual(`<main>init</main>`);
        main.click();
        await waitOneFrame();
        expect(main.outerHTML).toStrictEqual(`<main>AddedMsg</main>`);
      }
    },
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
        `<div>field1 with newField</div>`,
      );
    }
  });

  test("Init change cmd / Add port used in init", async () => {
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
            content.replace("module", "port module").replace(/-- /g, ""),
          );
          return "KeepGoing";
        default:
          assert2();
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
      elm-watch: I did a full page reload because:

      InitChangeCmd
      - a new port 'toJs' was added. The idea is to give JavaScript code a chance to set it up!
      - \`Elm.InitChangeCmd.init\` returned something different than last time. Let's start fresh!
    `);

    function assert1(): void {
      expect(lastValueFromElm.value).toMatchInlineSnapshot(`undefined`);
    }

    function assert2(): void {
      expect(lastValueFromElm.value).toMatchInlineSnapshot(`sent on init!`);
    }
  });

  test("Add port used in update", async () => {
    const { replace, lastValueFromElm, go } = runHotReload({
      name: "AddPortUsedInUpdate",
      programType: "Element",
      compilationMode: "standard",
    });

    const { browserConsole } = await go(async ({ idle, main }) => {
      switch (idle) {
        case 1:
          assert1();
          replace((content) =>
            content.replace("module", "port module").replace(/-- /g, ""),
          );
          return "KeepGoing";
        default:
          main.click();
          await waitOneFrame();
          assert2();
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
      elm-watch: I did a full page reload because a new port 'toJs' was added. The idea is to give JavaScript code a chance to set it up!
      (target: AddPortUsedInUpdate)
    `);

    function assert1(): void {
      expect(lastValueFromElm.value).toMatchInlineSnapshot(`undefined`);
    }

    function assert2(): void {
      expect(lastValueFromElm.value).toMatchInlineSnapshot(`sent in update!`);
    }
  });

  test("Add port used in subscriptions", async () => {
    const { replace, sendToElm, go } = runHotReload({
      name: "AddPortUsedInSubscriptions",
      programType: "Element",
      compilationMode: "standard",
      init: (node) =>
        window.Elm?.["AddPortUsedInSubscriptions"]?.init({ node }),
    });

    const { browserConsole } = await go(async ({ idle, main }) => {
      switch (idle) {
        case 1:
          assert1(main);
          replace((content) =>
            content.replace("module", "port module").replace(/-- /g, ""),
          );
          return "KeepGoing";
        default:
          sendToElm(1337);
          await waitOneFrame();
          assert2(main);
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
      elm-watch: I did a full page reload because a new port 'fromJs' was added. The idea is to give JavaScript code a chance to set it up!
      (target: AddPortUsedInSubscriptions)
    `);

    function assert1(main: HTMLElement): void {
      expect(main.outerHTML).toMatchInlineSnapshot(`<main>0</main>`);
    }

    function assert2(main: HTMLElement): void {
      expect(main.outerHTML).toMatchInlineSnapshot(`<main>1337</main>`);
    }
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
              .replace("1337", '"Just"'),
          );
          return "KeepGoing";
        default:
          await assert2(main);
          return "Stop";
      }
    });

    expect(
      browserConsole.replace(/(\n\s*at _String_toUpper).*(\n\s*at.+)*/, "$1"),
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
        `<button id="id">Count: 0</button>`,
      );
      button.click();
      await waitOneFrame();
      expect(button.outerHTML).toMatchInlineSnapshot(
        `<button id="id">Count: 1</button>`,
      );
    }

    function assert2(div: HTMLDivElement): void {
      const button = div.querySelector("button");
      if (button === null) {
        throw new Error("Could not find button!");
      }
      expect(document.activeElement).toBe(button);
      expect(button.outerHTML).toMatchInlineSnapshot(
        `<button id="id">Hot count: 1</button>`,
      );
    }
  });

  test("Init with cancelable Task", async () => {
    // eslint-disable-next-line no-console
    const originalConsoleError = console.error;

    onTestFinished(() => {
      // eslint-disable-next-line no-console
      console.error = originalConsoleError;
    });

    // The HTTP request made in the test fails, and jsdom logs that using `console.error`.
    // eslint-disable-next-line no-console
    console.error = () => {
      // Do nothing.
    };

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
        `<button>Count: 0</button>`,
      );
      button.click();
      await waitOneFrame();
      expect(button.outerHTML).toMatchInlineSnapshot(
        `<button>Count: 1</button>`,
      );
    }

    function assert2(div: HTMLDivElement): void {
      const button = div.querySelector("button");
      if (button === null) {
        throw new Error("Could not find button!");
      }
      expect(button.outerHTML).toMatchInlineSnapshot(
        `<button>Hot count: 1</button>`,
      );
    }
  });

  test("Html.Lazy", async () => {
    // eslint-disable-next-line no-console
    const originalConsoleLog = console.log;

    onTestFinished(() => {
      // eslint-disable-next-line no-console
      console.log = originalConsoleLog;
    });

    const mockConsoleLog = vi.fn();
    // eslint-disable-next-line no-console
    console.log = (...args) => {
      if (typeof args[0] === "string" && args[0].startsWith("ELM_LAZY_TEST")) {
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
            content.replace("Is divisible by", "HOT RELOADED $&"),
          );
          return "KeepGoing";
        default:
          await assert2(main);
          return "Stop";
      }
    });

    expect(mockConsoleLog.mock.calls).toMatchInlineSnapshot(`
        [
          [
            ELM_LAZY_TEST isDivisible: True,
          ],
          [
            ELM_LAZY_TEST isDivisible: False,
          ],
          [
            ELM_LAZY_TEST isDivisible: False,
          ],
          [
            ELM_LAZY_TEST isDivisible: True,
          ],
        ]
      `);

    async function assert1(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><p>Number: 0</p><p>Is divisible by 4? Yes.</p></main>`,
      );
      expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`1`);

      main.click();
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><p>Number: 1</p><p>Is divisible by 4? No.</p></main>`,
      );
      expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`2`);

      main.click();
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><p>Number: 2</p><p>Is divisible by 4? No.</p></main>`,
      );
      expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`2`);
    }

    async function assert2(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><p>Number: 2</p><p>HOT RELOADED Is divisible by 4? No.</p></main>`,
      );
      expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`3`);

      main.click();
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><p>Number: 3</p><p>HOT RELOADED Is divisible by 4? No.</p></main>`,
      );
      expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`3`);

      main.click();
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><p>Number: 4</p><p>HOT RELOADED Is divisible by 4? Yes.</p></main>`,
      );
      expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`4`);
    }
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
              .replace(/-- /g, ""),
          );
          return "KeepGoing";
        case 4:
          await assert4(main);
          replace((content) =>
            content
              .replace("onClick 1", "onClick (NewClicked 5)")
              .replace(/\|> Html\.map .+/g, ""),
          );
          return "KeepGoing";
        default:
          await assert5(main);
          return "Stop";
      }
    });

    async function assert1(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>Count: 0</button></main>`,
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>Count: 2</button></main>`,
      );
    }

    async function assert2(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 2</button></main>`,
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 4</button></main>`,
      );
    }

    async function assert3(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 4</button></main>`,
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 7</button></main>`,
      );
    }

    async function assert4(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 7</button></main>`,
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 4</button></main>`,
      );
    }

    async function assert5(main: HTMLElement): Promise<void> {
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: 4</button></main>`,
      );

      click(main, "button");
      await waitOneFrame();
      expect(main.outerHTML).toMatchInlineSnapshot(
        `<main><button>HOT RELOADED Count: -1</button></main>`,
      );
    }
  });

  test("Unexpected/unhandled error at eval", async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const originalPromiseReject = Promise.reject;

    onTestFinished(() => {
      Promise.reject = originalPromiseReject;
    });

    const error = new Error("Very unexpected error");

    const mockPromiseReject = vi.fn();

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
          assert1(div);
          Object.defineProperty(window.Elm?.["HtmlMain"], "__elmWatchApps", {
            get() {
              throw error;
            },
          });
          replace((content) =>
            content.replace("hot reload", "simple text change"),
          );
          return "KeepGoing";
        default:
          assert2(div);
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
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      ↑↗
      ·→
      ▲ ✅ 13:10:05 HtmlMain
      ================================================================================
      target HtmlMain
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      window.Elm does not look like expected! This is the error message:
      At root:
      Very unexpected error
      ↑↗
      ·→
      ▲ ⏳ 13:10:05 HtmlMain
      ================================================================================
      target HtmlMain
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      window.Elm does not look like expected! This is the error message:
      At root:
      Very unexpected error
      ↑↗
      ·→
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
        [
          [
            [Error: Very unexpected error],
          ],
        ]
      `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><h1 class="probe">hot reload</h1></div>`,
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><h1 class="probe">hot reload</h1></div>`,
      );
    }
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

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: OutputsWithoutAction⧘
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
        window.Elm?.["MultipleTargets"]?.init({ node: node1 });
        return window.Elm?.["MultipleTargetsOther1"]?.init({ node: node2 });
      },
    });

    const { browserConsole } = await go(({ idle }) => {
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
  });

  test("Change Elm file while `elm make` is running", async () => {
    const fixture = "hot-reload";
    const lockFile = path.join(FIXTURES_DIR, fixture, "lock");

    fs.writeFileSync(lockFile, "Normal");

    const { replace, go } = runHotReload({
      fixture,
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
          fs.writeFileSync(lockFile, "Delay");
          replace((content) => content.replace("1", "2"));
          await new Promise<void>((resolve) => {
            (function rec() {
              if (fs.readFileSync(lockFile, "utf8") === "DelayAck") {
                resolve();
              } else {
                setTimeout(rec, 10);
              }
            })();
          });
          replace((content) => content.replace("2", "3"));
          // Wait for the watcher to pick up the change before releasing the previous compilation.
          await wait(100);
          fs.writeFileSync(lockFile, "Normal");
          return "KeepGoing";
        default:
          assertHotReload(div);
          return "Stop";
      }
    });

    expect(grep(terminal, /interrupted/)).toMatchInlineSnapshot(
      `⏳ InterruptElm: interrupted`,
    );

    function assertInit(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Text1</div>`);
    }

    function assertHotReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Text3</div>`);
    }
  });

  test("Restart while `elm make` is running", async () => {
    const fixture = "hot-reload";
    const lockFile = path.join(FIXTURES_DIR, fixture, "lock");
    const elmJsonPath = path.join(FIXTURES_DIR, fixture, "elm.json");

    fs.writeFileSync(lockFile, "Normal");

    const { replace, go } = runHotReload({
      fixture,
      name: "InterruptElm",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
      bin: "delay",
    });

    const { terminal } = await go(async ({ idle }) => {
      switch (idle) {
        case 1:
          fs.writeFileSync(lockFile, "Delay");
          replace((content) => content.replace("1", "2"));
          await new Promise<void>((resolve) => {
            (function rec() {
              if (fs.readFileSync(lockFile, "utf8") === "DelayAck") {
                resolve();
              } else {
                setTimeout(rec, 10);
              }
            })();
          });
          touch(elmJsonPath);
          // Wait for the watcher to pick up the change before releasing the previous compilation.
          await wait(100);
          fs.writeFileSync(lockFile, "Normal");
          return "KeepGoing";
        default:
          return "Stop";
      }
    });

    expect(grep(terminal, /interrupted/)).toMatchInlineSnapshot(
      `⏳ InterruptElm: interrupted`,
    );
  });

  test("Restart while installing dependencies", async () => {
    const fixture = "hot-reload";
    const lockFile = path.join(FIXTURES_DIR, fixture, "lock");
    const elmJsonPath = path.join(FIXTURES_DIR, fixture, "elm.json");

    fs.writeFileSync(lockFile, "Delay");

    const { go } = runHotReload({
      fixture,
      name: "InterruptElm",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
      bin: "delay",
    });

    const [{ terminal }] = await Promise.all([
      go(() => "Stop"),
      (async () => {
        await new Promise<void>((resolve) => {
          (function rec() {
            if (fs.readFileSync(lockFile, "utf8") === "DelayAck") {
              resolve();
            } else {
              setTimeout(rec, 10);
            }
          })();
        });
        touch(elmJsonPath);
        // Wait for the watcher to pick up the change before releasing the previous compilation.
        await wait(100);
        fs.writeFileSync(lockFile, "Normal");
      })(),
    ]);

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ InterruptElm: elm make (typecheck only)
      ✅ InterruptElm⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/hot/hot-reload/elm.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      ⏳ InterruptElm: elm make
      ✅ InterruptElm⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected needing compilation of: InterruptElm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ℹ️ ⧙13:10:05⧘ ⧙Web socket connected for: InterruptElm⧘
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
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      [Show errors]
      ↑↗
      ·→
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
      [Show errors]
      ↑↗
      ·→
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
      [Show errors]
      ↑↗
      ·→
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
      [Show errors]
      ↑↗
      ·→
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
      ↑↗
      ·→
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
      name: "SlowPostprocess",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
    });

    const { browserConsole } = await go(async ({ idle }) => {
      switch (idle) {
        case 1:
          switchCompilationMode("optimize");
          await wait(200);
          window.__ELM_WATCH.DISCONNECT(/^SlowPostprocess$/);
          return "KeepGoing";
        default:
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because compilation mode changed from standard to optimize.
        (target: SlowPostprocess)
      `);
  });

  describe("error overlay", () => {
    const fixture = "error-overlay";
    const dir = path.join(FIXTURES_DIR, fixture);
    const template = path.join(dir, "template");
    const src = path.join(dir, "src");

    const replaceHelper = (
      name: string,
      f: (content: string) => string,
    ): void => {
      fs.writeFileSync(
        path.join(src, name),
        f(fs.readFileSync(path.join(src, name), "utf-8")),
      );
    };

    const joinOverlays = (overlays: Array<string>): string =>
      overlays.join(`\n${"=".repeat(80)}\n`);

    beforeEach(async () => {
      await rimraf(src);
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
            overlays.push(getOverlay());
            expandUi("App");
            showErrors("App");
            overlays.push(getOverlay());
            return "KeepGoing";
          case 4:
            replaceHelper("AppOtherHelpers.elm", (content) =>
              content.replace("=", ":="),
            );
            return "KeepGoing";
          case 5:
            expandUi("AppOther");
            showErrors("AppOther");
            overlays.push(getOverlay());
            return "KeepGoing";
          case 6:
            replaceHelper("Shared.elm", (content) =>
              content.replace("text", "textTypo"),
            );
            return "KeepGoing";
          case 7:
            return "KeepGoing"; // First script finished.
          case 8:
            expandUi("App");
            hideErrors("App");
            overlays.push(getOverlay());
            return "KeepGoing";
          case 9:
            expandUi("AppOther");
            hideErrors("AppOther");
            overlays.push(getOverlay());
            return "KeepGoing";
          case 10:
            expandUi("App");
            expandUi("AppOther");
            showErrors("App");
            showErrors("AppOther");
            return "KeepGoing";
          case 11:
            return "KeepGoing"; // First script finished.
          case 12:
            overlays.push(getOverlay());
            closeOverlay();
            overlays.push(getOverlay());
            return "KeepGoing";
          case 13:
            return "KeepGoing"; // First script finished.
          default:
            return "Stop";
        }
      });

      expect(joinOverlays(overlays)).toMatchInlineSnapshot(`
        <overlay hidden style="">

        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30);">
        <details open="" id="0" data-target-names="App" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">NEEDS DOUBLE QUOTES</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppHelpers.elm:3:8</button></p></summary>
        <pre>The following string uses single quotes:

        3| text = 'App'
                  <span style="color: rgb(241, 76, 76)">^^^^^</span>
        Please switch to double quotes instead:

            <span style="color: rgb(229, 229, 16)">'this'</span> =&gt; <span style="color: rgb(35, 209, 139)">"this"</span>

        <u>Note</u>: Elm uses double quotes for strings like "hello", whereas it uses single
        quotes for individual characters like 'a' and 'ø'. This distinction helps with
        code like (String.any (\\c -&gt; c == 'X') "90210") where you are inspecting
        individual characters.</pre></details>
        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30);">
        <details open="" id="0" data-target-names="AppOther" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">PROBLEM IN TYPE ANNOTATION</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppOtherHelpers.elm:3:7</button></p></summary>
        <pre>I was partway through parsing the \`text\` type annotation, but I got stuck here:

        3| text := "AppOther"
                 <span style="color: rgb(241, 76, 76)">^</span>
        I was expecting to see a type next. Try putting <span style="color: rgb(229, 229, 16)">Int</span> or <span style="color: rgb(229, 229, 16)">String</span> for now?</pre></details>
        --------------------------------------------------------------------------------
        <details open="" id="1" data-target-names="App" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">NEEDS DOUBLE QUOTES</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppHelpers.elm:3:8</button></p></summary>
        <pre>The following string uses single quotes:

        3| text = 'App'
                  <span style="color: rgb(241, 76, 76)">^^^^^</span>
        Please switch to double quotes instead:

            <span style="color: rgb(229, 229, 16)">'this'</span> =&gt; <span style="color: rgb(35, 209, 139)">"this"</span>

        <u>Note</u>: Elm uses double quotes for strings like "hello", whereas it uses single
        quotes for individual characters like 'a' and 'ø'. This distinction helps with
        code like (String.any (\\c -&gt; c == 'X') "90210") where you are inspecting
        individual characters.</pre></details>
        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30);">
        <details open="" id="0" data-target-names="AppOther" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">PROBLEM IN TYPE ANNOTATION</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppOtherHelpers.elm:3:7</button></p></summary>
        <pre>I was partway through parsing the \`text\` type annotation, but I got stuck here:

        3| text := "AppOther"
                 <span style="color: rgb(241, 76, 76)">^</span>
        I was expecting to see a type next. Try putting <span style="color: rgb(229, 229, 16)">Int</span> or <span style="color: rgb(229, 229, 16)">String</span> for now?</pre></details>
        --------------------------------------------------------------------------------
        <details open="" id="1" data-target-names="AppOther" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">UNKNOWN EXPORT</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/Shared.elm:1:25</button></p></summary>
        <pre>You are trying to expose a value named \`textTypo\` but I cannot find its
        definition.

        Maybe you want <span style="color: rgb(229, 229, 16)">text</span> instead?</pre></details>
        </overlay>
        ================================================================================
        <overlay hidden style="background-color: rgb(32, 30, 30);">

        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30);">
        <details open="" id="0" data-target-names="AppOther" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">PROBLEM IN TYPE ANNOTATION</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppOtherHelpers.elm:3:7</button></p></summary>
        <pre>I was partway through parsing the \`text\` type annotation, but I got stuck here:

        3| text := "AppOther"
                 <span style="color: rgb(241, 76, 76)">^</span>
        I was expecting to see a type next. Try putting <span style="color: rgb(229, 229, 16)">Int</span> or <span style="color: rgb(229, 229, 16)">String</span> for now?</pre></details>
        --------------------------------------------------------------------------------
        <details open="" id="1" data-target-names="App" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">NEEDS DOUBLE QUOTES</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/AppHelpers.elm:3:8</button></p></summary>
        <pre>The following string uses single quotes:

        3| text = 'App'
                  <span style="color: rgb(241, 76, 76)">^^^^^</span>
        Please switch to double quotes instead:

            <span style="color: rgb(229, 229, 16)">'this'</span> =&gt; <span style="color: rgb(35, 209, 139)">"this"</span>

        <u>Note</u>: Elm uses double quotes for strings like "hello", whereas it uses single
        quotes for individual characters like 'a' and 'ø'. This distinction helps with
        code like (String.any (\\c -&gt; c == 'X') "90210") where you are inspecting
        individual characters.</pre></details>
        --------------------------------------------------------------------------------
        <details open="" id="2" data-target-names="App
        AppOther" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">UNKNOWN EXPORT</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/Shared.elm:1:25</button></p></summary>
        <pre>You are trying to expose a value named \`textTypo\` but I cannot find its
        definition.

        Maybe you want <span style="color: rgb(229, 229, 16)">text</span> instead?</pre></details>
        </overlay>
        ================================================================================
        <overlay hidden style="background-color: rgb(32, 30, 30);">

        </overlay>
      `);
    });

    test("automatically hide and show the overlay", async () => {
      const { replace, go } = runHotReload({
        fixture,
        name: "App",
        programType: "Html",
        compilationMode: "standard",
      });

      const overlays: Array<string> = [];

      await go(({ idle }) => {
        switch (idle) {
          case 1:
            replace((content) => content.replace("++", "+"));
            return "KeepGoing";

          case 2:
            overlays.push(getOverlay());
            expandUi();
            showErrors();
            overlays.push(getOverlay());
            return "KeepGoing";

          case 3:
            replace((content) => content.replace("+", "++"));
            return "KeepGoing";

          case 4:
            overlays.push(getOverlay());
            replace((content) => content.replace("module", ""));
            return "KeepGoing";

          default:
            overlays.push(getOverlay());
            return "Stop";
        }
      });

      expect(joinOverlays(overlays)).toMatchInlineSnapshot(`
        <overlay hidden style="">

        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30);">
        <details open="" id="0" data-target-names="App" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/App.elm:7:19</button></p></summary>
        <pre>I cannot do addition with <span style="color: rgb(229, 229, 16)">String</span> values like this one:

        7| main = Html.text (AppHelpers.text + Shared.text)
                             <span style="color: rgb(241, 76, 76)">^^^^^^^^^^^^^^^</span>
        The (+) operator only works with <span style="color: rgb(229, 229, 16)">Int</span> and <span style="color: rgb(229, 229, 16)">Float</span> values.

        <u>Hint</u>: Switch to the <span style="color: rgb(35, 209, 139)">(++)</span> operator to append strings!</pre></details>
        </overlay>
        ================================================================================
        <overlay hidden style="background-color: rgb(32, 30, 30);">

        </overlay>
        ================================================================================
        <overlay visible style="background-color: rgb(32, 30, 30);">
        <details open="" id="0" data-target-names="App" style="background-color: rgb(32, 30, 30); color: rgb(204, 204, 204);">
        <summary><span style="background-color: rgb(32, 30, 30);">SYNTAX PROBLEM</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/App.elm:1:2</button></p></summary>
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

        <u>Note</u>: This can also happen when something is indented too much!</pre></details>
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
            expandUi();
            showErrors();
            overlay = getOverlay();
            return "KeepGoing";

          default:
            return "Stop";
        }
      });

      expect(overlay).toMatchInlineSnapshot(`
        <overlay visible style="background-color: rgb(170, 187, 204);">
        <details open="" id="0" data-target-names="App" style="background-color: rgb(170, 187, 204); color: rgb(17, 34, 51);">
        <summary><span style="background-color: rgb(170, 187, 204);">TYPE MISMATCH</span><p><button>/Users/you/project/tests/fixtures/hot/error-overlay/src/App.elm:7:19</button></p></summary>
        <pre>I cannot do addition with <span style="color: #333333">String</span> values like this one:

        7| main = Html.text (AppHelpers.text + Shared.text)
                             <span style="color: #999999">^^^^^^^^^^^^^^^</span>
        The (+) operator only works with <span style="color: #333333">Int</span> and <span style="color: #333333">Float</span> values.

        <u>Hint</u>: Switch to the <span style="color: #aaaaaa">(++)</span> operator to append strings!</pre></details>
        </overlay>
      `);
    });
  });
});
