import * as fs from "fs";
import * as path from "path";

import {
  ElmModule,
  ReachedIdleStateReason,
  UppercaseLetter,
} from "../client/client";
import { elmWatchCli } from "../src";
import { ElmWatchStuffJsonWritable } from "../src/ElmWatchStuffJson";
import { Env } from "../src/Env";
import { makeLogger } from "../src/Logger";
import { CompilationMode } from "../src/Types";
import {
  badElmBinEnv,
  clean,
  CursorWriteStream,
  FailReadStream,
  logDebug,
  MemoryWriteStream,
  rm,
  TEST_ENV,
  wait,
} from "./Helpers";

const CONTAINER_ID = "elm-watch";
export const FIXTURES_DIR = path.join(__dirname, "fixtures", "hot");

export function cleanupBeforeEachTest(): void {
  // eslint-disable-next-line no-console
  console.warn = () => {
    // Disable Elm’s “Compiled in DEV mode” logs.
  };
  document.getElementById(CONTAINER_ID)?.remove();
  window.history.replaceState(null, "", "/");
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
  keepElmStuffJson?: boolean;
  clearElmStuff?: boolean;
  cwd?: string;
  includeProxyReloads?: boolean;
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
  keepElmStuffJson = false,
  clearElmStuff = false,
  cwd = ".",
  includeProxyReloads = false,
}: SharedRunOptions & {
  fixture: string;
  scripts: Array<string>;
  args?: Array<string>;
  init: (node: HTMLDivElement) => void;
  onIdle: OnIdle;
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

  fs.rmSync(build, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });

  if (!keepElmStuffJson) {
    rm(elmWatchStuff);
  }

  if (clearElmStuff) {
    fs.rmSync(elmStuff, { recursive: true, force: true });
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
        "__ELM_WATCH_DISCONNECT",
      ]) {
        delete (window as unknown as Record<string, unknown>)[key];
      }

      (async () => {
        for (const script of absoluteScripts) {
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
          await import(newScript);
        }
      })()
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
          onIdle({ idle: localIdle, div: outerDiv, main, body, reason, stdout })
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
  init?: (node: HTMLDivElement) => void;
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
        keepElmStuffJson: true,
        ...sharedOptions,
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

function withShadowRoot(f: (shadowRoot: ShadowRoot) => void): void {
  const shadowRoot =
    document.getElementById(CONTAINER_ID)?.shadowRoot ?? undefined;

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

export function switchCompilationMode(compilationMode: CompilationMode): void {
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

export function assertCompilationMode(compilationMode: CompilationMode): void {
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

export function assertDebugDisabled(): void {
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

export function assertDebugger(body: HTMLBodyElement): void {
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
      }`
    );
  }
}
