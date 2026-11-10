import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { expect } from "vitest";
import * as vm from "vm";

import type { ElmModule, UppercaseLetter } from "../client/client.ts";
import { retryWaitMs } from "../client/Ui.ts";
import type { ReachedIdleStateReason } from "../client/Update.ts";
import elmWatchCli, { elmWatch } from "../src/ElmWatch.ts";
import { ElmWatchStuffJson } from "../src/ElmWatchStuffJson.ts";
import type { Env } from "../src/Env.ts";
import type { ReadStream } from "../src/Helpers.ts";
import type { HotTestHooks, Msg } from "../src/Hot.ts";
import { makeLogger } from "../src/Logger.ts";
import { markAsPort } from "../src/Port.ts";
import type { CompilationMode } from "../src/Types.ts";
import { copyFixture } from "./FixtureCopies.ts";
import {
  badElmBinEnv,
  clean,
  CursorWriteStream,
  fixtureOptions,
  logDebug,
  maybeClearElmStuff,
  MemoryWriteStream,
  rimraf,
  rm,
  SilentReadStream,
  TEST_ENV,
  waitFor,
  waitOneFrame,
} from "./Helpers.ts";

const CONTAINER_ID = "elm-watch-ui-1";
export function fixtureDir(fixture: string): string {
  return copyFixture("hot", fixture);
}

let watcher: fs.FSWatcher | undefined = undefined;
let elmWatchIsIdle = false;
let watcherIsReady = false;
const msgListeners = new Set<(msg: Msg) => void>();
const sigtermListeners = new Set<() => void>();
const hotTestHooks: HotTestHooks = {
  kill: undefined,
  onUpdate: (msg, isIdle) => {
    elmWatchIsIdle = isIdle;
    for (const listener of msgListeners) {
      listener(msg);
    }
  },
  onWatcherReadyChange: (isReady) => {
    watcherIsReady = isReady;
  },
  subscribeToSigterm: (listener) => {
    sigtermListeners.add(listener);
    return () => {
      sigtermListeners.delete(listener);
    };
  },
};

// Simulates `node --watch` restarting elm-watch.
export function sendSigterm(): void {
  for (const listener of sigtermListeners) {
    listener();
  }
}

// Resolves once elm-watch has handled a message matching `predicate`. Call this
// _before_ doing the thing that causes the message, and await the returned
// promise after. For example, to wait for the watcher to pick up a file change:
//
//     const changed = nextMsg((msg) => msg.tag === "GotWatcherEvent");
//     touch(file);
//     await changed;
export async function nextMsg(predicate: (msg: Msg) => boolean): Promise<void> {
  return new Promise((resolve) => {
    const listener = (msg: Msg): void => {
      if (predicate(msg)) {
        msgListeners.delete(listener);
        resolve();
      }
    };
    msgListeners.add(listener);
  });
}

// Like `nextMsg`, but resolves once elm-watch has picked up a change to
// `absolutePath` _and_ acted on it (which happens after a short debounce).
// Waiting for a specific path is important, since there might be late events
// for other files (such as lock files written by the fake `elm` binaries).
export async function nextWatcherEventHandled(
  absolutePath: string,
): Promise<void> {
  await nextMsg(
    (msg) => msg.tag === "GotWatcherEvent" && msg.absolutePath === absolutePath,
  );
  await nextMsg((msg) => msg.tag === "SleepBeforeNextActionDone");
}

// Resolves once elm-watch has nothing more to do (until something happens),
// and is ready to pick up file changes.
export async function waitForElmWatchIdle(): Promise<void> {
  await waitFor(() => elmWatchIsIdle && watcherIsReady);
}

// Resolves once elm-watch has received the events for all file changes made
// before the call, and has acted on them. Use this instead of sleeping, for
// example to make sure that nothing more happens after a change.
export async function waitForWatcherToSettle(): Promise<void> {
  const { flushWatcher } = hotTestHooks;
  if (flushWatcher === undefined) {
    throw new Error("waitForWatcherToSettle: elm-watch is not running.");
  }
  await flushWatcher();
  await waitForElmWatchIdle();
}

// Resolves once elm-watch is ready to pick up file changes. Changes made before
// that are ignored.
export async function waitForWatcherReady(): Promise<void> {
  await waitFor(() => watcherIsReady);
}
let describeUnfinishedRun: (() => string) | undefined = undefined;

export async function cleanupAfterEachTest(): Promise<void> {
  const { currentTestName } = expect.getState();

  // oxlint-disable-next-line typescript/no-unnecessary-condition
  if (window.__ELM_WATCH?.KILL_MATCHING !== undefined) {
    // The idea is that we need no logging here – it’ll just result in double
    // logging since there will most likely be a running server as well.
    await window.__ELM_WATCH.KILL_MATCHING(/^/);
  }

  if (watcher !== undefined) {
    // oxlint-disable-next-line no-console
    console.error(
      "cleanupAfterEachTest: watcher never closed by itself – closing now. Test:",
      currentTestName,
    );
    watcher.close();
    watcher = undefined;
  }

  if (hotTestHooks.kill !== undefined) {
    // oxlint-disable-next-line no-console
    console.error(
      "cleanupAfterEachTest: elm-watch never finished – killing. Test:",
      currentTestName,
      // Print what has happened so far, so that there’s something to go on
      // when a test times out.
      `\n${describeUnfinishedRun?.() ?? ""}`,
    );
    await hotTestHooks.kill();
  }

  document.getElementById(CONTAINER_ID)?.remove();
  window.history.replaceState(null, "", "/");

  delete (window as unknown as Record<string, unknown>)["__ELM_WATCH"];
}

let bodyCounter = 0;

type OnIdle = (params: {
  idle: number;
  div: HTMLDivElement;
  main: HTMLElement;
  body: HTMLBodyElement;
  reason: ReachedIdleStateReason;
  stdout: CursorWriteStream;
}) => OnIdleResult | Promise<OnIdleResult>;

type OnIdleResult = "KeepGoing" | "Stop";

type SharedRunOptions = {
  expandUiImmediately?: boolean;
  isTTY?: boolean;
  bin?: string;
  env?: Env;
  keepBuild?: boolean;
  keepElmStuffJson?: boolean;
  clearElmStuff?: boolean;
  cwd?: string;
  includeProxyReloads?: boolean;
  simulateHttpCacheOnReload?: boolean;
  stdin?: ReadStream;
  // Use `elmWatch()` with these options (and `runMode: "hot"`) instead of the
  // CLI with `args`. The fixture’s postprocess.js is used for all targets.
  // Pass an object to add extra options.
  useElmWatchFunction?: boolean | Record<string, unknown>;
};

export async function run({
  fixture,
  scripts,
  args = [],
  init,
  onIdle,
  expandUiImmediately = false,
  isTTY = true,
  bin,
  env,
  keepBuild = false,
  keepElmStuffJson = false,
  clearElmStuff = false,
  cwd = ".",
  includeProxyReloads = false,
  simulateHttpCacheOnReload = false,
  stdin = new SilentReadStream(),
  useElmWatchFunction = false,
}: SharedRunOptions & {
  fixture: string;
  scripts: Array<string>;
  args?: Array<string>;
  init: (node: HTMLDivElement, allExports: Array<unknown>) => void;
  onIdle: OnIdle;
}): Promise<{
  terminal: string;
  browserConsole: string;
  renders: string;
  lastRender: string;
  onlyExpandedRenders: string;
  div: HTMLDivElement;
}> {
  // oxlint-disable-next-line no-console
  console.warn = () => {
    // Disable Elm’s “Compiled in DEV mode” logs.
  };

  const dir = fixtureDir(fixture);
  const build = path.join(dir, "build");
  const absoluteScripts = scripts.map((script) => path.join(build, script));
  const elmStuff = path.join(dir, "elm-stuff");
  const elmWatchStuff = path.join(elmStuff, "elm-watch", "stuff.json");

  if (!keepBuild) {
    await rimraf(build);
    fs.mkdirSync(build, { recursive: true });
  }

  if (!keepElmStuffJson) {
    rm(elmWatchStuff);
  }

  if (clearElmStuff) {
    await rimraf(elmStuff);
  }

  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const elmWatchOptions =
    useElmWatchFunction === false
      ? undefined
      : {
          ...(await fixtureOptions(path.join(dir, cwd))),
          ...(useElmWatchFunction === true ? {} : useElmWatchFunction),
        };

  const bodyIndex = bodyCounter + 2; // head + original body
  const body = document.createElement("body");
  const outerDiv = document.createElement("div");
  body.append(outerDiv);
  document.documentElement.append(body);
  bodyCounter++;

  const numberedScript = (script: string, loads: number): string =>
    script.replace(/\.(\w+)$/, `.${bodyIndex}.${loads}.$1`);

  const browserConsole: Array<string> = [];
  const renders: Array<string> = [];
  let loads = 0;
  let idle = 0;
  elmWatchIsIdle = false;
  watcherIsReady = false;
  msgListeners.clear();

  describeUnfinishedRun = () =>
    [
      `Idle states reached: ${idle}`,
      `elm-watch idle: ${elmWatchIsIdle.toString()}, watcher ready: ${watcherIsReady.toString()}`,
      `Terminal:\n${clean(stdout.getOutput())}`,
      `stderr:\n${clean(stderr.content)}`,
      `Browser console:\n${browserConsole.join("\n\n")}`,
      `Last render:\n${clean(renders.at(-1) ?? "(none)")}`,
    ].join(`\n${"-".repeat(80)}\n`);

  await new Promise((resolve, reject) => {
    const loadBuiltFiles = (): void => {
      loads++;

      delete (window as unknown as Record<string, unknown>)["Elm"];
      (window as unknown as Record<string, unknown>)["__ELM_WATCH"] = {};
      setBasicElmWatchProperties();

      (async () => {
        const allExports: Array<unknown> = [];
        for (const script of absoluteScripts) {
          // Copying the script does a couple of things:
          // - Avoiding require/import cache.
          // - Makes it easier to debug the tests since one can see all the outputs through time.
          // - Lets us make a few replacements for Vitest.
          const newScript = numberedScript(script, loads);
          const content =
            loads > 2 && simulateHttpCacheOnReload
              ? fs.readFileSync(numberedScript(script, loads - 1), "utf8")
              : fs
                  .readFileSync(script, "utf8")
                  .replace(/\(this\)\);\s*$/, "(window));")
                  .replace(
                    /^(\s*var bodyNode) = .+;/m,
                    `$1 = document.documentElement.children[${bodyIndex}];`,
                  );
          fs.writeFileSync(newScript, content);
          // Running the script directly is much faster than `import()`, which
          // goes through Vitest’s module pipeline. ES modules still need it.
          allExports.push(
            /\bexport default\b/.test(content)
              ? await import(newScript)
              : vm.runInThisContext(content, { filename: newScript }),
          );
        }
        return allExports;
      })()
        .then((allExports) => {
          if (expandUiImmediately) {
            expandUi();
          }
          if (loads > 1) {
            const innerDiv = document.createElement("div");
            outerDiv.replaceChildren(innerDiv);
            body.replaceChildren(outerDiv);
            try {
              init(innerDiv, allExports);
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

    (window as unknown as Record<string, unknown>)["__ELM_WATCH"] = {};

    window.__ELM_WATCH.MOCKED_TIMINGS = true;

    // Reconnect quicker than in real life, to speed up the tests. The UI still
    // shows the default wait time.
    window.__ELM_WATCH.RETRY_WAIT_MS = (attemptNumber) =>
      retryWaitMs(attemptNumber) / 100;

    window.__ELM_WATCH.RELOAD_PAGE = (message) => {
      if (message !== undefined) {
        browserConsole.push(message);
      } else if (includeProxyReloads) {
        browserConsole.push("Proxy file reload!");
      }
      window.__ELM_WATCH
        .KILL_MATCHING(/^/)
        .then(() => {
          loadBuiltFiles();
        })
        .catch(reject);
    };

    window.__ELM_WATCH.ON_RENDER = (targetName) => {
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

    window.__ELM_WATCH.LOG_DEBUG = makeLogger({
      env: {},
      getNow: () => new Date(),
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      logDebug: (message) => {
        logDebug(`Browser: ${message}`);
      },
    }).debug;

    window.__ELM_WATCH.ON_REACHED_IDLE_STATE = (reason) => {
      idle++;
      // So that another idle state can’t change the previous’ number while it’s waiting.
      const localIdle = idle;
      const actualMain = body.querySelector("main");
      const fallbackMain = document.createElement("main");
      fallbackMain.textContent = "No `main` element found.";
      const main = actualMain ?? fallbackMain;
      // Wait for elm-watch to finish logging, and for Elm to render and run
      // Cmds after a hot reload.
      waitForElmWatchIdle()
        .then(waitOneFrame)
        .then(() =>
          onIdle({
            idle: localIdle,
            div: outerDiv,
            main,
            body,
            reason,
            stdout,
          }),
        )
        .then((result) => {
          switch (result) {
            case "KeepGoing":
              return;
            case "Stop":
              return Promise.all([
                window.__ELM_WATCH.KILL_MATCHING(/^/),
                hotTestHooks.kill === undefined
                  ? undefined
                  : hotTestHooks.kill(),
              ]);
          }
        })
        .catch(reject);
    };

    const basic = { ...window.__ELM_WATCH };
    const setBasicElmWatchProperties = (): void => {
      Object.assign(window.__ELM_WATCH, basic);
    };

    if (keepBuild) {
      loadBuiltFiles();
    } else {
      watcher = fs.watch(build, () => {
        if (absoluteScripts.every(fs.existsSync)) {
          watcher?.close();
          watcher = undefined;
          loadBuiltFiles();
        }
      });
      watcher.on("error", reject);
    }

    const sharedOptions = {
      env: fullEnv,
      stdin,
      stdout,
      stderr,
      logDebug,
      hotTestHooks,
    };

    (elmWatchOptions === undefined
      ? elmWatchCli(["hot", ...args], {
          cwd: path.join(dir, cwd),
          ...sharedOptions,
        })
      : elmWatch({ ...elmWatchOptions, runMode: "hot", ...sharedOptions })
    )
      .then(resolve)
      .catch(reject);
  });

  describeUnfinishedRun = undefined;

  const stdoutString = clean(stdout.getOutput());

  maybeClearElmStuff(stdoutString, dir);
  expect(stderr.content).toBe("");

  return {
    terminal: stdoutString,
    browserConsole: browserConsole.join("\n\n"),
    renders: joinRenders(renders),
    lastRender: clean(renders.at(-1) ?? "(none)"),
    onlyExpandedRenders: joinRenders(
      renders.filter((render) => render.includes("▲")),
    ),
    div: outerDiv,
  };
}

const RENDER_SEPARATOR = `\n${"=".repeat(80)}\n`;

// A persisted port that is taken is an error, so each test needs its own port.
// Asking the operating system for a free port is not enough: Another test file
// running in parallel can get the same port (from listening on port 0, or for
// an outgoing connection) before elm-watch starts listening on it. Instead,
// each Vitest worker gets its own range of ports, below the ephemeral port
// ranges of macOS, Linux and Windows. Tests within a worker run in sequence.
let portCounter = 0;
function getUniquePort(): number {
  const poolId = Number(process.env["VITEST_POOL_ID"] ?? "0");
  portCounter++;
  return 20000 + poolId * 500 + (portCounter % 500);
}

// Whether the browser UI renders the same thing once or several times in a row
// depends on timing (for example, whether two messages arrive in the same
// frame). Only keep the first of identical consecutive renders to make
// snapshots stable.
function joinRenders(renders: Array<string>): string {
  return withoutConsecutiveDuplicates(
    clean(renders.join(RENDER_SEPARATOR)).split(RENDER_SEPARATOR),
  ).join(RENDER_SEPARATOR);
}

function withoutConsecutiveDuplicates(renders: Array<string>): Array<string> {
  return renders.filter((render, index) => render !== renders[index - 1]);
}

// Whether the browser UI needs one or several attempts to connect to the web
// socket depends on timing. Remove the (expanded) connection attempts to make
// snapshots stable.
export function withoutConnectionAttempts(renders: string): string {
  return withoutConsecutiveDuplicates(
    renders
      .split(RENDER_SEPARATOR)
      .filter((render) => !/ (?:Connecting|Sleeping) · \d/.test(render)),
  ).join(RENDER_SEPARATOR);
}

export function runHotReload({
  fixture = "hot-reload",
  name,
  programType,
  compilationMode,
  init,
  extraScripts = [],
  extraElmWatchStuffJson = {},
  ...sharedOptions
}: SharedRunOptions & {
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
  init?: (
    node: HTMLDivElement,
    allExports: Array<unknown>,
  ) => ReturnType<ElmModule["init"]> | undefined;
  extraScripts?: Array<string>;
  extraElmWatchStuffJson?: ElmWatchStuffJson["targets"];
}): {
  inputPath: string;
  replace: (f: (fileContent: string) => string) => void;
  write: (n: number) => void;
  removeInput: () => void;
  sendToElm: (value: number) => void;
  lastValueFromElm: { value: unknown };
  go: (onIdle: OnIdle) => ReturnType<typeof run>;
} {
  const dir = fixtureDir(fixture);
  const src = path.join(dir, "src");

  const elmWatchStuffJson: Omit<ElmWatchStuffJson, "port"> = {
    targets: {
      [name]: {
        compilationMode,
      },
      ...extraElmWatchStuffJson,
    },
  };

  let lastContent = "";

  const write = (n: number): void => {
    const content = fs.readFileSync(path.join(src, `${name}${n}.elm`), "utf8");
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
    const send = app?.ports?.["fromJs"]?.send;
    if (send === undefined) {
      throw new Error("Failed to find 'fromJs' send port.");
    }
    send(value);
  };

  return {
    inputPath: path.join(src, `${name}.elm`),
    replace,
    write,
    removeInput,
    sendToElm,
    lastValueFromElm,
    go: async (onIdle: OnIdle) => {
      const elmWatchStuffJsonPath = path.join(
        dir,
        "elm-stuff",
        "elm-watch",
        "stuff.json",
      );
      fs.mkdirSync(path.dirname(elmWatchStuffJsonPath), { recursive: true });
      fs.writeFileSync(
        elmWatchStuffJsonPath,
        Codec.JSON.stringify(ElmWatchStuffJson, {
          port: markAsPort(getUniquePort()),
          ...elmWatchStuffJson,
        }),
      );

      write(1);

      return run({
        fixture,
        args: [name],
        scripts: [`${name}.js`, ...extraScripts],
        keepElmStuffJson: true,
        ...sharedOptions,
        init:
          init === undefined
            ? (node) => {
                app = window.Elm?.[name]?.init({ node });
                if (app?.ports !== undefined) {
                  const subscribe = app.ports["toJs"]?.subscribe;
                  if (subscribe === undefined) {
                    throw new Error("Failed to find 'toJs' subscribe port.");
                  }
                  subscribe((value: unknown) => {
                    lastValueFromElm.value = value;
                  });
                }
              }
            : (node, allExports) => {
                app = init(node, allExports);
              },
        onIdle,
      });
    },
  };
}

function withShadowRoot(f: (shadowRoot: ShadowRoot) => void): void {
  const shadowRoot =
    document.getElementById(CONTAINER_ID)?.firstElementChild?.shadowRoot ??
    undefined;

  if (shadowRoot === undefined) {
    throw new Error(`Couldn’t find #${CONTAINER_ID}!`);
  } else {
    f(shadowRoot);
  }
}

export function expandUi(): void {
  expandUiHelper(true);
}

export function collapseUi(): void {
  expandUiHelper(false);
}

function expandUiHelper(wantExpanded: boolean): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(`button[aria-expanded]`);
    if (button instanceof HTMLElement) {
      if (button.getAttribute("aria-expanded") !== wantExpanded.toString()) {
        button.click();
        // Opening and closing the panel happens in the UI without involving
        // the targets, so record a render here like the targets do.
        window.__ELM_WATCH.ON_RENDER("expandUiHelper");
      }
    } else {
      throw new Error(`Could not button for expanding UI.`);
    }
  });
}

export function showErrors(): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(
      `[data-test-id="ShowErrorOverlayButton"]`,
    );
    if (button instanceof HTMLElement) {
      button.click();
    } else {
      throw new Error(`Could not button for showing errors.`);
    }
  });
}

export function hideErrors(): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(
      `[data-test-id="HideErrorOverlayButton"]`,
    );
    if (button instanceof HTMLElement) {
      button.click();
    } else {
      throw new Error(`Could not button for hiding errors.`);
    }
  });
}

export function closeOverlay(): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(
      `[data-test-id="OverlayCloseButton"]`,
    );
    if (button instanceof HTMLElement) {
      button.click();
    } else {
      throw new Error(`Could not button for closing overlay.`);
    }
  });
}

export function pressEscape(): void {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
  );
}

export function isOverlayVisible(): boolean {
  let visible = false;
  withShadowRoot((shadowRoot) => {
    const overlay = shadowRoot.querySelector(`[data-test-id="Overlay"]`);
    visible = overlay instanceof HTMLElement && overlay.hidden === false;
  });
  return visible;
}

export function getOverlay(): string {
  let result = "(Overlay not found)";
  withShadowRoot((shadowRoot) => {
    const overlay = shadowRoot.querySelector(`[data-test-id="Overlay"]`);
    if (overlay instanceof HTMLElement) {
      const children = Array.from(overlay.children, (child, index) => {
        if (child.classList.contains("overlayFooter")) {
          return printOverlayFooter(child);
        }
        const clone = child.cloneNode(true) as HTMLElement;
        clone.id = index.toString();
        for (const element of [clone, ...clone.querySelectorAll("[class]")]) {
          element.removeAttribute("class");
        }
        return clone.outerHTML.replace("<pre>", "\n<pre>");
      }).join(`\n${"-".repeat(80)}\n`);
      result = `<overlay ${overlay.hidden !== false ? "hidden" : "visible"} style="${
        overlay.getAttribute("style") ?? ""
      }">\n${children}\n</overlay>`;
    }
  });
  return clean(result);
}

// Prints the footer as text, with keys that don’t do anything replaced by "_":
// <footer>🚨 error 1/2 | [_→] error | [_↓] file | [enter] open in editor</footer>
function printOverlayFooter(footer: Element): string {
  const parts = Array.from(footer.children, (child) =>
    child.children.length === 0
      ? [child.textContent]
      : Array.from(child.children, (hint) =>
          Array.from(hint.childNodes, (node) =>
            node instanceof HTMLButtonElement && node.disabled
              ? "_"
              : node.textContent,
          ).join(""),
        ),
  );
  return `<footer>${parts.flat().join(" | ")}</footer>`;
}

// Presses a key while the error overlay is open.
export function pressOverlayKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
}

export function getOverlayElement(selector: string): HTMLElement {
  let element: Element | undefined = undefined;
  withShadowRoot((shadowRoot) => {
    element =
      shadowRoot.querySelector(`[data-test-id="Overlay"] ${selector}`) ??
      undefined;
  });
  const found = element as Element | undefined;
  if (found instanceof HTMLElement) {
    return found;
  }
  throw new Error(`Could not find ${selector} in overlay.`);
}

export function getOverlayAnnouncement(): string {
  let text = "(Announcement not found)";
  withShadowRoot((shadowRoot) => {
    text =
      shadowRoot.querySelector(`[aria-live]`)?.textContent ??
      "(Announcement not found)";
  });
  return text;
}

export function clickFirstErrorLocation(): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(`[data-test-id="Overlay"] button`);
    if (button instanceof HTMLButtonElement) {
      button.click();
    } else {
      throw new Error(`Could not find any button in overlay.`);
    }
  });
}

// Moves the browser UI with Shift + an arrow key, and returns the classes of
// the UI root element afterwards (which reflect the position).
export function moveUi(
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
): string {
  let className = "";
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(`button[aria-expanded]`);
    if (button instanceof HTMLButtonElement) {
      button.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          shiftKey: true,
          bubbles: true,
          composed: true,
          cancelable: true,
        }),
      );
      className = button.parentElement?.className ?? "";
    } else {
      throw new Error(`Could not find the button for expanding the UI.`);
    }
  });
  return className;
}

export function switchCompilationMode(compilationMode: CompilationMode): void {
  expandUi();
  withShadowRoot((shadowRoot) => {
    const radio = shadowRoot.querySelector(
      `input[type="radio"][value="${compilationMode}"]`,
    );
    if (radio instanceof HTMLInputElement) {
      radio.click();
    } else {
      throw new Error(`Could not find radio button for ${compilationMode}.`);
    }
  });
}

export function assertCompilationMode(compilationMode: CompilationMode): void {
  expandUi();
  withShadowRoot((shadowRoot) => {
    const radio = shadowRoot.querySelector(`input[type="radio"]:checked`);
    if (radio instanceof HTMLInputElement) {
      expect(radio.value).toStrictEqual(compilationMode);
    } else {
      throw new Error(
        `Could not find a checked radio button (expecting to be ${compilationMode}).`,
      );
    }
  });
}

export function assertDebugDisabled(): void {
  expandUi();
  withShadowRoot((shadowRoot) => {
    const radio = shadowRoot.querySelector('input[type="radio"]');
    if (radio instanceof HTMLInputElement) {
      expect(radio.disabled).toBe(true);
    } else {
      throw new Error(`Could not find any radio button!`);
    }
  });
  collapseUi();
}

export function assertDebugger(body: HTMLBodyElement): void {
  expect(
    Array.from(body.querySelectorAll("svg"), (element) => element.localName),
  ).toStrictEqual(["svg"]);
}

function getTextContent(node: Node): string {
  const parts: Array<string> = [];
  walkTextNodes(node, parts);
  return parts.join("").trim().replace(/\n /g, "\n");
}

function walkTextNodes(node: Node, parts: Array<string>): void {
  const newline = (): void => {
    // Avoid empty lines from nested elements that all start a new line.
    if (parts.at(-1) !== "\n") {
      parts.push("\n");
    }
  };
  if (node instanceof Text) {
    parts.push(" ", node.data.trim());
  } else if (node instanceof HTMLInputElement && node.type === "radio") {
    parts.push(
      (node.checked ? "◉" : "◯") + (node.disabled ? " (disabled)" : ""),
    );
  } else if (node instanceof HTMLButtonElement) {
    const textContent = node.textContent.trim();
    const expanded = node.getAttribute("aria-expanded");
    if (expanded !== null) {
      parts.push(`${expanded === "true" ? "▲" : "▼"} ${textContent}`);
    } else {
      newline();
      parts.push(
        `[${textContent === "" ? (node.getAttribute("aria-label") ?? "") : textContent}]`,
      );
    }
  } else if (node instanceof HTMLAnchorElement) {
    const textContent = node.textContent.trim();
    parts.push(` [${textContent}](${node.href})`);
  } else {
    if (shouldAddNewline(node)) {
      newline();
    }
    for (const child of node.childNodes) {
      walkTextNodes(child, parts);
    }
  }
}

function shouldAddNewline(node: Node): boolean {
  switch (node.nodeName) {
    case "DIV":
    case "HEADER":
    case "LEGEND":
    case "LABEL":
    case "P":
    case "PRE":
      return true;
    default:
      return false;
  }
}

export function failInit(): never {
  throw new Error("Expected `init` not to be called!");
}

export function click(element: HTMLElement, selector: string): void {
  const target = element.querySelector(selector);
  if (target instanceof HTMLElement) {
    target.click();
  } else {
    throw new Error(
      `Element to click is not considered clickable: ${selector} -> ${
        target === null ? "not found" : target.nodeName
      }`,
    );
  }
}
