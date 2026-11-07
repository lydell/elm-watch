// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";

import {
  removeIndents,
  stringSnapshotSerializer,
  waitOneFrame,
} from "./Helpers.ts";
import {
  assertCompilationMode,
  assertDebugDisabled,
  assertDebugger,
  cleanupAfterEachTest,
  click,
  runHotReload,
  switchCompilationMode,
} from "./HotHelpers.ts";

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
      web socket ws://localhost:59123/elm-watch
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
      web socket ws://localhost:59123/elm-watch
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
      web socket ws://localhost:59123/elm-watch
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
      web socket ws://localhost:59123/elm-watch
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
      web socket ws://localhost:59123/elm-watch
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

  test("update window.Elm for next init (Html)", async () => {
    const node1 = document.createElement("h1");
    const node2 = document.createElement("h1");
    node1.id = "node1-before-init";
    node2.id = "node2-before-init";

    const { replace, go } = runHotReload({
      name: "HtmlMain",
      programType: "Html",
      compilationMode: "standard",
      init: (node) => {
        node.append(node1, node2);
        return window.Elm?.["HtmlMain"]?.init({ node: node1 });
      },
    });

    await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assertInit(div);
          replace((content) =>
            content.replace("hot reload", "simple text change"),
          );
          return "KeepGoing";
        case 2:
          assertHotReload(div);
          // Init another instance of the app. It should render the updated version immediately.
          window.Elm?.["HtmlMain"]?.init({ node: node2 });
          assertHotReloadTwoApps(div);
          replace((content) =>
            content.replace("simple text change", "final change"),
          );
          return "KeepGoing";
        default:
          assertFinalChangeTwoApps(div);
          return "Stop";
      }
    });

    function assertInit(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1 class="probe">hot reload</h1><h1 id="node2-before-init"></h1></div></div>`,
      );
    }

    function assertHotReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1 class="probe">simple text change</h1><h1 id="node2-before-init"></h1></div></div>`,
      );
    }

    function assertHotReloadTwoApps(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1 class="probe">simple text change</h1><h1 class="probe">simple text change</h1></div></div>`,
      );
    }

    function assertFinalChangeTwoApps(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div><div><h1 class="probe">final change</h1><h1 class="probe">final change</h1></div></div>`,
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

  test.each([
    ["Sandbox", "standard"],
    ["Sandbox", "debug"],
    ["Sandbox", "optimize"],
    ["Element", "standard"],
    ["Element", "debug"],
    ["Element", "optimize"],
  ] as const)(
    "update window.Elm for next init: %s / %s",
    async (programType, compilationMode) => {
      const node1 = document.createElement("h1");
      const node2 = document.createElement("h1");
      node1.id = "node1-before-init";
      node2.id = "node2-before-init";

      const { replace, go } = runHotReload({
        name: "DomAndMsgChange",
        programType,
        compilationMode,
        init: (node) => {
          node.append(node1, node2);
          return window.Elm?.["DomAndMsgChange"]?.init({ node: node1 });
        },
      });

      await go(({ idle, div }) => {
        switch (idle) {
          case 1:
            assertCompilationMode(compilationMode);
            assertInit(div);
            replace((content) =>
              content.replace("Before hot reload", "After hot reload"),
            );
            return "KeepGoing";
          case 2:
            assertHotReload(div);
            // Init another instance of the app. It should render the updated version immediately.
            window.Elm?.["DomAndMsgChange"]?.init({ node: node2 });
            assertHotReloadTwoApps(div);
            replace((content) =>
              content.replace("After hot reload", "Final change"),
            );
            return "KeepGoing";
          default:
            assertFinalChangeTwoApps(div);
            return "Stop";
        }
      });

      function getH1s(div: HTMLDivElement): string {
        return Array.from(
          div.querySelectorAll("h1"),
          (h1) => h1.outerHTML,
        ).join("\n");
      }

      function assertInit(div: HTMLDivElement): void {
        expect(getH1s(div)).toStrictEqual(
          removeIndents(`
            <h1 class="probe">Before hot reload</h1>
            <h1 id="node2-before-init"></h1>
          `),
        );
      }

      function assertHotReload(div: HTMLDivElement): void {
        expect(getH1s(div)).toStrictEqual(
          removeIndents(`
            <h1 class="probe">After hot reload</h1>
            <h1 id="node2-before-init"></h1>
          `),
        );
      }

      function assertHotReloadTwoApps(div: HTMLDivElement): void {
        expect(getH1s(div)).toStrictEqual(
          removeIndents(`
            <h1 class="probe">After hot reload</h1>
            <h1 class="probe">After hot reload</h1>
          `),
        );
      }

      function assertFinalChangeTwoApps(div: HTMLDivElement): void {
        expect(getH1s(div)).toStrictEqual(
          removeIndents(`
            <h1 class="probe">Final change</h1>
            <h1 class="probe">Final change</h1>
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
});
