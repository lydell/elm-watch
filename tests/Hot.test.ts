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
import { Env } from "../src/Helpers";
import { CompilationMode, GetNow } from "../src/Types";
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
  env,
  getNow = () => new Date(0),
  keepElmStuffJson = false,
  cwd = ".",
}: {
  fixture: string;
  scripts: Array<string>;
  args?: Array<string>;
  init: (node: HTMLDivElement) => void;
  onIdle: OnIdle;
  expandUiImmediately?: boolean;
  isTTY?: boolean;
  bin?: string;
  env?: Env;
  getNow?: GetNow;
  keepElmStuffJson?: boolean;
  cwd?: string;
}): Promise<{
  terminal: string;
  browser: string;
  renders: string;
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

  if (!keepElmStuffJson) {
    rm(elmWatchStuff);
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
          try {
            init(innerDiv);
          } catch (unknownError) {
            const isElmWatchProxyError =
              typeof unknownError === "object" &&
              unknownError !== null &&
              (unknownError as { elmWatchProxy?: boolean }).elmWatchProxy ===
                true;
            if (!isElmWatchProxyError || absoluteScripts.length === 1) {
              throw unknownError;
            }
          }
        }
      }, reject);
    };

    window.__ELM_WATCH_SKIP_RECONNECT_TIME_CHECK = true;

    window.__ELM_WATCH_GET_NOW = getNow;

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

    let idle = 0;
    window.__ELM_WATCH_ON_REACHED_IDLE_STATE = (reason) => {
      idle++;
      Promise.resolve(onIdle({ idle, div: outerDiv, body, reason })).then(
        (result) => {
          switch (result) {
            case "KeepGoing":
              return;
            case "Stop":
              window.__ELM_WATCH_KILL_ALL();
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
      cwd: path.join(dir, cwd),
      env:
        bin === undefined
          ? {
              ...process.env,
              ...TEST_ENV,
              ...env,
            }
          : {
              ...badElmBinEnv(path.join(dir, "bad-bin", bin)),
              ...env,
            },
      stdin: new FailReadStream(),
      stdout,
      stderr,
      getNow,
    }).then(resolve, reject);
  });

  const stderrString = clean(stderr.getOutput());

  expect(stdout.content).toBe("");

  const lastText = renders[renders.length - 1] ?? "No renders!";

  return {
    terminal: stderrString,
    browser: lastText,
    renders: renders.join(`\n${"=".repeat(80)}\n`),
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

async function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

function touch(filePath: string): void {
  const now = new Date();
  fs.utimesSync(filePath, now, now);
}

function rm(filePath: string): void {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      fs.rmdirSync(filePath);
    }
  }
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

      /Users/you/project/tests/fixtures/hot/basic/build/elm-watch-InjectSearchAndReplaceNotFound-e350dd8c5507e92b6da873f1f78e716b2734f2992de99ba1109151f4c1b0a9d9.txt

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

  test("changes to elm-watch.json", async () => {
    const fixture = "changes-to-elm-watch-json";
    const elmWatchJsonPath = path.join(FIXTURES_DIR, fixture, "elm-watch.json");
    const elmWatchJsonPath2 = path.join(
      FIXTURES_DIR,
      fixture,
      "src",
      "elm-watch.json"
    );
    const elmWatchJsonTemplatePath = path.join(
      FIXTURES_DIR,
      fixture,
      "elm-watch.template.json"
    );
    const roguePath = path.join(
      FIXTURES_DIR,
      fixture,
      "rogue",
      "elm-watch.json"
    );
    const elmWatchJsonString = fs.readFileSync(
      elmWatchJsonTemplatePath,
      "utf8"
    );
    fs.writeFileSync(elmWatchJsonPath, elmWatchJsonString);
    fs.writeFileSync(roguePath, "ROGUE");
    rm(elmWatchJsonPath2);

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      cwd: "src",
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.slice(0, -10)
            );
            touch(roguePath);
            await wait(100);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.replace(/"postprocess":.*/, "")
            );
            return "KeepGoing" as const;
          case 2:
            assert2(div);
            fs.writeFileSync(elmWatchJsonPath2, "{}");
            await wait(100);
            fs.unlinkSync(elmWatchJsonPath2);
            return "KeepGoing";
          case 3:
            assert2(div);
            fs.unlinkSync(elmWatchJsonPath);
            return "KeepGoing";
          default:
            throw new Error(
              "Expected elm-watch to exit due to no elm-watch.json!"
            );
        }
      },
    });

    window.__ELM_WATCH_KILL_ALL();

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I |   0 ms R |   0 ms P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
      ⧙-- TROUBLE READING elm-watch.json ----------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble reading it as JSON:⧘

      Unexpected end of JSON input

      🚨 ⧙1⧘ error found
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/elm-watch.json⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/src/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble with the JSON inside:⧘

      At root["targets"]:
      Expected an object
      Got: undefined

      🚨 ⧙1⧘ error found
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/src/elm-watch.json⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⧙-- elm-watch.json NOT FOUND ----------------------------------------------------⧘

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙But I couldn't find one!⧘

      You need to create one with JSON like this:

      {
          "targets": {
              "MyTargetName": {
                  "inputs": [
                      "src/Main.elm"
                  ],
                  "output": "build/main.js"
              }
          }
      }
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>THE TEXT!</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("changes to elm.json", async () => {
    const fixture = "changes-to-elm-json";
    const elmJsonPath = path.join(FIXTURES_DIR, fixture, "elm.json");
    const elmJsonPath2 = path.join(FIXTURES_DIR, fixture, "src", "elm.json");
    const elmJsonTemplatePath = path.join(
      FIXTURES_DIR,
      fixture,
      "elm.template.json"
    );
    const roguePath = path.join(FIXTURES_DIR, fixture, "rogue", "elm.json");
    const elmJsonString = fs.readFileSync(elmJsonTemplatePath, "utf8");
    fs.writeFileSync(elmJsonPath, elmJsonString);
    fs.writeFileSync(roguePath, "ROGUE");
    rm(elmJsonPath2);

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      cwd: "src",
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert(div);
            fs.writeFileSync(elmJsonPath, elmJsonString.slice(0, -10));
            touch(roguePath);
            return "KeepGoing";
          case 2:
            fs.writeFileSync(elmJsonPath, elmJsonString);
            return "KeepGoing";
          case 3:
            assert(div);
            fs.writeFileSync(elmJsonPath2, "{\n}");
            return "KeepGoing";
          case 4:
            fs.unlinkSync(elmJsonPath2);
            return "KeepGoing";
          case 5:
            assert(div);
            fs.unlinkSync(elmJsonPath);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
      ⏳ Dependencies
      ⛔️ Dependencies
      ⏳ HtmlMain: elm make
      🚨 HtmlMain

      ⧙-- EXTRA COMMA -----------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      I ran into a problem with your elm.json file. I was partway through parsing a
      JSON object when I got stuck here:

      20|     "test-dependencies": {
      21|         "direct": {},
      22|         "indirect": {
                               ⧙^⧘
      I saw a comma right before I got stuck here, so I was expecting to see a field
      name like ⧙"type"⧘ or ⧙"dependencies"⧘ next.

      This error is commonly caused by trailing commas in JSON objects. Those are
      actually disallowed by <https://json.org> so check the previous line for a
      trailing comma that may need to be deleted.

      ⧙Note⧘: Here is an example of a valid JSON object for reference:

          {
            ⧙"name"⧘: ⧙"Tom"⧘,
            ⧙"age"⧘: ⧙42⧘
          }

      Notice that (1) the field names are in double quotes and (2) there is no
      trailing comma after the last entry. Both are strict requirements in JSON!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Dependencies
      ⛔️ Dependencies
      ⏳ HtmlMain: elm make
      🚨 HtmlMain

      ⧙-- MISSING FIELD ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/elm.json

      I ran into a problem with your elm.json file. I ran into some trouble here:

      1| {
         ⧙^⧘
      I was expecting to run into an ⧙OBJECT⧘ with a ⧙"type"⧘ field.

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/elm.json⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/elm.json⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🚨 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🚨 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🚨 00:00:00 HtmlMain
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("changes to elm-watch-node JS file", async () => {
    const fixture = "changes-to-postprocess";
    const postprocessPath = path.join(FIXTURES_DIR, fixture, "postprocess.js");
    const postprocessTemplatePath = path.join(
      FIXTURES_DIR,
      fixture,
      "postprocess.template.js"
    );
    const roguePath = path.join(FIXTURES_DIR, fixture, "src", "postprocess.js");
    const postprocessString = fs.readFileSync(postprocessTemplatePath, "utf8");
    fs.writeFileSync(postprocessPath, postprocessString);
    fs.writeFileSync(roguePath, "ROGUE");

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            fs.writeFileSync(postprocessPath, postprocessString.slice(0, -10));
            touch(roguePath);
            return "KeepGoing";
          case 2:
            fs.writeFileSync(
              postprocessPath,
              postprocessString.replace("toUpperCase", "toLowerCase")
            );
            return "KeepGoing";
          case 3:
            assert2(div);
            fs.unlinkSync(postprocessPath);
            return "KeepGoing";
          case 4:
            fs.writeFileSync(postprocessPath, postprocessString);
            return "KeepGoing";
          default:
            assert1(div);
            return "Stop";
        }
      },
    });

    expect(terminal.replace(/^ +at.+\n/gm, "")).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I |   0 ms R |   0 ms P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      🚨 HtmlMain

      ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js

      I tried to import your postprocess file:

      const imported = await import("/Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js")

      But that resulted in this error:

      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js:1
      module.exports = ([code]) => code.replace("The text!", match => match.toUppe
                                                                            ^^^^^^

      SyntaxError: missing ) after argument list

      🚨 ⧙1⧘ error found

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I |   0 ms R |   0 ms P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      🚨 HtmlMain

      ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js

      I tried to import your postprocess file:

      const imported = await import("/Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js")

      But that resulted in this error:

      Cannot find module '/Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js' imported from /Users/you/project/src/PostprocessWorker.ts

      🚨 ⧙1⧘ error found

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Removed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I |   0 ms R |   0 ms P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Added /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🚨 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🚨 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>THE TEXT!</div>`);
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>the text!</div>`);
    }
  });

  // - Create and delete directories named `Something.elm`.
  // - Create and delete a file named like a package (`Html.elm`).
  test("changes to .elm files", async () => {
    const fixture = "changes-to-elm-files";
    const htmlPath = path.join(FIXTURES_DIR, fixture, "src", "Html.elm");
    rm(htmlPath);

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain"],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      cwd: "src",
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert(div);
            fs.mkdirSync(htmlPath);
            return "KeepGoing";
          case 2:
            fs.rmdirSync(htmlPath);
            return "KeepGoing";
          case 3:
            fs.writeFileSync(htmlPath, "");
            return "KeepGoing";
          case 4:
            fs.unlinkSync(htmlPath);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
      ⏳ HtmlMain: elm make
      🚨 HtmlMain

      ⧙-- TROUBLE READING ELM FILES ---------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      When figuring out all Elm files that your inputs depend on I read a lot of Elm files.
      Doing so I encountered this error:

      EISDIR: illegal operation on a directory, read

      (I still managed to compile your code, but the watcher will not work properly
      and "postprocess" was not run.)

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      🚨 HtmlMain

      ⧙-- AMBIGUOUS IMPORT ------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/HtmlMain.elm:3:8

      You are trying to import a \`Html\` module:

      3| import Html
                ⧙^^^^⧘
      But I found multiple modules with that name. One in the ⧙elm/html⧘ package, and
      another defined locally in the
      ⧙/Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      file. I do not have a way to choose between them.

      Try changing the name of the locally defined module to clear up the ambiguity?

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🚨 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🚨 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("non interesting .elm files changed, with disabled targets", async () => {
    const fixture = "non-interesting-elm-files-changed-disabled-targets";
    const unusedFolder = path.join(FIXTURES_DIR, fixture, "src", "Unused");

    const { terminal, renders } = await run({
      fixture,
      args: ["HtmlMain1"],
      scripts: ["HtmlMain1.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain1?.init({ node });
      },
      onIdle: async ({ div }) => {
        assert(div);
        for (const filePath of fs.readdirSync(unusedFolder)) {
          await wait(8);
          touch(path.join(unusedFolder, filePath));
        }
        await wait(100);
        return "Stop" as const;
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain1: elm make (typecheck only)
      ✅ HtmlMain1⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain1: elm make
      ✅ HtmlMain1⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: HtmlMain1⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: HtmlMain1⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: HtmlMain1⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File1.elm
      ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File2.elm⧘
      ✅ ⧙00:00:00⧘ FYI: The above Elm files are not imported by any of the enabled targets. Nothing to do!
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 HtmlMain1
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain1
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain1
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain1
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain1
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain1
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain1
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("non interesting .elm files changed, with all targets enabled", async () => {
    const fixture = "non-interesting-elm-files-changed-all-targets";
    const unusedFile1 = path.join(FIXTURES_DIR, fixture, "src", "Unused.elm");

    const { terminal, renders } = await run({
      fixture,
      args: [],
      scripts: ["HtmlMain.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: async ({ div }) => {
        assert(div);
        touch(unusedFile1);
        await wait(100);
        return "Stop" as const;
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: HtmlMain⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-all-targets/src/Unused.elm⧘
      ✅ ⧙00:00:00⧘ FYI: The above Elm file is not imported by any target. Nothing to do!
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ 🔌 00:00:00 HtmlMain
      ================================================================================
      ▼ ⏳ 00:00:00 HtmlMain
      ================================================================================
      ▼ ✅ 00:00:00 HtmlMain
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>The text!</div>`);
    }
  });

  test("typecheck-only should not break because of duplicate inputs", async () => {
    const { terminal, renders } = await run({
      fixture: "typecheck-only-unique",
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Target1: elm make (typecheck only)
      ⏳ Target2: elm make (typecheck only)
      ⏳ Target3: elm make (typecheck only)
      ✅ Target1⧙     0 ms Q |   0 ms T ¦   0 ms W⧘
      ✅ Target2⧙     0 ms Q |   0 ms T ¦   0 ms W⧘
      ✅ Target3⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Target1: elm make
      ✅ Target1⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: Target1⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: Target1⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: Target1⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 Target1
      ================================================================================
      ▼ ⏳ 00:00:00 Target1
      ================================================================================
      ▼ ⏳ 00:00:00 Target1
      ================================================================================
      ▼ 🔌 00:00:00 Target1
      ================================================================================
      ▼ 🔌 00:00:00 Target1
      ================================================================================
      ▼ ⏳ 00:00:00 Target1
      ================================================================================
      ▼ ✅ 00:00:00 Target1
    `);
  });

  test("kill postprocess", async () => {
    const fixture = "kill-postprocess";
    const input = path.join(FIXTURES_DIR, fixture, "src", "Main.elm");
    const tmp = path.join(FIXTURES_DIR, fixture, "postprocess.tmp");
    fs.writeFileSync(tmp, "1");
    const { terminal, renders } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            touch(input);
            await wait(1000); // Wait for Elm to finish and postprocess to start.
            touch(input); // Touch while postprocessing.
            return "KeepGoing";
          default:
            assert2(div);
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I |   0 ms R |   0 ms P⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: Main⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: Main⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: Main⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ⏳ Main: interrupted
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I |   0 ms R |   0 ms P⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess/src/Main.elm
      ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess/src/Main.elm⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
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
      ▼ 🔌 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ✅ 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ✅ 00:00:00 Main
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content before</div>`
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content after</div>`
      );
    }
  });

  test("kill postprocess (elm-watch-node)", async () => {
    const fixture = "kill-postprocess-elm-watch-node";
    const input = path.join(FIXTURES_DIR, fixture, "src", "Main.elm");
    const tmp = path.join(FIXTURES_DIR, fixture, "postprocess.tmp");
    fs.writeFileSync(tmp, "1");
    const { terminal, renders } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            touch(input);
            await wait(1000); // Wait for Elm to finish and postprocess to start.
            touch(input); // Touch while postprocessing.
            return "KeepGoing";
          default:
            assert2(div);
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I |   0 ms R |   0 ms P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: Main⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: Main⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: Main⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ⏳ Main: interrupted
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I |   0 ms R |   0 ms P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess-elm-watch-node/src/Main.elm
      ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess-elm-watch-node/src/Main.elm⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: Main⧘
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
      ▼ 🔌 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ✅ 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ⏳ 00:00:00 Main
      ================================================================================
      ▼ ✅ 00:00:00 Main
    `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content before</div>`
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content after</div>`
      );
    }
  });

  test("limit postprocess workers", async () => {
    let now = 0;
    const timeout = 50;
    const { terminal } = await run({
      fixture: "limit-postprocess-workers",
      args: [],
      scripts: ["One.js", "Two.js"],
      isTTY: false,
      env: {
        __ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS: timeout.toString(),
      },
      getNow: () => new Date((now += timeout)),
      init: (node) => {
        const node1 = document.createElement("div");
        const node2 = document.createElement("div");
        node.append(node1, node2);
        window.Elm?.One?.init({ node: node1 });
        window.Elm?.Two?.init({ node: node2 });
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1:
            return "KeepGoing"; // First script has loaded.
          default:
            window.__ELM_WATCH_KILL_ONE("Two");
            await wait(timeout * 2); // Wait for the worker to be killed.
            return "Stop";
        }
      },
    });

    const cleanedTerminal = terminal
      .replace(/ *⧙?[\d.]+⧘? m?s\b.*/g, " (timings)")
      .replace(/\d{2,}/g, (match) => "1".repeat(match.length));

    expect(cleanedTerminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ One: elm make (typecheck only)
      ⏳ Two: elm make (typecheck only)
      ✅ One⧙ (timings)
      ✅ Two⧙ (timings)

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:11111)⧘

      ✅ ⧙11:11:11⧘ Compilation finished in (timings)
      ⏳ One: elm make
      ⚪️ Two: queued
      🟢 One: elm make done
      ⏳ One: postprocess
      ⏳ Two: elm make
      🟢 Two: elm make done
      ⏳ Two: postprocess
      ✅ One⧙ (timings)
      ✅ Two⧙ (timings)

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:11111)⧘

      ⧙ℹ️ 11:11:11 Web socket connected needing compilation of: One
         (2 more events)
      ℹ️ 11:11:11 Web socket connected for: One⧘
      ✅ ⧙11:11:11⧘ Compilation finished in (timings)

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:11111)⧘

      ⧙ℹ️ 11:11:11 Web socket disconnected for: Two⧘
      ✅ ⧙11:11:11⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:11111)⧘

      ⧙ℹ️ 11:11:11 Web socket connected for: Two⧘
      ✅ ⧙11:11:11⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:11111)⧘

      ⧙ℹ️ 11:11:11 Web socket disconnected for: Two⧘
      ✅ ⧙11:11:11⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:11111)⧘

      ⧙ℹ️ 11:11:11 Terminated 1 superfluous worker⧘
      ✅ ⧙11:11:11⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:11111)⧘

      ⧙ℹ️ 11:11:11 Web socket disconnected for: One⧘
      ✅ ⧙11:11:11⧘ Everything up to date.
    `);
  });

  test("persisted compilation mode", async () => {
    const { terminal, renders } = await run({
      fixture: "persisted-compilation-mode",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: ({ body }) => {
        assertDebugger(body);
        return "Stop";
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:9988)⧘

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
      ▼ 🌳 🔌 00:00:00 Main
      ================================================================================
      ▼ 🌳 🔌 00:00:00 Main
      ================================================================================
      ▼ 🌳 ⏳ 00:00:00 Main
      ================================================================================
      ▼ 🌳 ✅ 00:00:00 Main
    `);
  });

  test("persisted debug mode for Html", async () => {
    // You can set "compilationMode": "debug" for Html and Worker programs in
    // elm-watch-stuff.json. The only thing that happens is that the disabled
    // "debug" radio button is checked.
    const { terminal, renders } = await run({
      fixture: "persisted-debug-mode-for-html",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: ({ body }) => {
        // No debugger.
        expect(body.outerHTML).toMatchInlineSnapshot(
          `<body><div>Html</div></body>`
        );
        expandUi();
        return "Stop";
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:9988)⧘

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
      ▼ 🌳 🔌 00:00:00 Main
      ================================================================================
      ▼ 🌳 🔌 00:00:00 Main
      ================================================================================
      ▼ 🌳 ⏳ 00:00:00 Main
      ================================================================================
      ▼ 🌳 ✅ 00:00:00 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 1970-01-01 00:00:00
      status Successfully compiled
      Compilation mode
      ◉ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
      ◯ Standard
      ◯ Optimize
      ▲ 🌳 ✅ 00:00:00 Main
    `);
  });

  test("late init", async () => {
    const { terminal, renders } = await run({
      fixture: "late-init",
      args: [],
      scripts: ["Main.js"],
      keepElmStuffJson: true,
      init: () => {
        expandUi();
      },
      onIdle: ({ div }) => {
        window.Elm?.Main?.init({ node: div });
        return "Stop";
      },
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
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 00:00:00 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Waiting for compilation
      It looks like no Elm apps were initialized by elm-watch. Check the console in the browser developer tools to see potential errors!
      ▲ ⏳ 00:00:00 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Successfully compiled
      It looks like no Elm apps were initialized by elm-watch. Check the console in the browser developer tools to see potential errors!
      ▲ ❓ 00:00:00 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 1970-01-01 00:00:00
      status Successfully compiled
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
      ◉ Standard
      ◯ Optimize
      ▲ ✅ 00:00:00 Main
    `);
  });

  test("typecheck only", async () => {
    const fixture = "typecheck-only";
    const main4Path = path.join(FIXTURES_DIR, fixture, "src", "Main4.elm");
    const sharedPath = path.join(FIXTURES_DIR, fixture, "src", "Shared.elm");

    const { terminal, renders } = await run({
      fixture,
      args: [],
      scripts: ["Main3.js", "Main4.js"],
      isTTY: false,
      init: (node) => {
        const node1 = document.createElement("div");
        const node2 = document.createElement("div");
        node.append(node1, node2);
        window.Elm?.Main3?.init({ node: node1 });
        window.Elm?.Main4?.init({ node: node2 });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            return "KeepGoing";
          case 2:
            touch(sharedPath);
            return "KeepGoing";
          case 3:
            return "KeepGoing";
          case 4:
            touch(main4Path);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ⏳ Main3: elm make (typecheck only)
      ⏳ Main4: elm make (typecheck only)
      ✅ Main1⧙     0 ms Q |   0 ms T ¦   0 ms W⧘
      ✅ Main2⧙     0 ms Q |   0 ms T ¦   0 ms W⧘
      ✅ Main3⧙     0 ms Q |   0 ms T ¦   0 ms W⧘
      ✅ Main4⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Main3: elm make
      ⚪️ Main4: queued
      ✅ Main3⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘
      ⏳ Main4: elm make
      ✅ Main4⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: Main3
         (2 more events)
      ℹ️ 00:00:00 Web socket connected for: Main3⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket disconnected for: Main4⧘
      ✅ ⧙00:00:00⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Web socket connected for: Main4⧘
      ✅ ⧙00:00:00⧘ Everything up to date.
      ⏳ Main3: elm make
      ⚪️ Main4: queued
      ⚪️ Main1: queued
      ⚪️ Main2: queued
      ✅ Main3⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘
      ⏳ Main4: elm make
      ✅ Main4⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ✅ Main1⧙     0 ms Q |   0 ms T ¦   0 ms W⧘
      ✅ Main2⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/typecheck-only/src/Shared.elm⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      ⏳ Main4: elm make
      ✅ Main4⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/typecheck-only/src/Main4.elm⧘
      ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 00:00:00 Main3
      ================================================================================
      ▼ 🔌 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ 🔌 00:00:00 Main4
      ================================================================================
      ▼ ⏳ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ 🔌 00:00:00 Main4
      ================================================================================
      ▼ ⏳ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ 🔌 00:00:00 Main4
      ================================================================================
      ▼ ⏳ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ⏳ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ⏳ 00:00:00 Main4
      --------------------------------------------------------------------------------
      ▼ 🔌 00:00:00 Main3
      ================================================================================
      ▼ ⏳ 00:00:00 Main4
      --------------------------------------------------------------------------------
      ▼ 🔌 00:00:00 Main3
      ================================================================================
      ▼ ⏳ 00:00:00 Main4
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main3
      ================================================================================
      ▼ ⏳ 00:00:00 Main4
      --------------------------------------------------------------------------------
      ▼ ✅ 00:00:00 Main3
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ 🔌 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ 🔌 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ 🔌 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ✅ 00:00:00 Main4
      ================================================================================
      ▼ ⏳ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ✅ 00:00:00 Main4
      ================================================================================
      ▼ ⏳ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ⏳ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ✅ 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ⏳ 00:00:00 Main4
      ================================================================================
      ▼ ✅ 00:00:00 Main3
      --------------------------------------------------------------------------------
      ▼ ✅ 00:00:00 Main4
    `);
  });

  // Note: These tests excessively uses snapshots, since they don’t stop execution on failure.
  // That results in a much better debugging experience (fewer timeouts).
  describe("hot reloading", () => {
    function runHotReload({ name }: { name: `${UppercaseLetter}${string}` }): {
      write: (n: number) => void;
      writeSimpleChange: () => void;
      removeInput: () => void;
      sendToElm: (value: number) => void;
      terminate: () => void;
      lastValueFromElm: { value: unknown };
      go: (onIdle: OnIdle) => ReturnType<typeof run>;
    } {
      const fixture = "hot-reload";
      const src = path.join(FIXTURES_DIR, fixture, "src");
      let lastContent = "";

      const write = (n: number): void => {
        const content = fs.readFileSync(
          path.join(src, `${name}${n}.elm`),
          "utf8"
        );
        lastContent = content.replace(`module ${name}${n}`, `module ${name}`);
        fs.writeFileSync(path.join(src, `${name}.elm`), lastContent);
      };

      const writeSimpleChange = (): void => {
        lastContent = lastContent.replace(/hot reload/g, `simple text change`);
        fs.writeFileSync(path.join(src, `${name}.elm`), lastContent);
      };

      const removeInput = (): void => {
        fs.unlinkSync(path.join(src, `${name}.elm`));
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
        removeInput,
        sendToElm,
        terminate,
        lastValueFromElm,
        go: (onIdle: OnIdle) =>
          run({
            fixture,
            args: [name],
            scripts: [`${name}.js`],
            isTTY: false,
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

      await go(({ idle, div }) => {
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

      await go(async ({ idle, body, div }) => {
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

      await go(async ({ idle, body, div }) => {
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

    test("Document", async () => {
      const {
        write,
        writeSimpleChange,
        sendToElm,
        terminate,
        lastValueFromElm,
        go,
      } = runHotReload({ name: "Document" });

      let probe: HTMLElement | null = null;

      write(1);

      await go(async ({ idle, body }) => {
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

      async function assertInit(body: HTMLBodyElement): Promise<void> {
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 0
          newButtonClicked: 0
          originalFromJs: []
          newFromJs: []
          </pre></div></body>
        `);

        probe = body.querySelector(".probe");
        expect(probe?.outerHTML).toMatchInlineSnapshot(
          `<h1 class="probe">Before hot reload</h1>`
        );

        click(body, "button");
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 1
          newButtonClicked: 0
          originalFromJs: []
          newFromJs: []
          </pre></div></body>
        `);

        sendToElm(2);
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 1
          newButtonClicked: 0
          originalFromJs: [2]
          newFromJs: []
          </pre></div></body>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`4`);
      }

      async function assertHotReload(body: HTMLBodyElement): Promise<void> {
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 1
          newButtonClicked: 0
          originalFromJs: [2]
          newFromJs: []
          </pre></div></body>
        `);

        expect(body.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `true`
        );

        click(body, "button");
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 1
          newButtonClicked: 1
          originalFromJs: [2]
          newFromJs: []
          </pre></div></body>
        `);

        sendToElm(3);
        await waitOneFrame();
        expect(htmlWithoutDebugger(body)).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 1
          newButtonClicked: 1
          originalFromJs: [2]
          newFromJs: [3]
          </pre></div></body>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`12`);
      }

      async function assertReloadForOptimize(
        body: HTMLBodyElement
      ): Promise<void> {
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 0
          originalButtonClicked: 0
          newButtonClicked: 0
          originalFromJs: []
          newFromJs: []
          </pre></div></body>
        `);

        expect(body.querySelector(".probe") === probe).toMatchInlineSnapshot(
          `false`
        );

        click(body, "button");
        await waitOneFrame();
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 0
          newButtonClicked: 1
          originalFromJs: []
          newFromJs: []
          </pre></div></body>
        `);

        sendToElm(3);
        await waitOneFrame();
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After hot reload</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 0
          newButtonClicked: 1
          originalFromJs: []
          newFromJs: [3]
          </pre></div></body>
        `);
        expect(lastValueFromElm.value).toMatchInlineSnapshot(`12`);
      }

      function assertHotReloadForOptimize(body: HTMLBodyElement): void {
        expect(body.outerHTML).toMatchInlineSnapshot(`
          <body><div><h1 class="probe">After simple text change</h1><button>Button</button><pre>
          browserOnClick: 1
          originalButtonClicked: 0
          newButtonClicked: 1
          originalFromJs: []
          newFromJs: [3]
          </pre></div></body>
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

      await go(async ({ idle, body }) => {
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

    test("Worker", async () => {
      const { write, writeSimpleChange, sendToElm, lastValueFromElm, go } =
        runHotReload({ name: "Worker" });

      write(1);

      await go(async ({ idle }) => {
        switch (idle) {
          case 1:
            assertDebugDisabled();
            await assertInit();
            write(2);
            return "KeepGoing";
          case 2:
            await assertHotReload();
            write(1);
            return "KeepGoing";
          case 3:
            switchCompilationMode("optimize");
            return "KeepGoing";
          case 4:
            assertCompilationMode("optimize");
            await assertInit();
            write(2);
            return "KeepGoing";
          case 5:
            await assertReloadForOptimize();
            writeSimpleChange();
            return "KeepGoing";
          default:
            await assertHotReloadForOptimize();
            return "Stop";
        }
      });

      async function assertInit(): Promise<void> {
        sendToElm(1);
        await waitOneFrame();
        expect(lastValueFromElm.value).toMatchInlineSnapshot(
          `Before hot reload: [1]`
        );
      }

      async function assertHotReload(): Promise<void> {
        sendToElm(2);
        await waitOneFrame();
        expect(lastValueFromElm.value).toMatchInlineSnapshot(
          `Before: [1]. After hot reload: [2]`
        );
      }

      async function assertReloadForOptimize(): Promise<void> {
        sendToElm(3);
        await waitOneFrame();
        expect(lastValueFromElm.value).toMatchInlineSnapshot(
          `Before: []. After hot reload: [3]`
        );
      }

      async function assertHotReloadForOptimize(): Promise<void> {
        sendToElm(4);
        await waitOneFrame();
        expect(lastValueFromElm.value).toMatchInlineSnapshot(
          `Before: []. After simple text change: [3, 4]`
        );
      }
    });

    test("remove input file", async () => {
      const { write, writeSimpleChange, removeInput, go } = runHotReload({
        name: "RemoveInput",
      });

      write(1);

      const { terminal } = await go(async ({ idle, div }) => {
        switch (idle) {
          case 1:
            await assert1(div);
            removeInput();
            return "KeepGoing";
          case 2:
            writeSimpleChange();
            return "KeepGoing" as const;
          default:
            assert2(div);
            return "Stop";
        }
      });

      expect(terminal).toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ RemoveInput: elm make (typecheck only)
        ✅ RemoveInput⧙     0 ms Q |   0 ms T ¦   0 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
        ⏳ RemoveInput: elm make
        ✅ RemoveInput⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: RemoveInput⧘
        ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket disconnected for: RemoveInput⧘
        ✅ ⧙00:00:00⧘ Everything up to date.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Web socket connected for: RemoveInput⧘
        ✅ ⧙00:00:00⧘ Everything up to date.
        🚨 RemoveInput

        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙Target: RemoveInput⧘

        You asked me to compile these inputs:

        src/RemoveInput.elm ⧙(/Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Removed /Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm⧘
        🚨 ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ RemoveInput: elm make
        ✅ RemoveInput⧙     0 ms Q |   0 ms E ¦   0 ms W |   0 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 00:00:00 Changed /Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm⧘
        ✅ ⧙00:00:00⧘ Compilation finished in ⧙0⧘ ms.
      `);

      async function assert1(div: HTMLDivElement): Promise<void> {
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div><div><h1>hot reload</h1><button>Button</button><pre>0</pre></div></div>`
        );

        click(div, "button");
        await waitOneFrame();
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div><div><h1>hot reload</h1><button>Button</button><pre>1</pre></div></div>`
        );
      }

      function assert2(div: HTMLDivElement): void {
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div><div><h1>simple text change</h1><button>Button</button><pre>1</pre></div></div>`
        );
      }
    });
  });
});
