// @vitest-environment jsdom
import { afterEach, describe, expect, onTestFinished, test, vi } from "vitest";

import {
  removeIndents,
  stringSnapshotSerializer,
  waitOneFrame,
} from "./Helpers";
import {
  cleanupAfterEachTest,
  click,
  expandUi,
  runHotReload,
} from "./HotHelpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot reloading", () => {
  afterEach(cleanupAfterEachTest);

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
    // oxlint-disable-next-line no-console
    const originalConsoleError = console.error;

    onTestFinished(() => {
      // oxlint-disable-next-line no-console
      console.error = originalConsoleError;
    });

    // The HTTP request made in the test fails, and jsdom logs that using `console.error`.
    // oxlint-disable-next-line no-console
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
    // oxlint-disable-next-line no-console
    const originalConsoleLog = console.log;

    onTestFinished(() => {
      // oxlint-disable-next-line no-console
      console.log = originalConsoleLog;
    });

    const mockConsoleLog = vi.fn();
    // oxlint-disable-next-line no-console
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
    // oxlint-disable-next-line typescript/unbound-method
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
    });

    const { onlyExpandedRenders } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assert1(div);
          window.__ELM_WATCH.HOT_RELOAD = () => {
            throw error;
          };
          replace((content) =>
            content.replace("hot reload", "simple text change"),
          );
          return "KeepGoing";
        default:
          assert2(div);
          expandUi();
          return "Stop";
      }
    });

    expect(onlyExpandedRenders).toMatchInlineSnapshot(`
      target HtmlMain
      elm-watch %VERSION%
      web socket ws://localhost:59123/elm-watch
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

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 1

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
});
