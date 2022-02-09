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
import { ElmWatchStuffJsonWritable } from "../src/ElmWatchStuffJson";
import { __ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS, Env, NO_COLOR } from "../src/Env";
import { makeLogger } from "../src/Logger";
import { CompilationMode } from "../src/Types";
import {
  badElmBinEnv,
  clean,
  CursorWriteStream,
  FailReadStream,
  logDebug,
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
  main: HTMLElement;
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
  keepElmStuffJson = false,
  clearElmStuff = false,
  cwd = ".",
  includeProxyReloads = false,
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
  keepElmStuffJson?: boolean;
  clearElmStuff?: boolean;
  cwd?: string;
  includeProxyReloads?: boolean;
}): Promise<{
  terminal: string;
  browserConsole: string;
  renders: string;
  div: HTMLDivElement;
}> {
  const dir = path.join(FIXTURES_DIR, fixture);
  const build = path.join(dir, "build");
  const absoluteScripts = scripts.map((script) => path.join(build, script));
  const elmStuff = path.join(dir, "elm-stuff");
  const elmWatchStuff = path.join(elmStuff, "elm-watch-stuff.json");

  if (fs.rmSync !== undefined) {
    fs.rmSync(build, { recursive: true, force: true });
  } else if (fs.existsSync(build)) {
    fs.rmdirSync(build, { recursive: true });
  }
  fs.mkdirSync(build, { recursive: true });

  if (!keepElmStuffJson) {
    rm(elmWatchStuff);
  }

  if (clearElmStuff) {
    if (fs.rmSync !== undefined) {
      fs.rmSync(elmStuff, { recursive: true, force: true });
    } else if (fs.existsSync(elmStuff)) {
      fs.rmdirSync(elmStuff, { recursive: true });
    }
  }

  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const bodyIndex = bodyCounter + 2; // head + original body
  const body = document.createElement("body");
  const outerDiv = document.createElement("div");
  body.append(outerDiv);
  document.documentElement.append(body);
  bodyCounter++;

  const browserConsole: Array<string> = [];
  const renders: Array<string> = [];
  let loads = 0;

  await new Promise((resolve, reject) => {
    const loadBuiltFiles = (isReload: boolean): void => {
      loads++;

      for (const key of [
        "Elm",
        "__ELM_WATCH_RELOAD_STATUSES",
        "__ELM_WATCH_ON_INIT",
        "__ELM_WATCH_EXIT",
        "__ELM_WATCH_KILL_MATCHING",
      ]) {
        delete (window as unknown as Record<string, unknown>)[key];
      }

      Promise.all(
        absoluteScripts.map((script) => {
          // Copying the script does a couple of things:
          // - Avoiding require/import cache.
          // - Makes it easier to debug the tests since one can see all the outputs through time.
          // - Lets us make a few replacements for Jest.
          const newScript = script.replace(
            /\.(\w+)$/,
            `.${bodyIndex}.${loads}.$1`
          );
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
      )
        .then(() => {
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
        })
        .catch(reject);
    };

    for (const key of Object.keys(window)) {
      if (key.startsWith("__ELM_WATCH")) {
        delete (window as unknown as Record<string, unknown>)[key];
      }
    }

    window.__ELM_WATCHED_MOCKED_TIMINGS = true;

    window.__ELM_WATCH_RELOAD_PAGE = (message) => {
      if (message !== undefined) {
        browserConsole.push(message);
      } else if (includeProxyReloads) {
        browserConsole.push("Proxy file reload!");
      }
      window
        .__ELM_WATCH_KILL_MATCHING(/^/)
        .then(() => {
          loadBuiltFiles(true);
        })
        .catch(reject);
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

    const fullEnv: Env =
      bin === undefined
        ? {
            ...process.env,
            ...TEST_ENV,
            ...env,
          }
        : {
            ...badElmBinEnv(path.join(dir, "bad-bin", bin)),
            ...env,
          };

    const logger = makeLogger({
      env: fullEnv,
      stdout: process.stdout,
      stderr: process.stderr,
      logDebug: (message) => {
        logDebug(`Browser: ${message}`);
      },
    });

    window.__ELM_WATCH_LOG_DEBUG = logger.debug;

    let idle = 0;
    window.__ELM_WATCH_ON_REACHED_IDLE_STATE = (reason) => {
      idle++;
      // So that another idle state can’t change the previous’ number while it’s waiting.
      const localIdle = idle;
      const actualMain = body.querySelector("main");
      const fallbackMain = document.createElement("main");
      fallbackMain.textContent = "No `main` element found.";
      const main = actualMain ?? fallbackMain;
      // Wait for logs to settle. This file is pretty slow to run through
      // anyway, so this wait is just a drop in the ocean.
      wait(100)
        .then(() =>
          onIdle({ idle: localIdle, div: outerDiv, main, body, reason })
        )
        .then((result) => {
          switch (result) {
            case "KeepGoing":
              return;
            case "Stop":
              window.__ELM_WATCH_EXIT();
              return;
          }
        })
        .catch(reject);
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
      env: fullEnv,
      stdin: new FailReadStream(),
      stdout,
      stderr,
      logDebug,
    })
      .then(resolve)
      .catch(reject);
  });

  const stdoutString = clean(stdout.getOutput());

  expect(stderr.content).toBe("");

  return {
    terminal: stdoutString,
    browserConsole: browserConsole.join("\n\n"),
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
    window.history.replaceState(null, "", "/");
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
      ✅ Html⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Html
      ℹ️ 13:10:05 Web socket connected for: Html⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ 🔌 13:10:05 Html
      ================================================================================
      ▼ 🔌 13:10:05 Html
      ================================================================================
      ▼ ⏳ 13:10:05 Html
      ================================================================================
      ▼ ✅ 13:10:05 Html
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
      ✅ Worker⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Worker: elm make
      ✅ Worker⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Worker⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Worker
      ℹ️ 13:10:05 Web socket connected for: Worker⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug
      ◯ (disabled) Standard
      ◯ (disabled) Optimize
      ▲ ⏳ 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ▲ ⏳ 13:10:05 Worker
      ================================================================================
      ▼ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Platform.worker\` programs.
      ◉ (disabled) Standard
      ◯ (disabled) Optimize
      ▲ ⏳ 13:10:05 Worker
      ================================================================================
      target Worker
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Platform.worker\` programs.
      ◉ Standard
      ◯ Optimize
      ▲ ✅ 13:10:05 Worker
    `);
  });

  test("successful connect (non-fancy)", async () => {
    const { terminal, div } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      env: {
        [NO_COLOR]: "",
      },
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      Html: success                            1 ms Q | 1.23 s E /  55 ms W |   9 ms I

      web socket connections: 1 (ws://0.0.0.0:59123)

      13:10:05 Web socket disconnected for: Html
      13:10:05 Web socket connected for: Html
      13:10:05 Everything up to date.
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
  });

  test("successful connect (non-fancy, not TTY)", async () => {
    const { terminal, div } = await run({
      fixture: "basic",
      args: ["Html"],
      scripts: ["Html.js"],
      isTTY: false,
      env: {
        [NO_COLOR]: "",
      },
      init: (node) => {
        window.Elm?.HtmlMain?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      Dependencies: in progress
      Dependencies: success
      Html: elm make (typecheck only)
      Html: success     1 ms Q | 765 ms T /  50 ms W

      web socket connections: 0 (ws://0.0.0.0:59123)

      13:10:05 Compilation finished in 123 ms.
      Html: elm make
      Html: success     1 ms Q | 1.23 s E /  55 ms W |   9 ms I

      web socket connections: 1 (ws://0.0.0.0:59123)

      13:10:05 Web socket connected needing compilation of: Html
      13:10:05 Compilation finished in 123 ms.

      web socket connections: 1 (ws://0.0.0.0:59123)

      13:10:05 Web socket disconnected for: Html
      13:10:05 Web socket connected for: Html
      13:10:05 Everything up to date.
    `);

    expect(div.outerHTML).toMatchInlineSnapshot(`<div>Hello, World!</div>`);
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
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
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

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Readonly⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Readonly
      ================================================================================
      ▼ ⏳ 13:10:05 Readonly
      ================================================================================
      ▼ ⏳ 13:10:05 Readonly
      ================================================================================
      ▼ 🚨 13:10:05 Readonly
      ================================================================================
      target Readonly
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Compilation error
      Check the terminal to see errors!
      ▲ 🚨 13:10:05 Readonly
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

      /Users/you/project/tests/fixtures/hot/basic/build/elm-watch-InjectSearchAndReplaceNotFound-1cef2ae8d6462de725789672822191e1c18ea8413009cbb627ff3b754a82a1df.txt

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: InjectError⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 InjectError
      ================================================================================
      ▼ ⏳ 13:10:05 InjectError
      ================================================================================
      ▼ ⏳ 13:10:05 InjectError
      ================================================================================
      ▼ 🚨 13:10:05 InjectError
      ================================================================================
      target InjectError
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Compilation error
      Check the terminal to see errors!
      ▲ 🚨 13:10:05 InjectError
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
      $&"Platform.worker", debugMetadata,

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
        ✅ BadUrl⧙                                           1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(
        renders.replace(
          /elmCompiledTimestamp=\d+/,
          "elmCompiledTimestamp=1644064438938"
        )
      ).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 BadUrl
        ================================================================================
        ▼ ⏳ 13:10:05 BadUrl
        ================================================================================
        target BadUrl
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I expected the web socket connection URL to start with:

        /?

        But it looks like this:

        /nope?elmWatchVersion=%25VERSION%25&targetName=BadUrl&elmCompiledTimestamp=1644064438938

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here.
        ▲ ❌ 13:10:05 BadUrl
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
        ✅ ParamsDecodeError⧙                                1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 ParamsDecodeError
        ================================================================================
        ▼ ⏳ 13:10:05 ParamsDecodeError
        ================================================================================
        target ParamsDecodeError
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        I ran into trouble parsing the web socket connection URL parameters:

        At root["elmCompiledTimestamp"]:
        Expected a number
        Got: "2021-12-11"

        The URL looks like this:

        /?elmWatchVersion=%25VERSION%25&targetName=ParamsDecodeError&elmCompiledTimestamp=2021-12-11

        The web socket code I generate is supposed to always connect using a correct URL, so something is up here. Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 13:10:05 ParamsDecodeError
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
        ✅ WrongVersion⧙                                     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 WrongVersion
        ================================================================================
        ▼ ⏳ 13:10:05 WrongVersion
        ================================================================================
        target WrongVersion
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it was compiled with:

        elm-watch 0.0.0

        But the server is:

        elm-watch %VERSION%

        Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
        ▲ ❌ 13:10:05 WrongVersion
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
        ✅ TargetNotFound⧙                                   1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 TargetNotFound
        ================================================================================
        ▼ ⏳ 13:10:05 TargetNotFound
        ================================================================================
        target TargetNotFound
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
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
        Reconnect

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        ▲ ❌ 13:10:05 TargetNotFound
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
        ✅ Main⧙                                             1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Main
        ================================================================================
        ▼ ⏳ 13:10:05 Main
        ================================================================================
        target Main
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser says it is for this target:

        nope

        But I can't find that target in elm-watch.json!

        These targets are available in elm-watch.json:

        Main

        Maybe this target used to exist in elm-watch.json, but you removed or changed it?
        ▲ ❌ 13:10:05 Main
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
        ✅ TargetDisabled⧙                                   1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected with errors (see the browser for details)⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 TargetDisabled
        ================================================================================
        ▼ ⏳ 13:10:05 TargetDisabled
        ================================================================================
        target TargetDisabled
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
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
        Reconnect

        If you want to have this target compiled, restart elm-watch either with more CLI arguments or no CLI arguments at all!
        ▲ ❌ 13:10:05 TargetDisabled
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
        ✅ SendBadJson⧙                           1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: SendBadJson
        ℹ️ 13:10:05 Web socket connected for: SendBadJson⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 SendBadJson
        ================================================================================
        ▼ ⏳ 13:10:05 SendBadJson
        ================================================================================
        ▼ ⏳ 13:10:05 SendBadJson
        ================================================================================
        ▼ 🔌 13:10:05 SendBadJson
        ================================================================================
        ▼ 🔌 13:10:05 SendBadJson
        ================================================================================
        ▼ ⏳ 13:10:05 SendBadJson
        ================================================================================
        ▼ ✅ 13:10:05 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ▲ ✅ 13:10:05 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize
        ▲ ⏳ 13:10:05 SendBadJson
        ================================================================================
        target SendBadJson
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Unexpected error
        I ran into an unexpected error! This is the error message:
        The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

        At root["tag"]:
        Expected one of these tags: "ChangedCompilationMode", "FocusedTab", "ExitRequested"
        Got: "Nope"

        The web socket code I generate is supposed to always send correct messages, so something is up here.
        ▲ ❌ 13:10:05 SendBadJson
      `);
    });

    test("reconnect a few times", async () => {
      let i = 0;
      modifyUrl((url) => {
        i++;
        if (i <= 2) {
          url.port = "65252"; // Hopefully unused port.
        }
      });

      const { terminal, renders } = await run({
        fixture: "basic",
        args: ["Reconnect"],
        scripts: ["Reconnect.js"],
        expandUiImmediately: true,
        init: (node) => {
          window.Elm?.HtmlMain?.init({ node });
        },
        onIdle: () => "Stop",
      });

      expect(terminal).toMatchInlineSnapshot(`
        ✅ Reconnect⧙                             1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: Reconnect
        ℹ️ 13:10:05 Web socket connected for: Reconnect⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Sleeping
        attempt 2
        sleep 1.04 seconds
        [Reconnect web socket now]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 2
        sleep 1.04 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Sleeping
        attempt 3
        sleep 1.09 seconds
        [Reconnect web socket now]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 3
        sleep 1.09 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug
        ◉ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 Reconnect
        ================================================================================
        ▼ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 Reconnect
        ================================================================================
        target Reconnect
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ▲ ✅ 13:10:05 Reconnect
      `);
    });
  });

  test("changes to elm-watch.json", async () => {
    const fixture = "changes-to-elm-watch-json";
    const dir = path.join(FIXTURES_DIR, fixture);
    const elmWatchJsonPath = path.join(dir, "elm-watch.json");
    const elmWatchJsonPath2 = path.join(dir, "src", "elm-watch.json");
    const elmWatchJsonTemplatePath = path.join(dir, "elm-watch.template.json");
    const roguePath = path.join(dir, "rogue", "elm-watch.json");
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
            touch(roguePath);
            fs.writeFileSync(
              elmWatchJsonPath,
              elmWatchJsonString.slice(0, -10)
            );
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

    window.__ELM_WATCH_EXIT();

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⧙-- TROUBLE READING elm-watch.json ----------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble reading it as JSON:⧘

      Unexpected end of JSON input

      🚨 ⧙1⧘ error found
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make (typecheck only)
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/elm-watch.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
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
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-watch-json/src/elm-watch.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
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
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
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
    const dir = path.join(FIXTURES_DIR, fixture);
    const elmJsonPath = path.join(dir, "elm.json");
    const elmJsonPathSub = path.join(dir, "src", "Sub", "elm.json");
    const elmJsonTemplatePath = path.join(dir, "elm.template.json");
    const roguePath = path.join(dir, "rogue", "elm.json");
    const inputPath = path.join(dir, "src", "HtmlMain.elm");
    const otherInputPath = path.join(dir, "src", "Sub", "OtherMain.elm");
    const elmJsonString = fs.readFileSync(elmJsonTemplatePath, "utf8");
    fs.writeFileSync(elmJsonPath, elmJsonString);
    fs.writeFileSync(roguePath, "ROGUE");
    rm(elmJsonPathSub);

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
            fs.writeFileSync(elmJsonPathSub, elmJsonString);
            return "KeepGoing";
          case 4:
            touch(otherInputPath);
            return "KeepGoing";
          case 5:
            fs.unlinkSync(elmJsonPath);
            return "KeepGoing";
          case 6:
            touch(inputPath);
            return "KeepGoing";
          case 7:
            touch(otherInputPath);
            return "KeepGoing";
          case 8:
            fs.unlinkSync(elmJsonPathSub);
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
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
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

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      🚨 HtmlMain

      ⧙-- NO UNIQUE elm.json ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I went looking for an ⧙elm.json⧘ for your inputs, but I found more than one!

      src/HtmlMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      It doesn't make sense to compile Elm files from different projects into one output.

      Either split this target, or move the inputs to the same project with the same
      ⧙elm.json⧘.

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      🚨 HtmlMain

      ⧙-- NO UNIQUE elm.json ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I went looking for an ⧙elm.json⧘ for your inputs, but I found more than one!

      src/HtmlMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      It doesn't make sense to compile Elm files from different projects into one output.

      Either split this target, or move the inputs to the same project with the same
      ⧙elm.json⧘.

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/OtherMain.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/HtmlMain.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      Note that I did find an ⧙elm.json⧘ for some inputs:

      src/Sub/OtherMain.elm
      -> /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json

      Make sure that one single ⧙elm.json⧘ covers all the inputs together!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/OtherMain.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      🚨 HtmlMain

      ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
      ⧙Target: HtmlMain⧘

      I could not find an ⧙elm.json⧘ for these inputs:

      src/HtmlMain.elm
      src/Sub/OtherMain.elm

      Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-json/src/Sub/elm.json⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);

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
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
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
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      🚨 HtmlMain

      ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js

      I tried to import your postprocess file:

      const imported = await import("/Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js")

      But that resulted in this error:

      /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js:2
        code.replace("The text!", (match) => match.toUppe
                                                   ^^^^^^

      SyntaxError: missing ) after argument list

      🚨 ⧙1⧘ error found

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
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

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      🟢 HtmlMain: elm make done
      ⏳ HtmlMain: postprocess
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/changes-to-postprocess/postprocess.js⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);

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
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
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
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
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

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
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

      ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/changes-to-elm-files/src/Html.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);

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
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ 🚨 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain
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
      ✅ HtmlMain1⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain1: elm make
      ✅ HtmlMain1⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain1⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain1
      ℹ️ 13:10:05 Web socket connected for: HtmlMain1⧘
      ✅ ⧙13:10:05⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File1.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-disabled-targets/src/Unused/File2.elm⧘
      ✅ ⧙13:10:05⧘ FYI: The above Elm files are not imported by any of the enabled targets. Nothing to do!
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 HtmlMain1
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain1
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain1
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain1
      ================================================================================
      ▼ 🔌 13:10:05 HtmlMain1
      ================================================================================
      ▼ ⏳ 13:10:05 HtmlMain1
      ================================================================================
      ▼ ✅ 13:10:05 HtmlMain1
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
      ✅ HtmlMain⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ HtmlMain: elm make
      ✅ HtmlMain⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: HtmlMain
      ℹ️ 13:10:05 Web socket connected for: HtmlMain⧘
      ✅ ⧙13:10:05⧘ Everything up to date.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/non-interesting-elm-files-changed-all-targets/src/Unused.elm⧘
      ✅ ⧙13:10:05⧘ FYI: The above Elm file is not imported by any target. Nothing to do!
    `);

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
      ✅ Target1⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Target2⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Target3⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Target1: elm make
      ✅ Target1⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Target1⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Target1
      ℹ️ 13:10:05 Web socket connected for: Target1⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Target1
      ================================================================================
      ▼ ⏳ 13:10:05 Target1
      ================================================================================
      ▼ ⏳ 13:10:05 Target1
      ================================================================================
      ▼ 🔌 13:10:05 Target1
      ================================================================================
      ▼ 🔌 13:10:05 Target1
      ================================================================================
      ▼ ⏳ 13:10:05 Target1
      ================================================================================
      ▼ ✅ 13:10:05 Target1
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
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ⏳ Main: interrupted
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess/src/Main.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess/src/Main.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
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
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ⏳ Main: interrupted
      ⏳ Main: elm make
      🟢 Main: elm make done
      ⏳ Main: postprocess
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess-elm-watch-node/src/Main.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/kill-postprocess-elm-watch-node/src/Main.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
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
    const { terminal } = await run({
      fixture: "limit-postprocess-workers",
      args: [],
      scripts: ["One.js", "Two.js"],
      isTTY: false,
      env: {
        [__ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS]: "150",
      },
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
            await window.__ELM_WATCH_KILL_MATCHING(/^Two$/);
            await wait(200); // Wait for the worker to be killed.
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ One: elm make (typecheck only)
      ⏳ Two: elm make (typecheck only)
      ✅ One⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Two⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Two: elm make
      ⚪️ One: queued
      🟢 Two: elm make done
      ⏳ Two: postprocess
      ⏳ One: elm make
      🟢 One: elm make done
      ⏳ One: postprocess
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: One
      ℹ️ 13:10:05 Web socket connected needing compilation of: Two⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Two
         (2 more events)
      ℹ️ 13:10:05 Web socket connected for: Two⧘
      ✅ ⧙13:10:05⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Two⧘
      ✅ ⧙13:10:05⧘ Everything up to date.

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Terminated 1 superfluous worker⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
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
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:9988)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🌳 🔌 13:10:05 Main
      ================================================================================
      ▼ 🌳 🔌 13:10:05 Main
      ================================================================================
      ▼ 🌳 ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🌳 ✅ 13:10:05 Main
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
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:9988)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🌳 🔌 13:10:05 Main
      ================================================================================
      ▼ 🌳 🔌 13:10:05 Main
      ================================================================================
      ▼ 🌳 ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🌳 ✅ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:9988
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◉ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
      ◯ Standard
      ◯ Optimize
      ▲ 🌳 ✅ 13:10:05 Main
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
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Connecting
      attempt 1
      sleep 1.01 seconds
      [Connecting web socket…]
      ▲ 🔌 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Waiting for compilation
      It looks like no Elm apps were initialized by elm-watch. Check the console in the browser developer tools to see potential errors!
      ▲ ⏳ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Successfully compiled
      It looks like no Elm apps were initialized by elm-watch. Check the console in the browser developer tools to see potential errors!
      ▲ ❓ 13:10:05 Main
      ================================================================================
      target Main
      elm-watch %VERSION%
      web socket ws://localhost:59123
      updated 2022-02-05 13:10:05
      status Successfully compiled
      Compilation mode
      ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
      ◉ Standard
      ◯ Optimize
      ▲ ✅ 13:10:05 Main
    `);
  });

  test("typecheck only", async () => {
    const fixture = "typecheck-only";
    const main4Path = path.join(FIXTURES_DIR, fixture, "src", "Main4.elm");
    const sharedPath = path.join(FIXTURES_DIR, fixture, "src", "Shared.elm");

    const { terminal } = await run({
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
      ✅ Main1⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Main2⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Main3⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Main4⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 1
      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Main4: elm make
      ⚪️ Main3: queued
      🟢 Main4: elm make done
      ⏳ Main4: postprocess
      ⏳ Main3: elm make
      🟢 Main3: elm make done
      ⏳ Main3: postprocess
      ✅ Main4⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘
      ✅ Main3⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main3
      ℹ️ 13:10:05 Web socket connected needing compilation of: Main4⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main4
         (2 more events)
      ℹ️ 13:10:05 Web socket connected for: Main4⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Main4: elm make
      ⚪️ Main3: queued
      ⚪️ Main1: queued
      ⚪️ Main2: queued
      🟢 Main4: elm make done
      ⏳ Main4: postprocess
      ⏳ Main3: elm make
      ✅ Main4⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘
      🟢 Main3: elm make done
      ⏳ Main3: postprocess
      ⏳ Main1: elm make (typecheck only)
      ⏳ Main2: elm make (typecheck only)
      ✅ Main3⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘
      ✅ Main1⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Main2⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/typecheck-only/src/Shared.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Main4: elm make
      🟢 Main4: elm make done
      ⏳ Main4: postprocess
      ✅ Main4⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I |   0 ms R | 31.2 s P⧘

      📊 ⧙elm-watch-node workers:⧘ 2
      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/typecheck-only/src/Main4.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);
  });

  test("prioritize last focused target", async () => {
    const fixture = "prioritization";
    const sharedFile = path.join(FIXTURES_DIR, fixture, "src", "Shared.elm");
    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["One.js", "Two.js"],
      isTTY: false,
      init: (node) => {
        const node1 = document.createElement("div");
        const node2 = document.createElement("div");
        node.append(node1, node2);
        window.Elm?.One?.init({ node: node1 });
        window.Elm?.Two?.init({ node: node2 });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            // One of them loaded.
            return "KeepGoing";
          case 2:
            // `Two` should be compiled first here since it loaded last.
            touch(sharedFile);
            return "KeepGoing"; // First script has loaded.
          case 3:
            // One of them done.
            return "KeepGoing";
          case 4:
            // This should give priority to `One`.
            window.dispatchEvent(new CustomEvent("focus", { detail: "One" }));
            touch(sharedFile);
            return "KeepGoing";
          case 5:
            // One of them done.
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ One: elm make (typecheck only)
      ⏳ Two: elm make (typecheck only)
      ✅ One⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ Two⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Two: elm make
      ⚪️ One: queued
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ One: elm make
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: One
      ℹ️ 13:10:05 Web socket connected needing compilation of: Two⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Two
         (2 more events)
      ℹ️ 13:10:05 Web socket connected for: Two⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      ⏳ Two: elm make
      ⚪️ One: queued
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ One: elm make
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/prioritization/src/Shared.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ One: elm make
      ⚪️ Two: queued
      ✅ One⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ⏳ Two: elm make
      ✅ Two⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/prioritization/src/Shared.elm⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);
  });

  test("duplicate inputs", async () => {
    const fixture = "duplicate-inputs";
    const dir = path.join(FIXTURES_DIR, fixture);
    const elmJsonPath = path.join(dir, "elm.json");
    const main = path.join(dir, "src", "Main.elm");
    const main2 = path.join(dir, "src", "Main2.elm");
    const symlink = path.join(dir, "src", "Symlink.elm");

    // Can’t use the `rm` function here, since `fs.existsSync(symlink)` returns
    // `false` if `symlink` is an existing symlink but points to a non-existing file.
    try {
      fs.unlinkSync(symlink);
    } catch {
      // Does not exist.
    }
    fs.symlinkSync(main2, symlink);

    const { terminal, renders } = await run({
      fixture,
      args: ["Main"],
      scripts: ["Main.js"],
      isTTY: false,
      // The test has a tendency to hang otherwise (`onIdle` is never called).
      // Maybe `elm` doesn’t like the symlink shenanigans.
      clearElmStuff: true,
      init: (node) => {
        window.Elm?.Main?.init({ node });
      },
      onIdle: ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert(div);
            fs.unlinkSync(symlink);
            fs.symlinkSync(main, symlink);
            return "KeepGoing";
          case 2:
            touch(elmJsonPath);
            touch(main);
            return "KeepGoing";
          default:
            return "Stop";
        }
      },
    });

    fs.unlinkSync(symlink);

    expect(terminal).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: Main⧘
      ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Web socket disconnected for: Main
      ℹ️ 13:10:05 Web socket connected for: Main⧘
      ✅ ⧙13:10:05⧘ Everything up to date.
      🚨 Main

      ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
      ⧙Target: Main⧘

      Some of your inputs seem to be duplicates!

      src/Main.elm
      src/Symlink.elm ⧙(symlink)⧘
      -> /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Main.elm

      Make sure every input is listed just once!

      Note that at least one of the inputs seems to be a symlink. They can be tricky!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Symlink.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      🚨 Main

      ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
      ⧙Target: Main⧘

      Some of your inputs seem to be duplicates!

      src/Main.elm
      src/Symlink.elm ⧙(symlink)⧘
      -> /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Main.elm

      Make sure every input is listed just once!

      Note that at least one of the inputs seems to be a symlink. They can be tricky!

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

      ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Main.elm
      ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/hot/duplicate-inputs/src/Symlink.elm⧘
      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);

    expect(renders).toMatchInlineSnapshot(`
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ 🔌 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ ✅ 13:10:05 Main
      ================================================================================
      ▼ ⏳ 13:10:05 Main
      ================================================================================
      ▼ 🚨 13:10:05 Main
      ================================================================================
      ▼ 🚨 13:10:05 Main
    `);

    function assert(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Main</div>`);
    }
  });

  // Note: These tests excessively uses snapshots, since they don’t stop execution on failure.
  // That results in a much better debugging experience (fewer timeouts).
  describe("hot reloading", () => {
    function runHotReload({
      fixture = "hot-reload",
      name,
      programType,
      compilationMode,
      init,
      expandUiImmediately,
      includeProxyReloads,
      isTTY,
      extraScripts = [],
      extraElmWatchStuffJson = {},
    }: {
      fixture?: string;
      name: `${UppercaseLetter}${string}`;
      programType:
        | "Application"
        | "Document"
        | "Element"
        | "Html"
        | "Sandbox"
        | "Worker";
      compilationMode: CompilationMode;
      init?: (node: HTMLDivElement) => void;
      expandUiImmediately?: boolean;
      includeProxyReloads?: boolean;
      isTTY?: boolean;
      extraScripts?: Array<string>;
      extraElmWatchStuffJson?: ElmWatchStuffJsonWritable["targets"];
    }): {
      replace: (f: (fileContent: string) => string) => void;
      write: (n: number) => void;
      removeInput: () => void;
      sendToElm: (value: number) => void;
      lastValueFromElm: { value: unknown };
      go: (onIdle: OnIdle) => ReturnType<typeof run>;
    } {
      const dir = path.join(FIXTURES_DIR, fixture);
      const src = path.join(dir, "src");

      const elmWatchStuffJson: ElmWatchStuffJsonWritable = {
        port: 58888,
        targets:
          compilationMode === "standard"
            ? extraElmWatchStuffJson
            : {
                [name]: {
                  compilationMode,
                },
                ...extraElmWatchStuffJson,
              },
      };

      let lastContent = "";

      const write = (n: number): void => {
        const content = fs.readFileSync(
          path.join(src, `${name}${n}.elm`),
          "utf8"
        );
        lastContent = content
          .replace(`module ${name}${n}`, `module ${name}`)
          .replace(/^(main =\s*)\w+$/m, `$1main${programType}`);
        fs.writeFileSync(path.join(src, `${name}.elm`), lastContent);
      };

      const replace = (f: (fileContent: string) => string): void => {
        lastContent = f(lastContent);
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

      return {
        replace,
        write,
        removeInput,
        sendToElm,
        lastValueFromElm,
        go: (onIdle: OnIdle) => {
          fs.mkdirSync(path.join(dir, "elm-stuff"), { recursive: true });
          fs.writeFileSync(
            path.join(dir, "elm-stuff", "elm-watch-stuff.json"),
            JSON.stringify(elmWatchStuffJson)
          );
          write(1);

          return run({
            fixture,
            args: [name],
            scripts: [`${name}.js`, ...extraScripts],
            isTTY,
            keepElmStuffJson: true,
            expandUiImmediately,
            includeProxyReloads,
            init:
              init ??
              ((node) => {
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
              }),
            onIdle,
          });
        },
      };
    }

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
              content.replace("hot reload", "simple text change")
            );
            return "KeepGoing";
          case 2:
            assertHotReload(div);
            replace((content) =>
              content.replace("simple text change", "hot reload")
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
              content.replace("hot reload", "simple text change")
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
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
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
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◉ Standard
        ◯ Optimize
        ▲ ✅ 13:10:05 HtmlMain
        ================================================================================
        target HtmlMain
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize
        ▲ ⏳ 13:10:05 HtmlMain
        ================================================================================
        target HtmlMain
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ (disabled) Standard
        ◉ (disabled) Optimize
        ▲ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⚡️ 🔌 13:10:05 HtmlMain
        ================================================================================
        ▼ ⚡️ 🔌 13:10:05 HtmlMain
        ================================================================================
        ▼ ⚡️ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⚡️ ✅ 13:10:05 HtmlMain
        ================================================================================
        target HtmlMain
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
        ◯ Standard
        ◉ Optimize
        ▲ ⚡️ ✅ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⚡️ ✅ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⚡️ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⚡️ ⏳ 13:10:05 HtmlMain
        ================================================================================
        ▼ ⚡️ ✅ 13:10:05 HtmlMain
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
                    "onClick NewButtonClicked"
                  )
              );
              return "KeepGoing";
            default:
              await assertHotReload(main);
              return "Stop";
          }
        });

        async function assertInit(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 0
            newButtonClicked: 0
            </pre></main>
          `);

          probe = main.querySelector(".probe");
          expect(probe?.outerHTML).toMatchInlineSnapshot(
            `<h1 class="probe">Before hot reload</h1>`
          );

          click(main, "button");
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 0
            </pre></main>
          `);
        }

        async function assertHotReload(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 0
            </pre></main>
          `);

          expect(main.querySelector(".probe") === probe).toMatchInlineSnapshot(
            `true`
          );

          click(main, "button");
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><button>Button</button><pre>
            originalButtonClicked: 1
            newButtonClicked: 1
            </pre></main>
          `);
        }
      }
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
                    "onUrlRequest = NewUrlRequested"
                  )
                  .replace(
                    "onUrlChange = OriginalUrlChanged",
                    "onUrlChange = NewUrlChanged"
                  )
              );
              return "KeepGoing";
            default:
              await assertHotReload(main);
              return "Stop";
          }
        });

        async function assertInit(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/
            originalUrlRequested: 0
            originalUrlChanged: 0
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `);

          click(main, "a");
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/link
            originalUrlRequested: 1
            originalUrlChanged: 1
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `);

          click(main, "button");
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">Before hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `);
        }

        async function assertHotReload(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 0
            newUrlChanged: 0
            </pre></main>
          `);

          click(main, "a");
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/link
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 1
            newUrlChanged: 1
            </pre></main>
          `);

          click(main, "button");
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`
            <main><h1 class="probe">After hot reload</h1><a href="/link">Link</a><button>Button</button><pre>
            url: http://localhost/push
            originalUrlRequested: 1
            originalUrlChanged: 2
            newUrlRequested: 1
            newUrlChanged: 2
            </pre></main>
          `);
        }
      }
    );

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
    ] as const)(
      "Port change: %s / %s",
      async (programType, compilationMode) => {
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
                content.replace("fromJs OriginalFromJs", "fromJs NewFromJs")
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
      }
    );

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
                content.replace(/-- /g, "").replace("Sub.none", "")
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
          expect(browserConsole).toMatchInlineSnapshot(``);
        }

        function assertBrowserConsoleOptimize(): void {
          expect(browserConsole).toMatchInlineSnapshot(`
            elm-watch: I did a full page reload because record field mangling in optimize mode was different than last time.
            (target: AddSubscription)
          `);
        }

        async function assertInit(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>0</main>`);

          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>-1</main>`);
        }

        async function assertHotReload(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>-1</main>`);

          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>8</main>`);
        }

        async function assertReloadForOptimize(
          main: HTMLElement
        ): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>0</main>`);

          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>9</main>`);
        }
      }
    );

    test("remove input file", async () => {
      const elmJsonPath = path.join(FIXTURES_DIR, "hot-reload", "elm.json");

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
              content.replace("hot reload", "simple text change")
            );
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
        ✅ RemoveInput⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
        ⏳ RemoveInput: elm make
        ✅ RemoveInput⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket connected needing compilation of: RemoveInput⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: RemoveInput
        ℹ️ 13:10:05 Web socket connected for: RemoveInput⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
        🚨 RemoveInput

        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙Target: RemoveInput⧘

        You asked me to compile these inputs:

        src/RemoveInput.elm ⧙(/Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Removed /Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm⧘
        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ RemoveInput: elm make
        ✅ RemoveInput⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Added /Users/you/project/tests/fixtures/hot/hot-reload/src/RemoveInput.elm⧘
        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
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

    test("Flags change", async () => {
      let initCount = 0;

      const { replace, go } = runHotReload({
        name: "FlagsChange",
        programType: "Element",
        compilationMode: "standard",
        init: (node) => {
          initCount++;
          window.Elm?.FlagsChange?.init({
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
          expect(browserConsole).toMatchInlineSnapshot(``);
        }

        function assertBrowserConsoleDebug(): void {
          expect(browserConsole).toMatchInlineSnapshot(`
            elm-watch: I did a full page reload because the message type in \`Elm.AddMsg\` changed in debug mode ("debug metadata" changed).
            (target: AddMsg)
          `);
        }

        async function assert1(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>init</main>`);
          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>Msg1</main>`);
        }

        async function assert2(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>Msg1</main>`);
          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>AddedMsg</main>`);
        }

        async function assert2Debug(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>init</main>`);
          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(`<main>AddedMsg</main>`);
        }
      }
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
          `<div>field1 with newField</div>`
        );
      }
    });

    describe("Init change cmd", () => {
      // eslint-disable-next-line no-console
      const originalConsoleInfo = console.info;

      afterEach(() => {
        // eslint-disable-next-line no-console
        console.info = originalConsoleInfo;
      });

      test("Init change cmd", async () => {
        const mockConsoleInfo = jest.fn();
        // eslint-disable-next-line no-console
        console.info = mockConsoleInfo;

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
                content.replace("module", "port module").replace(/-- /g, "")
              );
              return "KeepGoing";
            default:
              assert2();
              return "Stop";
          }
        });

        expect(browserConsole).toMatchInlineSnapshot(`
          elm-watch: I did a full page reload because \`Elm.InitChangeCmd.init\` returned something different than last time. Let's start fresh!
          (target: InitChangeCmd)
        `);

        expect(mockConsoleInfo.mock.calls).toMatchInlineSnapshot(`
          Array [
            Array [
              elm-watch: A new port 'toJs' was added. You might want to reload the page!,
            ],
          ]
        `);

        function assert1(): void {
          expect(lastValueFromElm.value).toMatchInlineSnapshot(`undefined`);
        }

        function assert2(): void {
          expect(lastValueFromElm.value).toMatchInlineSnapshot(`sent on init!`);
        }
      });
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
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div>Browser.sandbox</div>`
        );
      }

      function assert2(div: HTMLDivElement): void {
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div>Browser.element</div>`
        );
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
                .replace("1337", '"Just"')
            );
            return "KeepGoing";
          default:
            await assert2(main);
            return "Stop";
        }
      });

      expect(
        browserConsole.replace(/(\n\s*at _String_toUpper).*(\n\s*at.+)*/, "$1")
      ).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because hot reload for \`Elm.ViewFailsAfterHotReload\` failed, probably because of incompatible model changes.
        This is the error:
        TypeError: str.toUpperCase is not a function
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

    describe("Html.Lazy", () => {
      // eslint-disable-next-line no-console
      const originalConsoleLog = console.log;

      afterEach(() => {
        // eslint-disable-next-line no-console
        console.log = originalConsoleLog;
      });

      test("Html.Lazy", async () => {
        const mockConsoleLog = jest.fn();
        // eslint-disable-next-line no-console
        console.log = (...args) => {
          if (
            typeof args[0] === "string" &&
            args[0].startsWith("ELM_LAZY_TEST")
          ) {
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
                content.replace("Is divisible by", "HOT RELOADED $&")
              );
              return "KeepGoing";
            default:
              await assert2(main);
              return "Stop";
          }
        });

        expect(mockConsoleLog.mock.calls).toMatchInlineSnapshot(`
          Array [
            Array [
              ELM_LAZY_TEST isDivisible: True,
            ],
            Array [
              ELM_LAZY_TEST isDivisible: False,
            ],
            Array [
              ELM_LAZY_TEST isDivisible: False,
            ],
            Array [
              ELM_LAZY_TEST isDivisible: True,
            ],
          ]
        `);

        async function assert1(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(
            `<main><p>Number: 0</p><p>Is divisible by 4? Yes.</p></main>`
          );
          expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`1`);

          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(
            `<main><p>Number: 1</p><p>Is divisible by 4? No.</p></main>`
          );
          expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`2`);

          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(
            `<main><p>Number: 2</p><p>Is divisible by 4? No.</p></main>`
          );
          expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`2`);
        }

        async function assert2(main: HTMLElement): Promise<void> {
          expect(main.outerHTML).toMatchInlineSnapshot(
            `<main><p>Number: 2</p><p>HOT RELOADED Is divisible by 4? No.</p></main>`
          );
          expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`3`);

          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(
            `<main><p>Number: 3</p><p>HOT RELOADED Is divisible by 4? No.</p></main>`
          );
          expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`3`);

          main.click();
          await waitOneFrame();
          expect(main.outerHTML).toMatchInlineSnapshot(
            `<main><p>Number: 4</p><p>HOT RELOADED Is divisible by 4? Yes.</p></main>`
          );
          expect(mockConsoleLog.mock.calls.length).toMatchInlineSnapshot(`4`);
        }
      });
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
                .replace(/-- /g, "")
            );
            return "KeepGoing";
          case 4:
            await assert4(main);
            replace((content) =>
              content
                .replace("onClick 1", "onClick (NewClicked 5)")
                .replace(/\|> Html\.map .+/g, "")
            );
            return "KeepGoing";
          default:
            await assert5(main);
            return "Stop";
        }
      });

      async function assert1(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>Count: 0</button></main>`
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>Count: 2</button></main>`
        );
      }

      async function assert2(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>HOT RELOADED Count: 2</button></main>`
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>HOT RELOADED Count: 4</button></main>`
        );
      }

      async function assert3(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>HOT RELOADED Count: 4</button></main>`
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>HOT RELOADED Count: 7</button></main>`
        );
      }

      async function assert4(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>HOT RELOADED Count: 7</button></main>`
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>HOT RELOADED Count: 4</button></main>`
        );
      }

      async function assert5(main: HTMLElement): Promise<void> {
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>HOT RELOADED Count: 4</button></main>`
        );

        click(main, "button");
        await waitOneFrame();
        expect(main.outerHTML).toMatchInlineSnapshot(
          `<main><button>HOT RELOADED Count: -1</button></main>`
        );
      }
    });

    describe("Unexpected/unhandled error at eval", () => {
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const originalPromiseReject = Promise.reject;
      afterEach(() => {
        Promise.reject = originalPromiseReject;
      });

      test("Unexpected/unhandled error at eval", async () => {
        const error = new Error("Very unexpected error");

        const mockPromiseReject = jest.fn();

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
          expandUiImmediately: true,
        });

        const { renders } = await go(({ idle, div }) => {
          switch (idle) {
            case 1:
              assertInit(div);
              Object.defineProperty(window.Elm?.HtmlMain, "__elmWatchApps", {
                get() {
                  throw error;
                },
              });
              replace((content) =>
                content.replace("hot reload", "simple text change")
              );
              return "KeepGoing";
            default:
              assertInit(div);
              return "Stop";
          }
        });

        expect(renders).toMatchInlineSnapshot(`
          ▼ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Connecting
          attempt 1
          sleep 1.01 seconds
          [Connecting web socket…]
          ▲ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          Compilation mode
          ◯ (disabled) Debug
          ◯ (disabled) Standard
          ◯ (disabled) Optimize
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          Compilation mode
          ◯ (disabled) Debug
          ◉ (disabled) Standard
          ◯ (disabled) Optimize
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          ▼ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Connecting
          attempt 1
          sleep 1.01 seconds
          [Connecting web socket…]
          ▲ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Connecting
          attempt 1
          sleep 1.01 seconds
          [Connecting web socket…]
          ▲ 🔌 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          Compilation mode
          ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
          ◉ (disabled) Standard
          ◯ (disabled) Optimize
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Successfully compiled
          Compilation mode
          ◯ (disabled) Debug The Elm debugger isn't supported by \`Html\` programs.
          ◉ Standard
          ◯ Optimize
          ▲ ✅ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          window.Elm does not look like expected! This is the error message:
          At root["Elm"]["HtmlMain"]["__elmWatchApps"]:
          Very unexpected error
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Waiting for compilation
          window.Elm does not look like expected! This is the error message:
          At root["Elm"]["HtmlMain"]["__elmWatchApps"]:
          Very unexpected error
          ▲ ⏳ 13:10:05 HtmlMain
          ================================================================================
          target HtmlMain
          elm-watch %VERSION%
          web socket ws://localhost:59123
          updated 2022-02-05 13:10:05
          status Eval error
          Check the console in the browser developer tools to see errors!
          ▲ ⛔️ 13:10:05 HtmlMain
        `);

        expect(mockPromiseReject.mock.calls).toMatchInlineSnapshot(`
          Array [
            Array [
              [Error: Very unexpected error],
            ],
          ]
        `);

        function assertInit(div: HTMLDivElement): void {
          expect(div.outerHTML).toMatchInlineSnapshot(
            `<div><h1 class="probe">hot reload</h1></div>`
          );
        }
      });
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
        ✅ OutputsWithoutActionOther1⧙                       1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: OutputsWithoutAction
        ℹ️ 13:10:05 Web socket connected for: OutputsWithoutAction⧘
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
          window.Elm?.MultipleTargets?.init({ node: node1 });
          window.Elm?.MultipleTargetsOther1?.init({ node: node2 });
        },
      });

      const { terminal, renders, browserConsole } = await go(({ idle }) => {
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

      expect(terminal).toMatchInlineSnapshot(`
        ✅ MultipleTargets⧙                       1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
        ✅ MultipleTargetsOther1⧙                 1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

        📊 ⧙web socket connections:⧘ 2 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Web socket disconnected for: MultipleTargetsOther1
           (2 more events)
        ℹ️ 13:10:05 Web socket connected for: MultipleTargetsOther1⧘
        ✅ ⧙13:10:05⧘ Everything up to date.
      `);

      expect(renders).toMatchInlineSnapshot(`
        ▼ 🔌 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◯ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for reload
        Waiting for other targets to finish compiling…
        ▲ ⏳ 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🌳 🔌 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🌳 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug
        ◯ Standard
        ◯ Optimize
        ▲ 🌳 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug
        ◯ Standard
        ◯ Optimize
        ▲ 🌳 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug
        ◯ Standard
        ◯ Optimize
        ▲ 🌳 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 ✅ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🌳 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 ✅ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🌳 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🌳 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🌳 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        target MultipleTargetsOther1
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for reload
        Waiting for other targets to finish compiling…
        ▲ 🌳 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🌳 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        target MultipleTargetsOther1
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for reload
        Waiting for other targets to finish compiling…
        ▲ 🌳 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for reload
        Waiting for other targets to finish compiling…
        ▲ 🌳 ⏳ 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🌳 🔌 13:10:05 MultipleTargets
        ================================================================================
        ▼ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Connecting
        attempt 1
        sleep 1.01 seconds
        [Connecting web socket…]
        ▲ 🌳 🔌 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Waiting for compilation
        Compilation mode
        ◉ (disabled) Debug
        ◯ (disabled) Standard
        ◯ (disabled) Optimize
        ▲ 🌳 ⏳ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug
        ◯ Standard
        ◯ Optimize
        ▲ 🌳 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 🔌 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug
        ◯ Standard
        ◯ Optimize
        ▲ 🌳 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 ⏳ 13:10:05 MultipleTargetsOther1
        ================================================================================
        target MultipleTargets
        elm-watch %VERSION%
        web socket ws://localhost:59123
        updated 2022-02-05 13:10:05
        status Successfully compiled
        Compilation mode
        ◉ Debug
        ◯ Standard
        ◯ Optimize
        ▲ 🌳 ✅ 13:10:05 MultipleTargets
        --------------------------------------------------------------------------------
        ▼ 🌳 ✅ 13:10:05 MultipleTargetsOther1
      `);

      expect(browserConsole).toMatchInlineSnapshot(`
        Proxy file reload!

        elm-watch: I did a full page reload because:

        MultipleTargets
        - the message type in \`Elm.MultipleTargets\` changed in debug mode ("debug metadata" changed).

        MultipleTargetsOther1
        - the message type in \`Elm.MultipleTargetsOther1\` changed in debug mode ("debug metadata" changed).
      `);
    });

    test("Changed record fields in optimize with postprocess", async () => {
      const { replace, go } = runHotReload({
        fixture: "hot-reload-postprocess",
        name: "ChangedRecordFields",
        programType: "Element",
        compilationMode: "optimize",
        expandUiImmediately: true,
      });

      const { browserConsole } = await go(({ idle, div }) => {
        switch (idle) {
          case 1:
            assertInit(div);
            replace((content) => content.replace(/-- /g, ""));
            return "KeepGoing";
          default:
            assertHotReload(div);
            return "Stop";
        }
      });

      expect(browserConsole).toMatchInlineSnapshot(`
        elm-watch: I did a full page reload because record field mangling in optimize mode was different than last time.
        (target: ChangedRecordFields)
      `);

      function assertInit(div: HTMLDivElement): void {
        expect(div.outerHTML).toMatchInlineSnapshot(`<div>Text</div>`);
      }

      function assertHotReload(div: HTMLDivElement): void {
        expect(div.outerHTML).toMatchInlineSnapshot(
          `<div>Text and new text</div>`
        );
      }
    });
  });
});
