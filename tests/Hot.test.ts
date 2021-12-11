/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

import { elmWatchCli } from "../src";
import { OnIdle } from "../src/Types";
import {
  badElmBinEnv,
  clean,
  CursorWriteStream,
  FailReadStream,
  MemoryWriteStream,
  stringSnapshotSerializer,
  TEST_ENV,
} from "./Helpers";

const CONTAINER_ID = "elm-watch";
const FIXTURES_DIR = path.join(__dirname, "fixtures", "hot");

async function run({
  fixture,
  scripts,
  args = [],
  init,
  onIdle,
  expandUiImmediately = false,
  isTTY = true,
  bin,
}: {
  fixture: string;
  scripts: Array<string>;
  args?: Array<string>;
  init: () => void;
  onIdle: OnIdle;
  expandUiImmediately?: boolean;
  isTTY?: boolean;
  bin?: string;
}): Promise<{ terminal: string; browser: string; renders: string }> {
  const dir = path.join(FIXTURES_DIR, fixture);
  const build = path.join(dir, "build");
  const absoluteScripts = scripts.map((script) => path.join(build, script));

  if (fs.rmSync !== undefined) {
    fs.rmSync(build, { recursive: true, force: true });
  } else if (fs.existsSync(build)) {
    fs.rmdirSync(build, { recursive: true });
  }

  const stdout = new MemoryWriteStream();
  const stderr = new CursorWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const renders: Array<string> = [];

  await new Promise((resolve, reject) => {
    const loadBuiltFiles = (isReload: boolean): void => {
      delete window.Elm;
      Promise.all(
        absoluteScripts.map((script) => {
          // Copying the script does a couple of things:
          // - Avoiding require/import cache.
          // - Makes it easier to debug the tests since one can see all the outputs through time.
          // - Lets us make a few replacements for Jest.
          const newScript = script.replace(/\.(\w+)$/, `.${idle}.$1`);
          const content = fs
            .readFileSync(script, "utf8")
            .replace(/\(this\)\);\s*$/, "(window));")
            .replace(/^\s*console.warn\('[^']+'\);/m, "");
          fs.writeFileSync(newScript, content);
          return import(newScript);
        })
      ).then(() => {
        if (expandUiImmediately) {
          expandUi();
        }
        if (isReload) {
          init();
        }
      }, reject);
    };

    let idle = 0;

    window.__ELM_WATCH_GET_NOW = () => new Date(0);
    window.__ELM_WATCH_RELOAD_PAGE = () => {
      loadBuiltFiles(true);
    };
    window.__ELM_WATCH_ON_RENDER = (targetName) => {
      const element =
        document.getElementById(CONTAINER_ID)?.shadowRoot?.lastElementChild;

      const text =
        element instanceof Node
          ? Array.from(element.childNodes, getTextContent)
              .join(`\n${"-".repeat(80)}\n`)
              .replace(/(ws:\/\/localhost):\d{5}/g, "$1:59123")
          : `#${CONTAINER_ID} not found in:\n${
              document.documentElement.outerHTML
            } for ${args.join(", ")}. Target: ${targetName}`;

      renders.push(text);
    };

    elmWatchCli(["hot", ...args], {
      cwd: dir,
      env:
        bin === undefined
          ? {
              ...process.env,
              ...TEST_ENV,
            }
          : badElmBinEnv(path.join(dir, "bad-bin", bin)),
      stdin: new FailReadStream(),
      stdout,
      stderr,
      getNow: () => new Date(0),
      onIdle: () => {
        idle++;
        switch (idle) {
          case 1: // Typecheck-only done.
            loadBuiltFiles(false);
            return "KeepGoing";
          default: {
            const result = onIdle();
            switch (result) {
              case "KeepGoing":
                return "KeepGoing";
              case "Stop":
                window.__ELM_WATCH_KILL_ALL();
                return "Stop";
            }
          }
        }
      },
    }).then(resolve, reject);
  });

  const stderrString = clean(stderr.getOutput());

  expect(stdout.content).toBe("");

  const lastText = renders[renders.length - 1] ?? "No renders!";

  return {
    terminal: stderrString,
    browser: lastText,
    renders: renders.join(`\n${"=".repeat(80)}\n`),
  };
}

const stopOnFirstSuccess = (): OnIdle => {
  let idle = 0;
  return () => {
    idle++;
    switch (idle) {
      case 1: // Compilation done after websocket connected.
      case 2: // Client rendered ✅.
        return "KeepGoing";
      default:
        return "Stop";
    }
  };
};

function expandUi(): void {
  document
    .getElementById(CONTAINER_ID)
    ?.shadowRoot?.querySelector("button")
    ?.click();
}

function getTextContent(element: Node): string {
  return Array.from(walkTextNodes(element), (node) => node.data)
    .join("")
    .trim()
    .replace(/\n /g, "\n");
}

function* walkTextNodes(element: Node): Generator<Text, void, void> {
  if (shouldAddNewline(element)) {
    yield document.createTextNode("\n");
  }
  for (const node of element.childNodes) {
    if (node instanceof Text) {
      yield document.createTextNode(" ");
      yield node;
    } else if (node instanceof HTMLInputElement && node.type === "radio") {
      yield document.createTextNode(
        (node.checked ? "◉" : "◯") + (node.disabled ? " (disabled)" : "")
      );
    } else if (node instanceof HTMLButtonElement) {
      const textContent = (node.textContent ?? "").trim();
      if (textContent.length === 1) {
        yield document.createTextNode(textContent);
      } else {
        yield document.createTextNode("\n[");
        yield document.createTextNode(textContent);
        yield document.createTextNode("]");
      }
    } else {
      yield* walkTextNodes(node);
    }
  }
}

function shouldAddNewline(node: Node): boolean {
  switch (node.nodeName) {
    case "DIV":
    case "DT":
    case "LEGEND":
    case "LABEL":
    case "P":
    case "PRE":
      return true;
    default:
      return false;
  }
}

function failInit(): never {
  throw new Error("Expected `init` not to be called!");
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  beforeEach(() => {
    document.getElementById(CONTAINER_ID)?.remove();
  });

  test("successful connect (collapsed)", async () => {
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      init: () => {
        const div = document.createElement("div");
        document.body.append(div);
        window.Elm?.HtmlMain?.init({ node: div });
      },
      onIdle: stopOnFirstSuccess(),
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Html⧙                                  0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: Html⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 Html
      ================================================================================
      ▼ ⏳ 00:00:00 Html
      ================================================================================
      ▼ ⏳ 00:00:00 Html
      ================================================================================
      ▼ 🔌 00:00:00 Html
      ================================================================================
      ▼ ⏳ 00:00:00 Html
      ================================================================================
      ▼ ✅ 00:00:00 Html
    `);

    expect(document.body.outerHTML).toMatchInlineSnapshot(
      `<body>Hello, World!</body>`
    );
  });

  test("successful connect (expanded, not TTY, Worker)", async () => {
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Worker"],
      scripts: ["Worker.js"],
      expandUiImmediately: true,
      isTTY: false,
      init: () => {
        window.Elm?.Worker?.init();
      },
      onIdle: stopOnFirstSuccess(),
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Worker: elm make (typecheck only)
      ✅ Worker⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Worker: elm make
      ✅ Worker⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: Worker⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: Worker⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: Worker⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 00:00:00 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug
      ◯ (disabled) Standard
      ◯ (disabled) Optimize
      ▲ ⏳ 00:00:00 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ▲ ⏳ 00:00:00 Worker
      ================================================================================
      ▼ 🔌 00:00:00 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 00:00:00 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Platform.worker\` programs.
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ▲ ⏳ 00:00:00 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Successfully compiled
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Platform.worker\` programs.
      ◉ Standard
      ◯ Optimize
      ▲ ✅ 00:00:00 Worker
    `);
  });

  test("fail to overwrite Elm’s output with hot injection (no postprocess)", async () => {
    let idle = 0;

    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Readonly"],
      scripts: ["Readonly.js"],
      init: failInit,
      onIdle: () => {
        idle++;
        switch (idle) {
          case 1:
            return "KeepGoing";
          default:
            expandUi();
            return "Stop";
        }
      },
      bin: "exit-0-write-readonly",
    });

    expect(terminal).toMatchInlineSnapshot(`
      🚨 Readonly

      ⧙-- TROUBLE WRITING OUTPUT ------------------------------------------------------⧘
      ⧙Target: Readonly⧘

      I managed to compile your code and read the generated file:

      /Users/you/project/tests/fixtures/hot/basic/build/Readonly.js

      I injected code for hot reloading, and then tried to write that back to the file
      but I encountered this error:

      EACCES: permission denied, open '/Users/you/project/tests/fixtures/hot/basic/build/Readonly.js'

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: Readonly⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 Readonly
      ================================================================================
      ▼ ⏳ 00:00:00 Readonly
      ================================================================================
      ▼ ⏳ 00:00:00 Readonly
      ================================================================================
      ▼ 🚨 00:00:00 Readonly
      ================================================================================
      target Readonly
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Compilation error
      Check the terminal to see errors!
      ▲ 🚨 00:00:00 Readonly
    `);
  });

  test("fail to inject hot reload", async () => {
    let idle = 0;

    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["InjectError"],
      scripts: ["InjectError.js"],
      init: failInit,
      onIdle: () => {
        idle++;
        switch (idle) {
          case 1:
            return "KeepGoing";
          default:
            expandUi();
            return "Stop";
        }
      },
      bin: "exit-0-inject-error",
    });

    expect(terminal).toMatchInlineSnapshot(`
      🚨 InjectError

      ⧙-- TROUBLE INJECTING HOT RELOAD ------------------------------------------------⧘
      ⧙Target: InjectError⧘

      I tried to do some search and replace on Elm's JS output to inject
      code for hot reloading, but that didn't work out as expected!

      I tried to replace some specific code, but couldn't find it!

      I wrote that to this file so you can inspect it:

      /Users/you/project/tests/fixtures/hot/basic/build/elm-watch-InjectSearchAndReplaceNotFound-e6379b09e00e33c51443abf9fe0f14b87076905294f07a6ecbf740486abc4d3b.txt

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: InjectError⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 InjectError
      ================================================================================
      ▼ ⏳ 00:00:00 InjectError
      ================================================================================
      ▼ ⏳ 00:00:00 InjectError
      ================================================================================
      ▼ 🚨 00:00:00 InjectError
      ================================================================================
      target InjectError
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Compilation error
      Check the terminal to see errors!
      ▲ 🚨 00:00:00 InjectError
    `);

    const dir = path.join(FIXTURES_DIR, "basic", "build");
    const files = fs
      .readdirSync(dir)
      .filter((name) =>
        name.startsWith("elm-watch-InjectSearchAndReplaceNotFound-")
      );

    expect(files).toHaveLength(1);

    const file = path.join(dir, files[0] as string);
    const content = fs.readFileSync(file, "utf8");

    expect(content.split("\n").slice(0, 20).join("\n")).toMatchInlineSnapshot(`
      Modifying Elm's JS output for hot reloading failed!

      ### Probe (found):
      /^var _Platform_worker =/m

      ### Regex to replace (not found!):
      /^var _Platform_worker =.+\\s*\\{\\s*return _Platform_initialize\\(/gm

      ### Replacement:
      $&"Platform.worker",

      ### Code running replacements on:
      (function(scope){
      'use strict';

      function F(arity, fun, wrapper) {
        wrapper.a = arity;
        wrapper.f = fun;
        return wrapper;
      }
    `);

    expect(content).toMatch("Not supposed to be here!");
  });

  describe("Parse web socket connect request url errors", () => {
    const originalWebSocket = WebSocket;

    afterEach(() => {
      window.WebSocket = originalWebSocket;
    });

    function modifyUrl(f: (url: URL) => void): void {
      class TestWebSocket extends WebSocket {
        constructor(url: URL | string) {
          if (typeof url === "string") {
            throw new Error(
              "TestWebSocket expects the url to be a URL object, not a string!"
            );
          }

          f(url);

          super(url);
        }
      }

      window.WebSocket = TestWebSocket;
    }

    test("bad url", async () => {
      modifyUrl((url) => {
        url.pathname = "nope";
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["BadUrl"],
        scripts: ["BadUrl.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ BadUrl⧙                                           0 ms Q |   0 ms T ¦   0 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙00:00:00⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 00:00:00 BadUrl
        ================================================================================
        ▼ ⏳ 00:00:00 BadUrl
        ================================================================================
        target BadUrl
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I expected the web socket connection URL to start with:

        /?

        But it looks like this:

        /nope?elmWatchVersion=%25VERSION%25&targetName=BadUrl&elmCompiledTimestamp=0

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here.
        ▲ ❌ 00:00:00 BadUrl
      `);
    });

    test("params decode error", async () => {
      modifyUrl((url) => {
        url.searchParams.set("elmCompiledTimestamp", "2021-12-11");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["ParamsDecodeError"],
        scripts: ["ParamsDecodeError.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ ParamsDecodeError⧙                                0 ms Q |   0 ms T ¦   0 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙00:00:00⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 00:00:00 ParamsDecodeError
        ================================================================================
        ▼ ⏳ 00:00:00 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I ran into trouble parsing the web socket connection URL parameters:

        At root["elmCompiledTimestamp"]:
        Expected a number
        Got: "2021-12-11"

        The URL looks like this:

        /?elmWatchVersion=%25VERSION%25&targetName=ParamsDecodeError&elmCompiledTimestamp=2021-12-11

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here. Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 00:00:00 ParamsDecodeError
      `);
    });

    test("wrong version", async () => {
      modifyUrl((url) => {
        url.searchParams.set("elmWatchVersion", "0.0.0");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["WrongVersion"],
        scripts: ["WrongVersion.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ WrongVersion⧙                                     0 ms Q |   0 ms T ¦   0 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙00:00:00⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 00:00:00 WrongVersion
        ================================================================================
        ▼ ⏳ 00:00:00 WrongVersion
        ================================================================================
        target WrongVersion
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it was compiled with:

        elm-watch 0.0.0

        But the server is:

        elm-watch %VERSION%

        Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 00:00:00 WrongVersion
      `);
    });

    test("target not found", async () => {
      modifyUrl((url) => {
        url.searchParams.set("targetName", "nope");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["TargetNotFound"],
        scripts: ["TargetNotFound.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ TargetNotFound⧙                                   0 ms Q |   0 ms T ¦   0 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙00:00:00⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 00:00:00 TargetNotFound
        ================================================================================
        ▼ ⏳ 00:00:00 TargetNotFound
        ================================================================================
        target TargetNotFound
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        nope

        But I can't find that target in elm-watch.json!

        These targets are available in elm-watch.json:

        TargetNotFound

        These targets are also available in elm-watch.json, but are not enabled (because of the CLI arguments passed):

        Html
        Worker
        Readonly
        InjectError
        BadUrl
        ParamsDecodeError
        WrongVersion

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        ▲ ❌ 00:00:00 TargetNotFound
      `);
    });

    test("target disabled", async () => {
      modifyUrl((url) => {
        url.searchParams.set("targetName", "Html");
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["TargetDisabled"],
        scripts: ["TargetDisabled.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ TargetDisabled⧙                                   0 ms Q |   0 ms T ¦   0 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙00:00:00⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 00:00:00 TargetDisabled
        ================================================================================
        ▼ ⏳ 00:00:00 TargetDisabled
        ================================================================================
        target TargetDisabled
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        Html

        That target does exist in elm-watch.json, but isn't enabled.

        These targets are enabled via CLI arguments:

        TargetDisabled

        These targets exist in elm-watch.json but aren't enabled:

        Html
        Worker
        Readonly
        InjectError
        BadUrl
        ParamsDecodeError
        WrongVersion
        TargetNotFound

        If you want to have this target compiled, restart elm-watch either with more CLI arguments or no CLI arguments at all!
        ▲ ❌ 00:00:00 TargetDisabled
      `);
    });
  });
});
