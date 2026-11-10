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
  cleanupAfterEachTest,
  click,
  nextWatcherEventHandled,
  runHotReload,
  waitForElmWatchIdle,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

// Lamdera ships with the `hot-reload-stop` branches of lydell/core,
// lydell/browser and lydell/virtual-dom, which have built-in hot reloading
// (`Elm.hot`). These tests compile vanilla Elm with `compiler: "lamdera"`.
// These tests are versions of tests in the other HotReloading*.test.ts files.
describe("hot reloading with Elm.hot", () => {
  afterEach(cleanupAfterEachTest);

  test.each(["standard", "debug"] as const)(
    "update window.Elm for next init: %s",
    async (compilationMode) => {
      const node1 = document.createElement("h1");
      const node2 = document.createElement("h1");
      node1.id = "node1-before-init";
      node2.id = "node2-before-init";

      const { replace, go } = runHotReload({
        name: "DomAndMsgChange",
        programType: "Element",
        compilationMode,
        compiler: "lamdera",
        init: (node) => {
          node.append(node1, node2);
          return window.Elm?.["DomAndMsgChange"]?.init({ node: node1 });
        },
      });

      const { browserConsole } = await go(({ idle, div }) => {
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

      expect(browserConsole).toStrictEqual("");

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

  test("optimize mode does a full page reload", async () => {
    const { replace, go } = runHotReload({
      name: "DomAndMsgChange",
      programType: "Element",
      compilationMode: "optimize",
      compiler: "lamdera",
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assertCompilationMode("optimize");
          expect(div.outerHTML).toMatchInlineSnapshot(
            `
            <div><main><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 0
            newButtonClicked: 0
            </pre></main></div>
          `,
          );
          replace((content) =>
            content.replace("Before hot reload", "After hot reload"),
          );
          return "KeepGoing";
        default:
          expect(div.outerHTML).toMatchInlineSnapshot(
            `
            <div><main><h1 class="probe">After hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 0
            newButtonClicked: 0
            </pre></main></div>
          `,
          );
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
      elm-watch: I did a full page reload because \`Elm.DomAndMsgChange\` uses built-in hot reloading (\`Elm.hot\`), which isn't available. It only exists when not in optimize mode, and when elm/core, elm/browser and elm/virtual-dom all support it.
      (target: DomAndMsgChange)
    `);
  });

  test.each(["standard", "debug"] as const)(
    "Add Msg: %s",
    async (compilationMode) => {
      const { replace, go } = runHotReload({
        name: "AddMsg",
        programType: "Element",
        compilationMode,
        compiler: "lamdera",
      });

      const { browserConsole } = await go(async ({ idle, main }) => {
        switch (idle) {
          case 1:
            expect(main.outerHTML).toStrictEqual(`<main>init</main>`);
            main.click();
            await waitOneFrame();
            expect(main.outerHTML).toStrictEqual(`<main>Msg1</main>`);
            replace((content) => content.replace(/-- /g, ""));
            return "KeepGoing";
          default:
            // In debug mode, the page is reloaded, so we start over from `init`.
            expect(main.outerHTML).toStrictEqual(
              compilationMode === "debug"
                ? `<main>init</main>`
                : `<main>Msg1</main>`,
            );
            main.click();
            await waitOneFrame();
            expect(main.outerHTML).toStrictEqual(`<main>AddedMsg</main>`);
            return "Stop";
        }
      });

      expect(browserConsole).toStrictEqual(
        compilationMode === "debug"
          ? removeIndents(`
              elm-watch: I did a full page reload because the message type in \`Elm.AddMsg\` changed in debug mode ("debug metadata" changed).
              (target: AddMsg)
            `)
          : "",
      );
    },
  );

  test("Init tweak value", async () => {
    const { replace, go } = runHotReload({
      name: "InitTweakValue",
      programType: "Element",
      compilationMode: "standard",
      compiler: "lamdera",
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          expect(div.outerHTML).toMatchInlineSnapshot(`<div>init</div>`);
          replace((content) => content.replace(/-- /g, ""));
          return "KeepGoing";
        default:
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div>init_tweaked</div>`,
          );
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
      elm-watch: I did a full page reload because \`Elm.InitTweakValue.init\` returned something different than last time. Let's start fresh!
      (target: InitTweakValue)
    `);
  });

  test("Init new field", async () => {
    const { replace, go } = runHotReload({
      name: "InitNewField",
      programType: "Element",
      compilationMode: "standard",
      compiler: "lamdera",
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          expect(div.outerHTML).toMatchInlineSnapshot(`<div>field1</div>`);
          replace((content) => content.replace(/-- /g, ""));
          return "KeepGoing";
        default:
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div>field1 with newField</div>`,
          );
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
      elm-watch: I did a full page reload because \`Elm.InitNewField.init\` returned something different than last time. Let's start fresh!
      (target: InitNewField)
    `);
  });

  test("Init with cancelable Task", async () => {
    const { replace, go } = runHotReload({
      name: "InitHttp",
      programType: "Element",
      compilationMode: "standard",
      compiler: "lamdera",
    });

    const { browserConsole } = await go(async ({ idle, div }) => {
      switch (idle) {
        case 1:
          click(div, "button");
          await waitOneFrame();
          expect(div.querySelector("button")?.outerHTML).toMatchInlineSnapshot(
            `<button>Count: 1</button>`,
          );
          replace((content) => content.replace("Count:", "Hot count:"));
          return "KeepGoing";
        default:
          expect(div.querySelector("button")?.outerHTML).toMatchInlineSnapshot(
            `<button>Hot count: 1</button>`,
          );
          return "Stop";
      }
    });

    // This should not list any reloads. (It’s tricky because Elm mutates Tasks.)
    expect(browserConsole).toMatchInlineSnapshot(``);
  });

  test("Change program type", async () => {
    const { write, replace, go } = runHotReload({
      name: "ChangeProgramType",
      programType: "Sandbox",
      compilationMode: "standard",
      compiler: "lamdera",
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div>Browser.sandbox</div>`,
          );
          write(2);
          return "KeepGoing";
        case 2:
          // `Browser.sandbox` and `Browser.element` can’t be told apart with
          // `Elm.hot`, and switching between them hot reloads fine.
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div>Browser.element</div>`,
          );
          replace(
            () => `module ChangeProgramType exposing (main)

import Html

main =
    Html.text "Html"
`,
          );
          return "KeepGoing";
        default:
          expect(div.outerHTML).toMatchInlineSnapshot(`<div>Html</div>`);
          return "Stop";
      }
    });

    expect(browserConsole).toMatchInlineSnapshot(`
      elm-watch: I did a full page reload because \`Elm.ChangeProgramType.main\` changed from \`Browser.element\` to \`Html\`.
      (target: ChangeProgramType)
    `);
  });

  test("Flags change", async () => {
    let initCount = 0;

    const { replace, go } = runHotReload({
      name: "FlagsChange",
      programType: "Element",
      compilationMode: "standard",
      compiler: "lamdera",
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
          expect(div.outerHTML).toMatchInlineSnapshot(`<div>one</div>`);
          replace((content) => content.replace(/-- /g, ""));
          return "KeepGoing";
        default:
          expect(div.outerHTML).toMatchInlineSnapshot(`<div>one 2</div>`);
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
  });

  test("Html", async () => {
    const { replace, go } = runHotReload({
      name: "HtmlMain",
      programType: "Html",
      compilationMode: "standard",
      compiler: "lamdera",
    });

    let probe: HTMLElement | null = null;

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          assertDebugDisabled();
          expect(div.outerHTML).toStrictEqual(
            `<div><h1 class="probe">hot reload</h1></div>`,
          );
          probe = div.querySelector(".probe");
          replace((content) =>
            content.replace("hot reload", "simple text change"),
          );
          return "KeepGoing";
        default:
          expect(div.outerHTML).toStrictEqual(
            `<div><h1 class="probe">simple text change</h1></div>`,
          );
          expect(div.querySelector(".probe")).toBe(probe);
          return "Stop";
      }
    });

    expect(browserConsole).toStrictEqual("");
  });

  // Lamdera’s elm/browser stores the `key` function of `Browser.application` in
  // a global variable (`_Browser_key`), set when the code is evaluated. After a
  // hot reload, `Browser.Navigation.pushUrl` uses the key from the new code,
  // whose `setup` never ran, and crashes with:
  // TypeError: Cannot read properties of undefined (reading 'onUrlChange')
  // That happens with `Elm.hot.reload` without elm-watch too.
  test("Application URL messages change", async () => {
    const { replace, go } = runHotReload({
      name: "Application",
      programType: "Application",
      compilationMode: "standard",
      compiler: "lamdera",
    });

    const { browserConsole } = await go(async ({ idle, main }) => {
      switch (idle) {
        case 1:
          click(main, "a");
          await waitOneFrame();
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
          click(main, "a");
          await waitOneFrame();
          expect(main.outerHTML).toStrictEqual(
            removeIndents(`
              <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
              url: http://localhost/link
              originalUrlRequested: 1
              originalUrlChanged: 1
              newUrlRequested: 1
              newUrlChanged: 1
              </pre></main>
            `),
          );
          return "Stop";
      }
    });

    expect(browserConsole).toStrictEqual("");
  });

  test("hot reload code postprocessed to ESM", async () => {
    const { go, replace } = runHotReload({
      fixture: "hot-reload-postprocess",
      useElmWatchFunction: true,
      name: "ESM",
      programType: "Html",
      compilationMode: "standard",
      compiler: "lamdera",
      init: (node) => window.Elm?.["ESM"]?.init({ node }),
    });

    const { browserConsole } = await go(({ idle, div }) => {
      switch (idle) {
        case 1:
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div>original text</div>`,
          );
          replace((content) =>
            content.replace("original text", "hot reloaded text"),
          );
          return "KeepGoing";
        default:
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div>hot reloaded text</div>`,
          );
          return "Stop";
      }
    });

    expect(browserConsole).toStrictEqual("");
  });

  test("Delay init Cmds until first hot reload", async () => {
    const { inputPath, replace, go } = runHotReload({
      name: "InitCmds",
      programType: "Element",
      compilationMode: "standard",
      compiler: "lamdera",
    });

    await go(async ({ idle, div }) => {
      switch (idle) {
        case 1: {
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div>Model set via Cmd from OLD code</div>`,
          );

          // Close the tab:
          await window.__ELM_WATCH.KILL_MATCHING(/^/);
          div.replaceChildren();

          // Make a change with the tab closed:
          const changed = nextWatcherEventHandled(inputPath);
          replace((content) => content.replace("OLD", "NEW"));
          await changed;
          await waitForElmWatchIdle();

          // Open the tab again. It is first going to load the old code,
          // and then immediately get a hot reload with the new code.
          // By delaying the init Cmds until then, we get the Cmds handled
          // with the new code without a page reload.
          window.__ELM_WATCH.RELOAD_PAGE(undefined);
          return "KeepGoing";
        }
        default:
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div>Model set via Cmd from NEW code</div>`,
          );
          return "Stop";
      }
    });
  });
});
