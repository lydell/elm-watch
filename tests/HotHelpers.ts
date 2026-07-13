import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { expect } from "vitest";

import {
  ElmModule,
  ReachedIdleStateReason,
  UppercaseLetter,
} from "../client/client";
import elmWatchCli from "../src";
import { ElmWatchStuffJson } from "../src/ElmWatchStuffJson";
import { Env } from "../src/Env";
import { ReadStream } from "../src/Helpers";
import { HotKillManager } from "../src/Hot";
import { makeLogger } from "../src/Logger";
import { markAsPort } from "../src/Port";
import { BrowserUiPosition, CompilationMode } from "../src/Types";
import {
  badElmBinEnv,
  clean,
  CursorWriteStream,
  logDebug,
  maybeClearElmStuff,
  MemoryWriteStream,
  rimraf,
  rm,
  SilentReadStream,
  TEST_ENV,
  TEST_ENV_WITHOUT_ELM_ERROR_WORKAROUND,
  wait,
} from "./Helpers";

const CONTAINER_ID = "elm-watch";
export const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures", "hot");

let watcher: fs.FSWatcher | undefined = undefined;
const hotKillManager: HotKillManager = { kill: undefined };

export async function cleanupAfterEachTest(): Promise<void> {
  const { currentTestName } = expect.getState();

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (window.__ELM_WATCH?.KILL_MATCHING !== undefined) {
    // The idea is that we need no logging here – it’ll just result in double
    // logging since there will most likely be a running server as well.
    await window.__ELM_WATCH.KILL_MATCHING(/^/);
  }

  if (watcher !== undefined) {
    // eslint-disable-next-line no-console
    console.error(
      "cleanupAfterEachTest: watcher never closed by itself – closing now. Test:",
      currentTestName,
    );
    watcher.close();
    watcher = undefined;
  }

  if (hotKillManager.kill !== undefined) {
    // eslint-disable-next-line no-console
    console.error(
      "cleanupAfterEachTest: elm-watch never finished – killing. Test:",
      currentTestName,
    );
    await hotKillManager.kill();
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
  useElmErrorWorkaround?: boolean;
  stdin?: ReadStream;
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
  useElmErrorWorkaround = true,
  stdin = new SilentReadStream(),
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
  // eslint-disable-next-line no-console
  console.warn = () => {
    // Disable Elm’s “Compiled in DEV mode” logs.
  };

  const dir = path.join(FIXTURES_DIR, fixture);
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
            ...(useElmErrorWorkaround
              ? TEST_ENV
              : TEST_ENV_WITHOUT_ELM_ERROR_WORKAROUND),
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

    let idle = 0;
    window.__ELM_WATCH.ON_REACHED_IDLE_STATE = (reason) => {
      idle++;
      // So that another idle state can’t change the previous’ number while it’s waiting.
      const localIdle = idle;
      const actualMain = body.querySelector("main");
      const fallbackMain = document.createElement("main");
      fallbackMain.textContent = "No `main` element found.";
      const main = actualMain ?? fallbackMain;
      // Wait for logs to settle. This type of tests is pretty slow to run through
      // anyway, so this wait is just a drop in the ocean.
      wait(100)
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
                hotKillManager.kill === undefined
                  ? undefined
                  : hotKillManager.kill(),
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

    elmWatchCli(["hot", ...args], {
      cwd: path.join(dir, cwd),
      env: fullEnv,
      stdin,
      stdout,
      stderr,
      logDebug,
      hotKillManager,
    })
      .then(resolve)
      .catch(reject);
  });

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

function joinRenders(renders: Array<string>): string {
  return clean(renders.join(`\n${"=".repeat(80)}\n`));
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
  const dir = path.join(FIXTURES_DIR, fixture);
  const src = path.join(dir, "src");

  const elmWatchStuffJson: ElmWatchStuffJson = {
    port: markAsPort(58888),
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
        Codec.JSON.stringify(ElmWatchStuffJson, elmWatchStuffJson),
      );

      // Here we write a file just before we start the watcher. I’ve seen this file
      // be picked up by the watcher! But only when running all tests. Here’s the theory:
      // 1. We write the file.
      // 2. The operating system (macOS) takes note of the change. It is added to some
      //    kind of batch of file system changes.
      // 3. We start the watcher, which tells the OS that we are interested in file system changes.
      // 4. The OS flushes its batch of file system changes to all subscribers.
      // By waiting a little bit, we avoid getting updates about changes before we started watching.
      // It’s a bad solution, but it does make tests less flaky. This type of tests is pretty slow
      // to run through anyway, so this wait is just a drop in the ocean.
      write(1);
      await wait(100);

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
      result = `<overlay ${overlay.hidden ? "hidden" : "visible"} style="${
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
