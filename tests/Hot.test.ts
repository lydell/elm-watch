/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

import {
  ElmModule,
  ReachedIdleStateReason,
  UppercaseLetter,
} from "../client/client";
import { elmWatchCli } from "../src";
import { CompilationMode } from "../src/Types";
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

// eslint-disable-next-line no-console
console.warn = () => {
  // Disable Elm’s “Compiled in DEV mode” logs.
};

let bodyCounter = 0;

type OnIdle = (params: {
  idle: number;
  div: HTMLDivElement;
  body: HTMLBodyElement;
  reason: ReachedIdleStateReason;
}) => OnIdleResult | Promise<OnIdleResult>;

type OnIdleResult = "KeepGoing" | "Stop";

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
  init: (node: HTMLDivElement) => void;
  onIdle: OnIdle;
  expandUiImmediately?: boolean;
  isTTY?: boolean;
  bin?: string;
}): Promise<{
  terminal: string;
  browser: string;
  renders: string;
  log: string;
  div: HTMLDivElement;
}> {
  const dir = path.join(FIXTURES_DIR, fixture);
  const build = path.join(dir, "build");
  const absoluteScripts = scripts.map((script) => path.join(build, script));
  const elmWatchStuff = path.join(dir, "elm-stuff", "elm-watch-stuff.json");

  if (fs.rmSync !== undefined) {
    fs.rmSync(build, { recursive: true, force: true });
  } else if (fs.existsSync(build)) {
    fs.rmdirSync(build, { recursive: true });
  }
  fs.mkdirSync(build, { recursive: true });

  if (fs.existsSync(elmWatchStuff)) {
    fs.unlinkSync(elmWatchStuff);
  }

  const stdout = new MemoryWriteStream();
  const stderr = new CursorWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const bodyIndex = bodyCounter + 2; // head + original body
  const body = document.createElement("body");
  const outerDiv = document.createElement("div");
  body.append(outerDiv);
  document.documentElement.append(body);
  bodyCounter++;

  const renders: Array<string> = [];
  const log: Array<string> = [];
  let loads = 0;

  await new Promise((resolve, reject) => {
    const loadBuiltFiles = (isReload: boolean): void => {
      loads++;
      delete window.Elm;
      Promise.all(
        absoluteScripts.map((script) => {
          // Copying the script does a couple of things:
          // - Avoiding require/import cache.
          // - Makes it easier to debug the tests since one can see all the outputs through time.
          // - Lets us make a few replacements for Jest.
          const newScript = script.replace(/\.(\w+)$/, `.${loads}.$1`);
          const content = fs
            .readFileSync(script, "utf8")
            .replace(/\(this\)\);\s*$/, "(window));")
            .replace(
              /^(\s*var bodyNode) = .+;/m,
              `$1 = document.documentElement.children[${bodyIndex}];`
            );
          fs.writeFileSync(newScript, content);
          return import(newScript);
        })
      ).then(() => {
        if (expandUiImmediately) {
          expandUi();
        }
        if (isReload) {
          const innerDiv = document.createElement("div");
          outerDiv.replaceChildren(innerDiv);
          body.replaceChildren(outerDiv);
          init(innerDiv);
        }
      }, reject);
    };

    window.__ELM_WATCH_GET_NOW = () => new Date(0);

    window.__ELM_WATCH_RELOAD_PAGE = () => {
      loadBuiltFiles(true);
    };

    window.__ELM_WATCH_ON_RENDER = (targetName) => {
      withShadowRoot((shadowRoot) => {
        const element = shadowRoot.lastElementChild;

        const text =
          element instanceof Node
            ? Array.from(element.childNodes, getTextContent)
                .join(`\n${"-".repeat(80)}\n`)
                .replace(/(ws:\/\/localhost):\d{5}/g, "$1:59123")
            : `#${CONTAINER_ID} not found in:\n${
                document.documentElement.outerHTML
              } for ${args.join(", ")}. Target: ${targetName}`;

        renders.push(text);
      });
    };

    // If the test looks like it will time out, try to log what has happened.
    // Will hopefully help getting clues for test flakiness.
    const timeoutId = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.log(`${args.join(", ")}\n${log.join("\n")}`);
    }, 3000);

    let idle = 0;
    window.__ELM_WATCH_ON_REACHED_IDLE_STATE = (reason) => {
      idle++;
      log.push(`${idle} ${reason}`);
      Promise.resolve(onIdle({ idle, div: outerDiv, body, reason })).then(
        (result) => {
          switch (result) {
            case "KeepGoing":
              return;
            case "Stop":
              window.__ELM_WATCH_KILL_ALL();
              clearTimeout(timeoutId);
              return;
          }
        },
        reject
      );
    };

    const watcher = fs.watch(build, () => {
      if (absoluteScripts.every(fs.existsSync)) {
        watcher.close();
        loadBuiltFiles(false);
      }
    });

    watcher.on("error", reject);

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
    }).then(resolve, reject);
  });

  const stderrString = clean(stderr.getOutput());

  expect(stdout.content).toBe("");

  const lastText = renders[renders.length - 1] ?? "No renders!";

  return {
    terminal: stderrString,
    browser: lastText,
    renders: renders.join(`\n${"=".repeat(80)}\n`),
    log: log.join("\n"),
    div: outerDiv,
  };
}

function withShadowRoot(f: (shadowRoot: ShadowRoot) => void): void {
  const shadowRoot =
    document.getElementById(CONTAINER_ID)?.shadowRoot ?? undefined;

  if (shadowRoot === undefined) {
    throw new Error(`Couldn’t find #${CONTAINER_ID}!`);
  } else {
    f(shadowRoot);
  }
}

function expandUi(): void {
  expandUiHelper(true);
}

function collapseUi(): void {
  expandUiHelper(false);
}

function expandUiHelper(wantExpanded: boolean): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot?.querySelector("button");
    if (button instanceof HTMLElement) {
      if (button.getAttribute("aria-expanded") !== wantExpanded.toString()) {
        button.click();
      }
    } else {
      throw new Error(`Could not button for expanding UI.`);
    }
  });
}

function switchCompilationMode(compilationMode: CompilationMode): void {
  expandUi();
  withShadowRoot((shadowRoot) => {
    const radio = shadowRoot?.querySelector(
      `input[type="radio"][value="${compilationMode}"]`
    );
    if (radio instanceof HTMLInputElement) {
      radio.click();
    } else {
      throw new Error(`Could not find radio button for ${compilationMode}.`);
    }
  });
}

function assertCompilationMode(compilationMode: CompilationMode): void {
  expandUi();
  withShadowRoot((shadowRoot) => {
    const radio = shadowRoot?.querySelector(`input[type="radio"]:checked`);
    if (radio instanceof HTMLInputElement) {
      expect(radio.value).toMatchInlineSnapshot(compilationMode);
    } else {
      throw new Error(
        `Could not find a checked radio button (expecting to be ${compilationMode}).`
      );
    }
  });
}

function assertDebugDisabled(): void {
  expandUi();
  withShadowRoot((shadowRoot) => {
    const radio = shadowRoot?.querySelector('input[type="radio"]');
    if (radio instanceof HTMLInputElement) {
      expect(radio.disabled).toMatchInlineSnapshot(`true`);
    } else {
      throw new Error(`Could not find any radio button!`);
    }
  });
  collapseUi();
}

function assertDebugger(body: HTMLBodyElement): void {
  expect(
    Array.from(body.querySelectorAll("svg"), (element) => element.localName)
  ).toMatchInlineSnapshot(`
    Array [
      svg,
    ]
  `);
}

function getTextContent(element: Node): string {
  return Array.from(walkTextNodes(element))
    .join("")
    .trim()
    .replace(/\n /g, "\n");
}

function* walkTextNodes(element: Node): Generator<string, void, void> {
  if (shouldAddNewline(element)) {
    yield "\n";
  }
  for (const node of element.childNodes) {
    if (node instanceof Text) {
      yield " ";
      yield node.data;
    } else if (node instanceof HTMLInputElement && node.type === "radio") {
      yield (node.checked ? "◉" : "◯") + (node.disabled ? " (disabled)" : "");
    } else if (node instanceof HTMLButtonElement) {
      const textContent = (node.textContent ?? "").trim();
      if (textContent.length === 1) {
        yield textContent;
      } else {
        yield "\n[";
        yield textContent;
        yield "]";
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

function htmlWithoutDebugger(element: HTMLElement): string {
  if (
    element.lastElementChild instanceof HTMLDivElement &&
    element.lastElementChild.style.position === "fixed"
  ) {
    const clone = element.cloneNode(true);
    if (clone instanceof HTMLElement && clone.lastElementChild !== null) {
      clone.removeChild(clone.lastElementChild);
      return clone.outerHTML;
    }
    throw new Error(
      "element.cloneNode(true) didn’t return an HTMLElement with a lastElementChild."
    );
  } else {
    return element.outerHTML;
  }
}

function failInit(): never {
  throw new Error("Expected `init` not to be called!");
}

function click(element: HTMLElement, selector: string): void {
  const target = element.querySelector(selector);
  if (target instanceof HTMLElement) {
    target.click();
  } else {
    throw new Error(
      `Element to click is not considered clickable: ${selector} -> ${
        target === null ? "not found" : target.nodeName
      }`
    );
  }
}

async function waitOneFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  beforeEach(() => {
    document.getElementById(CONTAINER_ID)?.remove();
  });

  test("successful connect (collapsed)", async () => {
    const { terminal, renders, div } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: () => "Stop",
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

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
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
      onIdle: () => "Stop",
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

  test("successful connect (package)", async () => {
    const { terminal, renders, div } = await run({
      fixture: "package",
      args: ["Main"],
      scripts: ["Main.js"],
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: Main⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ 🔌 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ✅ 00:00:00 Main
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>main</div>`);
  });

  test("fail to overwrite Elm’s output with hot injection (no postprocess)", async () => {
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["Readonly"],
      scripts: ["Readonly.js"],
      init: failInit,
      onIdle: () => {
        expandUi();
        return "Stop";
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
    const { terminal, renders } = await run({
      fixture: "basic",
      args: ["InjectError"],
      scripts: ["InjectError.js"],
      init: failInit,
      onIdle: () => {
        expandUi();
        return "Stop";
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

      /Users/you/project/tests/fixtures/hot/basic/build/elm-watch-InjectSearchAndReplaceNotFound-ad064e3cc0e8c86d9c08636f341b296e3a757f5914c638f11ec9541e7010c273.txt

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
      var _Platform_effectManagers = {}, _Scheduler_enqueue;

      function F(arity, fun, wrapper) {
        wrapper.a = arity;
        wrapper.f = fun;
        return wrapper;
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
        TargetDisabled
        SendBadJson

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        ▲ ❌ 00:00:00 TargetNotFound
      `);
    });

    test("target not found (no disabled targets)", async () => {
      modifyUrl((url) => {
        url.searchParams.set("targetName", "nope");
      });

      const { terminal, renders } = await run({
        fixture: "single",
        args: ["Main"],
        scripts: ["Main.js"],
        init: failInit,
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ Main⧙                                             0 ms Q |   0 ms T ¦   0 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙00:00:00⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 00:00:00 Main
        ================================================================================
        ▼ ⏳ 00:00:00 Main
        ================================================================================
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        nope

        But I can't find that target in elm-watch.json!

        These targets are available in elm-watch.json:

        Main

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        ▲ ❌ 00:00:00 Main
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
        SendBadJson

        If you want to have this target compiled, restart elm-watch either with more CLI arguments or no CLI arguments at all!
        ▲ ❌ 00:00:00 TargetDisabled
      `);
    });

    test("send bad json", async () => {
      let first = true;

      class TestWebSocket extends WebSocket {
        override send(message: string): void {
          if (first) {
            super.send(JSON.stringify({ tag: "Nope" }));
            first = false;
          } else {
            super.send(message);
          }
        }
      }

      window.WebSocket = TestWebSocket;

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["SendBadJson"],
        scripts: ["SendBadJson.js"],
        init: (node) => {
          window.Elm?.HtmlMain?.init({ node });
        },
        onIdle: ({ idle }) => {
          switch (idle) {
            case 1:
              switchCompilationMode("optimize");
              return "KeepGoing";
            default:
              return "Stop";
          }
        },
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ SendBadJson⧙                           0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected for: SendBadJson⧘
        ✅ ⧙00:00:00⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 00:00:00 SendBadJson
        ================================================================================
        ▼ ⏳ 00:00:00 SendBadJson
        ================================================================================
        ▼ ⏳ 00:00:00 SendBadJson
        ================================================================================
        ▼ 🔌 00:00:00 SendBadJson
        ================================================================================
        ▼ ⏳ 00:00:00 SendBadJson
        ================================================================================
        ▼ ✅ 00:00:00 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ▲ ✅ 00:00:00 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize Note: It's not always possible to hot reload optimized code, because of record field mangling. Sometimes the whole page is reloaded!
        ▲ ⏳ 00:00:00 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 1970-01-01 00:00:00
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["tag"]:
        Expected one of these tags: "ChangedCompilationMode", "FocusedTab", "ExitRequested"
        Got: "Nope"

        The web socket code I generate is supposed to always send correct messages, so something is up here.
        ▲ ❌ 00:00:00 SendBadJson
      `);
    });
  });

  // Note: These tests excessively uses snapshots, since they don’t stop execution on failure.
  // That results in a much better debugging experience (fewer timeouts).
  describe("hot reloading", () => {
    function runHotReload({ name }: { name: `${UppercaseLetter}${string}` }): {
      write: (n: number) => void;
      writeSimpleChange: () => void;
      sendToElm: (value: number) => void;
      terminate: () => void;
      lastValueFromElm: { value: unknown };
      go: (onIdle: OnIdle) => ReturnType<typeof run>;
    } {
      const fixture = "hot-reload";
      const src = path.join(FIXTURES_DIR, fixture, "src");

      const write = (n: number): void => {
        const content = fs.readFileSync(
          path.join(src, `${name}${n}.elm`),
          "utf8"
        );
        fs.writeFileSync(
          path.join(src, `${name}.elm`),
          content.replace(`module ${name}${n}`, `module ${name}`)
        );
      };

      const writeSimpleChange = (): void => {
        const content = fs.readFileSync(path.join(src, `${name}.elm`), "utf8");
        fs.writeFileSync(
          path.join(src, `${name}.elm`),
          content.replace(`hot reload`, `simple text change`)
        );
      };

      let app: ReturnType<ElmModule["init"]> | undefined;
      const lastValueFromElm: { value: unknown } = { value: undefined };

      const sendToElm = (value: number): void => {
        const send = app?.ports?.fromJs?.send;
        if (send === undefined) {
          throw new Error("Failed to find 'fromJs' send port.");
        }
        send(value);
      };

      const terminate = (): void => {
        const send = app?.ports?.terminate?.send;
        if (send === undefined) {
          throw new Error("Failed to find 'terminate' send port.");
        }
        send(null);
      };

      return {
        write,
        writeSimpleChange,
        sendToElm,
        terminate,
        lastValueFromElm,
        go: (onIdle: OnIdle) =>
          run({
            fixture,
            args: [name],
            scripts: [`${name}.js`],
            init: (node) => {
              app = window.Elm?.[name]?.init({ node });
              if (app?.ports !== undefined) {
                const subscribe = app.ports.toJs?.subscribe;
                if (subscribe === undefined) {
                  throw new Error("Failed to find 'toJs' subscribe port.");
                }
                subscribe((value: unknown) => {
                  lastValueFromElm.value = value;
                });
              }
            },
            onIdle,
          }),
      };
    }

    test("Html", async () => {
      const { write, writeSimpleChange, go } = runHotReload({
        name: "HtmlMain",
      });

      let probe: HTMLElement | null = null;

      write(1);

      const { log } = await go(({ idle, div }) => {
        switch (idle) {
          case 1:
            assertDebugDisabled();
            assertInit(div);
            writeSimpleChange();
            return "KeepGoing";
          case 2:
            assertHotReload(div);
            write(1);
            return "KeepGoing";
          case 3:
            switchCompilationMode("optimize");
            return "KeepGoing";
          case 4:
            assertCompilationMode("optimize");
            assertDebugDisabled();
            assertInit(div);
            writeSimpleChange();
            return "KeepGoing";
          default:
            assertHotReload(div);
            return "Stop";
        }
      });

      expect(log).toMatchInlineSnapshot(`
        1 AlreadyUpToDate
        2 EvalSucceeded
        3 EvalSucceeded
        4 AlreadyUpToDate
        5 EvalSucceeded
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

    test("Sandbox", async () => {
      const { write, writeSimpleChange, go } = runHotReload({
        name: "Sandbox",
      });

      let probe: HTMLElement | null = null;

      write(1);

      const { log } = await go(async ({ idle, body, div }) => {
        switch (idle) {
          case 1:
            await assertInit(div);
            write(2);
            return "KeepGoing";
          case 2:
            await assertHotReload(div);
            write(1);
            return "KeepGoing";
          case 3:
            switchCompilationMode("debug");
            return "KeepGoing";
          case 4:
            assertCompilationMode("debug");
            assertDebugger(body);
            await assertInit(div);
            write(2);
            return "KeepGoing";
          case 5:
            await assertHotReload(div);
            write(1);
            return "KeepGoing";
          case 6:
            switchCompilationMode("optimize");
            return "KeepGoing";
          case 7:
            assertCompilationMode("optimize");
            await assertInit(div);
            write(2);
            return "KeepGoing";
          case 8:
            await assertReloadForOptimize(div);
            writeSimpleChange();
            return "KeepGoing";
          default:
            assertHotReloadForOptimize(div);
            return "Stop";
        }
      });

      expect(log).toMatchInlineSnapshot(`
        1 AlreadyUpToDate
        2 EvalSucceeded
        3 EvalSucceeded
        4 AlreadyUpToDate
        5 EvalSucceeded
        6 EvalSucceeded
        7 AlreadyUpToDate
        8 AlreadyUpToDate
        9 EvalSucceeded
      `);

      async function assertInit(div: HTMLDivElement): Promise<void> {
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
          originalButtonClicked: 0
          newButtonClicked: 0
          </pre></div></div>
        `);

        probe = div.querySelector(".probe");
        expect(probe?.outerHTML).toMatchInlineSnapshot(
          `<h1 class="probe">Before hot reload</h1>`
        );

        click(div, "button");
        await waitOneFrame();
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
          originalButtonClicked: 1
          newButtonClicked: 0
          </pre></div></div>
        `);
      }

      async function assertHotReload(div: HTMLDivElement): Promise<void> {
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          originalButtonClicked: 1
          newButtonClicked: 0
          </pre></div></div>
        `);

        expect(div.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `true`
        );

        click(div, "button");
        await waitOneFrame();
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          originalButtonClicked: 1
          newButtonClicked: 1
          </pre></div></div>
        `);
      }

      async function assertReloadForOptimize(
        div: HTMLDivElement
      ): Promise<void> {
        expect(div.outerHTML).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          originalButtonClicked: 0
          newButtonClicked: 0
          </pre></div></div>
        `);

        expect(div.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `false`
        );

        click(div, "button");
        await waitOneFrame();
        expect(div.outerHTML).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          originalButtonClicked: 0
          newButtonClicked: 1
          </pre></div></div>
        `);
      }

      function assertHotReloadForOptimize(div: HTMLDivElement): void {
        expect(div.outerHTML).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After simple text change</h1><button>Button</button><pre>
          originalButtonClicked: 0
          newButtonClicked: 1
          </pre></div></div>
        `);
      }
    });

    test("Element", async () => {
      const {
        write,
        writeSimpleChange,
        sendToElm,
        terminate,
        lastValueFromElm,
        go,
      } = runHotReload({
        name: "Element",
      });

      let probe: HTMLElement | null = null;

      write(1);

      const { log } = await go(async ({ idle, body, div }) => {
        switch (idle) {
          case 1:
            await assertInit(div);
            write(2);
            return "KeepGoing";
          case 2:
            await assertHotReload(div);
            terminate();
            write(1);
            return "KeepGoing";
          case 3:
            switchCompilationMode("debug");
            return "KeepGoing";
          case 4:
            assertCompilationMode("debug");
            assertDebugger(body);
            await assertInit(div);
            write(2);
            return "KeepGoing";
          case 5:
            await assertHotReload(div);
            terminate();
            write(1);
            return "KeepGoing";
          case 6:
            switchCompilationMode("optimize");
            return "KeepGoing";
          case 7:
            assertCompilationMode("optimize");
            await assertInit(div);
            terminate();
            write(2);
            return "KeepGoing";
          case 8:
            await assertReloadForOptimize(div);
            writeSimpleChange();
            return "KeepGoing";
          default:
            assertHotReloadForOptimize(div);
            terminate();
            return "Stop";
        }
      });

      expect(log).toMatchInlineSnapshot(`
        1 AlreadyUpToDate
        2 EvalSucceeded
        3 EvalSucceeded
        4 AlreadyUpToDate
        5 EvalSucceeded
        6 EvalSucceeded
        7 AlreadyUpToDate
        8 AlreadyUpToDate
        9 EvalSucceeded
      `);

      async function assertInit(div: HTMLDivElement): Promise<void> {
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 0
          newButtonClicked: 0
          originalFromJs: []
          newFromJs: []
          </pre></div></div>
        `);

        probe = div.querySelector(".probe");
        expect(probe?.outerHTML).toMatchInlineSnapshot(
          `<h1 class="probe">Before hot reload</h1>`
        );

        click(div, "button");
        await waitOneFrame();
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 1
          newButtonClicked: 0
          originalFromJs: []
          newFromJs: []
          </pre></div></div>
        `);

        sendToElm(2);
        await waitOneFrame();
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 1
          newButtonClicked: 0
          originalFromJs: [2]
          newFromJs: []
          </pre></div></div>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`4`);
      }

      async function assertHotReload(div: HTMLDivElement): Promise<void> {
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 1
          newButtonClicked: 0
          originalFromJs: [2]
          newFromJs: []
          </pre></div></div>
        `);

        expect(div.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `true`
        );

        click(div, "button");
        await waitOneFrame();
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 1
          newButtonClicked: 1
          originalFromJs: [2]
          newFromJs: []
          </pre></div></div>
        `);

        sendToElm(3);
        await waitOneFrame();
        expect(htmlWithoutDebugger(div)).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 1
          newButtonClicked: 1
          originalFromJs: [2]
          newFromJs: [3]
          </pre></div></div>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`12`);
      }

      async function assertReloadForOptimize(
        div: HTMLDivElement
      ): Promise<void> {
        expect(div.outerHTML).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 0
          newButtonClicked: 0
          originalFromJs: []
          newFromJs: []
          </pre></div></div>
        `);

        expect(div.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `false`
        );

        click(div, "button");
        await waitOneFrame();
        expect(div.outerHTML).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 0
          newButtonClicked: 1
          originalFromJs: []
          newFromJs: []
          </pre></div></div>
        `);

        sendToElm(3);
        await waitOneFrame();
        expect(div.outerHTML).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 0
          newButtonClicked: 1
          originalFromJs: []
          newFromJs: [3]
          </pre></div></div>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`12`);
      }

      function assertHotReloadForOptimize(div: HTMLDivElement): void {
        expect(div.outerHTML).toMatchInlineSnapshot(`
          <div><div><h1 class="probe">After simple text change</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 0
          newButtonClicked: 1
          originalFromJs: []
          newFromJs: [3]
          </pre></div></div>
        `);
      }
    });

    test("Application", async () => {
      const {
        write,
        writeSimpleChange,
        sendToElm,
        terminate,
        lastValueFromElm,
        go,
      } = runHotReload({ name: "Application" });

      let probe: HTMLElement | null = null;

      write(1);

      const { log } = await go(async ({ idle, body }) => {
        switch (idle) {
          case 1:
            await assertInit(body);
            write(2);
            return "KeepGoing";
          case 2:
            await assertHotReload(body);
            terminate();
            write(1);
            return "KeepGoing";
          case 3:
            switchCompilationMode("debug");
            return "KeepGoing";
          case 4:
            assertCompilationMode("debug");
            assertDebugger(body);
            await assertInit(body);
            write(2);
            return "KeepGoing";
          case 5:
            await assertHotReload(body);
            terminate();
            write(1);
            return "KeepGoing";
          case 6:
            switchCompilationMode("optimize");
            return "KeepGoing";
          case 7:
            assertCompilationMode("optimize");
            await assertInit(body);
            terminate();
            write(2);
            return "KeepGoing";
          case 8:
            await assertReloadForOptimize(body);
            writeSimpleChange();
            return "KeepGoing";
          default:
            assertHotReloadForOptimize(body);
            terminate();
            return "Stop";
        }
      });

      expect(log).toMatchInlineSnapshot(`
        1 AlreadyUpToDate
        2 EvalSucceeded
        3 EvalSucceeded
        4 AlreadyUpToDate
        5 EvalSucceeded
        6 EvalSucceeded
        7 AlreadyUpToDate
        8 AlreadyUpToDate
        9 EvalSucceeded
      `);

      async function assertInit(body: HTMLBodyElement): Promise<void> {
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/
          originalFromJs: []
          originalUrlRequested: 0
          originalUrlChanged: 0
          newFromJs: []
          newUrlRequested: 0
          newUrlChanged: 0
          browserOnClick: 0
          </pre></div></body>
        `);

        probe = body.querySelector(".probe");
        expect(probe?.outerHTML).toMatchInlineSnapshot(
          `<h1 class="probe">Before hot reload</h1>`
        );

        click(body, "a");
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/link
          originalFromJs: []
          originalUrlRequested: 1
          originalUrlChanged: 1
          newFromJs: []
          newUrlRequested: 0
          newUrlChanged: 0
          browserOnClick: 0
          </pre></div></body>
        `);

        click(body, "button");
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/push
          originalFromJs: []
          originalUrlRequested: 1
          originalUrlChanged: 2
          newFromJs: []
          newUrlRequested: 0
          newUrlChanged: 0
          browserOnClick: 0
          </pre></div></body>
        `);

        sendToElm(2);
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/push
          originalFromJs: [2]
          originalUrlRequested: 1
          originalUrlChanged: 2
          newFromJs: []
          newUrlRequested: 0
          newUrlChanged: 0
          browserOnClick: 0
          </pre></div></body>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`4`);
      }

      async function assertHotReload(body: HTMLBodyElement): Promise<void> {
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/push
          originalFromJs: [2]
          originalUrlRequested: 1
          originalUrlChanged: 2
          newFromJs: []
          newUrlRequested: 0
          newUrlChanged: 0
          browserOnClick: 0
          </pre></div></body>
        `);

        expect(body.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `true`
        );

        click(body, "a");
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/link
          originalFromJs: [2]
          originalUrlRequested: 1
          originalUrlChanged: 2
          newFromJs: []
          newUrlRequested: 1
          newUrlChanged: 1
          browserOnClick: 1
          </pre></div></body>
        `);

        click(body, "button");
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/push
          originalFromJs: [2]
          originalUrlRequested: 1
          originalUrlChanged: 2
          newFromJs: []
          newUrlRequested: 1
          newUrlChanged: 2
          browserOnClick: 2
          </pre></div></body>
        `);

        sendToElm(3);
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/push
          originalFromJs: [2]
          originalUrlRequested: 1
          originalUrlChanged: 2
          newFromJs: [3]
          newUrlRequested: 1
          newUrlChanged: 2
          browserOnClick: 2
          </pre></div></body>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`12`);
      }

      async function assertReloadForOptimize(
        body: HTMLBodyElement
      ): Promise<void> {
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/
          originalFromJs: []
          originalUrlRequested: 0
          originalUrlChanged: 0
          newFromJs: []
          newUrlRequested: 0
          newUrlChanged: 0
          browserOnClick: 0
          </pre></div></body>
        `);

        expect(body.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `false`
        );

        click(body, "a");
        await waitOneFrame();
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/link
          originalFromJs: []
          originalUrlRequested: 0
          originalUrlChanged: 0
          newFromJs: []
          newUrlRequested: 1
          newUrlChanged: 1
          browserOnClick: 1
          </pre></div></body>
        `);

        click(body, "button");
        await waitOneFrame();
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/push
          originalFromJs: []
          originalUrlRequested: 0
          originalUrlChanged: 0
          newFromJs: []
          newUrlRequested: 1
          newUrlChanged: 2
          browserOnClick: 2
          </pre></div></body>
        `);

        sendToElm(3);
        await waitOneFrame();
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/push
          originalFromJs: []
          originalUrlRequested: 0
          originalUrlChanged: 0
          newFromJs: [3]
          newUrlRequested: 1
          newUrlChanged: 2
          browserOnClick: 2
          </pre></div></body>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`12`);
      }

      function assertHotReloadForOptimize(body: HTMLBodyElement): void {
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After simple text change</h1><a href="/link">Link</a><button>Button</button><pre>
          url: http://localhost/push
          originalFromJs: []
          originalUrlRequested: 0
          originalUrlChanged: 0
          newFromJs: [3]
          newUrlRequested: 1
          newUrlChanged: 2
          browserOnClick: 2
          </pre></div></body>
        `);
      }
    });
  });
});
