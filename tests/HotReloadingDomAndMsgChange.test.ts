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
});
