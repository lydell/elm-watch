import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { expect } from "vitest";

import {
  ElmModule,
  ReachedIdleStateReason,
  UppercaseLetter,
} from "../client/client";
import elmWatchCli, { elmWatch } from "../src";
import { ElmWatchStuffJson } from "../src/ElmWatchStuffJson";
import { Env } from "../src/Env";
import { ReadStream } from "../src/Helpers";
import { HotTestHooks, Msg } from "../src/Hot";
import { makeLogger } from "../src/Logger";
import { markAsPort } from "../src/Port";
import { BrowserUiPosition, CompilationMode } from "../src/Types";
import { copyFixture } from "./FixtureCopies";
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
} from "./Helpers";

const CONTAINER_ID = "elm-watch";
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

// Like `nextMsg`, but resolves once elm-watch has picked up a file change _and_
// acted on it (which happens after a short debounce).
export async function nextWatcherEventHandled(): Promise<void> {
  await nextMsg((msg) => msg.tag === "GotWatcherEvent");
  await nextMsg((msg) => msg.tag === "SleepBeforeNextActionDone");
}

// Resolves once elm-watch has nothing more to do (until something happens),
// and is ready to pick up file changes.
export async function waitForElmWatchIdle(): Promise<void> {
  await waitFor(() => elmWatchIsIdle && watcherIsReady);
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
  useElmWatchFunction?: boolean;
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

  const elmWatchOptions = useElmWatchFunction
    ? await fixtureOptions(path.join(dir, cwd))
    : undefined;

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
          allExports.push(await import(newScript));
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

function joinRenders(renders: Array<string>): string {
  return clean(renders.join(RENDER_SEPARATOR));
}

// Whether the browser UI needs one or several attempts to connect to the web
// socket depends on timing. Remove the (expanded) connection attempts to make
// snapshots stable.
export function withoutConnectionAttempts(renders: string): string {
  return renders
    .split(RENDER_SEPARATOR)
    .filter((render) => !/^status (?:Connecting|Sleeping)$/m.test(render))
    .join(RENDER_SEPARATOR);
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

export function expandUi(targetName?: string): void {
  expandUiHelper(true, targetName);
}

export function collapseUi(targetName?: string): void {
  expandUiHelper(false, targetName);
}

function expandUiHelper(wantExpanded: boolean, targetName?: string): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(
      `${
        targetName === undefined
          ? "[data-target]"
          : `[data-target="${targetName}"]`
      } button[aria-expanded]`,
    );
    if (button instanceof HTMLElement) {
      if (button.getAttribute("aria-expanded") !== wantExpanded.toString()) {
        button.click();
      }
    } else {
      throw new Error(`Could not button for expanding UI.`);
    }
  });
}

export function showErrors(targetName?: string): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(
      `${
        targetName === undefined
          ? "[data-target]"
          : `[data-target="${targetName}"]`
      } [data-test-id="ShowErrorOverlayButton"]`,
    );
    if (button instanceof HTMLElement) {
      button.click();
    } else {
      throw new Error(`Could not button for showing errors.`);
    }
  });
}

export function hideErrors(targetName?: string): void {
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(
      `${
        targetName === undefined
          ? "[data-target]"
          : `[data-target="${targetName}"]`
      } [data-test-id="HideErrorOverlayButton"]`,
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

export function getOverlay(): string {
  let result = "(Overlay not found)";
  withShadowRoot((shadowRoot) => {
    const overlay = shadowRoot.querySelector(`[data-test-id="Overlay"]`);
    if (overlay instanceof HTMLElement) {
      const children = Array.from(overlay.children, (child, index) => {
        const clone = child.cloneNode(true) as HTMLElement;
        clone.id = index.toString();
        for (const element of clone.querySelectorAll("[class]")) {
          element.removeAttribute("class");
        }
        return clone.outerHTML
          .replace("<summary", "\n<summary")
          .replace("</summary>", "</summary>\n");
      }).join(`\n${"-".repeat(80)}\n`);
      result = `<overlay ${overlay.hidden !== false ? "hidden" : "visible"} style="${
        overlay.getAttribute("style") ?? ""
      }">\n${children}\n</overlay>`;
    }
  });
  return clean(result);
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

export function moveUi(position: BrowserUiPosition): void {
  expandUi();
  withShadowRoot((shadowRoot) => {
    const button = shadowRoot.querySelector(
      `button[data-position="${position}"]`,
    );
    if (button instanceof HTMLButtonElement) {
      button.click();
    } else {
      throw new Error(`Could not find button for ${position}.`);
    }
  });
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

function getTextContent(element: Node): string {
  return Array.from(walkTextNodes(element))
    .join("")
    .trim()
    .replace(/\n /g, "\n")
    .replace(/[\n·↑↓←→↖↗↙↘]+/g, (match) => {
      const chars = match.replace(/\s/g, "");
      return chars === ""
        ? match
        : `\n${chars.slice(0, 2)}\n${chars.slice(2)}\n`;
    });
}

function* walkTextNodes(element: Node): Generator<string, void, void> {
  if (shouldAddNewline(element)) {
    yield "\n";
  }
  for (const node of element.childNodes) {
    if (node instanceof Text) {
      yield " ";
      yield node.data.trim();
    } else if (node instanceof HTMLInputElement && node.type === "radio") {
      yield (node.checked ? "◉" : "◯") + (node.disabled ? " (disabled)" : "");
    } else if (node instanceof HTMLButtonElement) {
      const textContent = (node.textContent ?? "").trim();
      if (textContent.length === 1) {
        yield textContent;
      } else {
        yield `\n[${textContent}]`;
      }
    } else if (node instanceof HTMLAnchorElement) {
      const textContent = (node.textContent ?? "").trim();
      yield ` [${textContent}](${node.href})`;
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
