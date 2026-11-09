// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";

import {
  removeIndents,
  stringSnapshotSerializer,
  waitOneFrame,
} from "./Helpers.ts";
import { cleanupAfterEachTest, runHotReload } from "./HotHelpers.ts";

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
});
