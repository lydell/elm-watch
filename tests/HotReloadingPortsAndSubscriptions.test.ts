// @vitest-environment jsdom
import * as path from "path";
import { afterEach, describe, expect, onTestFinished, test } from "vitest";

import {
  onlyErrorMessages,
  removeIndents,
  stringSnapshotSerializer,
  touch,
  waitOneFrame,
} from "./Helpers.ts";
import {
  assertDebugger,
  cleanupAfterEachTest,
  click,
  fixtureDir,
  runHotReload,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot reloading", () => {
  afterEach(cleanupAfterEachTest);

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
    const elmJsonPath = path.join(fixtureDir("hot-reload"), "elm.json");

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
});
