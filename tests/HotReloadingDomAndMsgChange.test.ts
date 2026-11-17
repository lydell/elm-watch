// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";

import {
  removeIndents,
  stringSnapshotSerializer,
  waitOneFrame,
} from "./Helpers.ts";
import {
  assertCompilationMode,
  assertDebugger,
  cleanupAfterEachTest,
  click,
  runHotReload,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot reloading", () => {
  afterEach(cleanupAfterEachTest);

  test.each([
    ["Sandbox", "standard"],
    ["Sandbox", "debug"],
    ["Element", "standard"],
    ["Element", "debug"],
    ["Document", "standard"],
    ["Document", "debug"],
    ["Application", "standard"],
    ["Application", "debug"],
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

  // There is no hot reloading in optimize mode, only full page reloads.
  test.each(["Sandbox", "Element", "Document", "Application"] as const)(
    "optimize mode does a full page reload: %s",
    async (programType) => {
      const { replace, go } = runHotReload({
        name: "DomAndMsgChange",
        programType,
        compilationMode: "optimize",
      });

      const { browserConsole } = await go(async ({ idle, main }) => {
        switch (idle) {
          case 1:
            assertCompilationMode("optimize");
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
            replace((content) =>
              content.replace("Before hot reload", "After hot reload"),
            );
            return "KeepGoing";
          default:
            // The page was reloaded, so the model is reset.
            expect(main.outerHTML).toStrictEqual(
              removeIndents(`
                <main><h1 class="probe">After hot reload</h1><button>Button</button><pre>
                originalButtonClicked: 0
                newButtonClicked: 0
                </pre></main>
              `),
            );
            return "Stop";
        }
      });

      expect(browserConsole).toStrictEqual(
        removeIndents(`
          elm-watch: I did a full page reload because hot reloading isn't supported in optimize mode.
          (target: DomAndMsgChange)
        `),
      );
    },
  );
});
