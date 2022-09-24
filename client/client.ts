import * as Decode from "tiny-decoders";

import { formatDate, formatTime } from "../src/Helpers";
import { runTeaProgram } from "../src/TeaProgram";
import {
  BrowserUiPosition,
  CompilationMode,
  CompilationModeWithProxy,
  GetNow,
} from "../src/Types";
import {
  decodeWebSocketToClientMessage,
  StatusChanged,
  WebSocketToClientMessage,
  WebSocketToServerMessage,
} from "./WebSocketMessages";

// Support Web Workers, where `window` does not exist.
const window = globalThis as unknown as Window;

const IS_WEB_WORKER = window.window === undefined;

// These used to be separate properties on `window`, like
// `window.__ELM_WATCH_MOCKED_TIMINGS`. It’s better to group them all together
// to avoid “polluting” `window` when using the browser console.
type __ELM_WATCH = {
  MOCKED_TIMINGS: boolean;
  WEBSOCKET_TIMEOUT: number;
  RELOAD_STATUSES: Record<string, ReloadStatus>;
  RELOAD_PAGE: (message: string | undefined) => void;
  ON_INIT: () => void;
  ON_RENDER: (targetName: string) => void;
  ON_REACHED_IDLE_STATE: (reason: ReachedIdleStateReason) => void;
  KILL_MATCHING: (targetName: RegExp) => Promise<void>;
  DISCONNECT: (targetName: RegExp) => void;
  LOG_DEBUG: typeof console.debug;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Window {
    Elm?: Record<`${UppercaseLetter}${string}`, ElmModule>;
    __ELM_WATCH: __ELM_WATCH;
  }
}

export type UppercaseLetter =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";

export type ElmModule = {
  init: (options?: { node?: Element; flags?: unknown }) => {
    ports?: Record<
      string,
      { subscribe?: (value: unknown) => void; send?: (value: unknown) => void }
    >;
  };
  [key: `${UppercaseLetter}${string}`]: ElmModule;
};

type ReloadStatus =
  | {
      tag: "MightWantToReload";
    }
  | {
      tag: "NoReloadWanted";
    }
  | {
      tag: "ReloadRequested";
      reasons: Array<string>;
    };

let { __ELM_WATCH } = window;

if (typeof __ELM_WATCH !== "object" || __ELM_WATCH === null) {
  // Each property is defined later below.
  __ELM_WATCH = {} as unknown as __ELM_WATCH;
  // Using `Object.defineProperty` makes `__ELM_WATCH` not appear when
  // you type just `window.` in the Chrome browser console.
  Object.defineProperty(window, "__ELM_WATCH", { value: __ELM_WATCH });
}

__ELM_WATCH.MOCKED_TIMINGS ??= false;

// In a browser on the same computer, sending a message and receiving a reply
// takes around 2-4 ms. In iOS Safari via WiFi, I’ve seen it take up to 120 ms.
// So 1 second should be plenty above the threshold, while not taking too long.
__ELM_WATCH.WEBSOCKET_TIMEOUT ??= 1000;

__ELM_WATCH.ON_INIT ??= () => {
  // Do nothing.
};

__ELM_WATCH.ON_RENDER ??= () => {
  // Do nothing.
};

__ELM_WATCH.ON_REACHED_IDLE_STATE ??= () => {
  // Do nothing.
};

__ELM_WATCH.RELOAD_STATUSES ??= {};

const RELOAD_MESSAGE_KEY = "__elmWatchReloadMessage";

__ELM_WATCH.RELOAD_PAGE ??= (message) => {
  if (message !== undefined) {
    try {
      window.sessionStorage.setItem(RELOAD_MESSAGE_KEY, message);
    } catch {
      // Ignore failing to write to sessionStorage.
    }
  }
  if (IS_WEB_WORKER) {
    if (message !== undefined) {
      // eslint-disable-next-line no-console
      console.info(message);
    }
    // eslint-disable-next-line no-console
    console.error(
      message === undefined
        ? "elm-watch: You need to reload the page! I seem to be running in a Web Worker, so I can’t do it for you."
        : `elm-watch: You need to reload the page! I seem to be running in a Web Worker, so I couldn’t actually reload the page (see above).`
    );
  } else {
    window.location.reload();
  }
};

__ELM_WATCH.KILL_MATCHING ??= (): Promise<void> => Promise.resolve();

__ELM_WATCH.DISCONNECT ??= (): void => {
  // Do nothing.
};

__ELM_WATCH.LOG_DEBUG ??=
  // eslint-disable-next-line no-console
  console.debug;

const VERSION = "%VERSION%";
const TARGET_NAME = "%TARGET_NAME%";
const INITIAL_ELM_COMPILED_TIMESTAMP = Number(
  "%INITIAL_ELM_COMPILED_TIMESTAMP%"
);
// Note: The JS code running is compiled in `ORIGINAL_COMPILATION_MODE`. But
// that does not necessarily match the selected compilation mode for the target.
// If you have a `Debug.log` and switch to optimize mode it won’t be possible to
// compile, because `Debug.log` isn’t allowed in optimize mode. Therefore we
// have the selected compilation mode in the `Model` and the running mode here.
const ORIGINAL_COMPILATION_MODE =
  "%ORIGINAL_COMPILATION_MODE%" as CompilationModeWithProxy;
// This is the saved browser UI position as of when this file was compiled. We
// also store the latest saved position in the model, which is updated as soon
// as things change.
const ORIGINAL_BROWSER_UI_POSITION =
  "%ORIGINAL_BROWSER_UI_POSITION%" as BrowserUiPosition;
const WEBSOCKET_PORT = "%WEBSOCKET_PORT%";
const CONTAINER_ID = "elm-watch";
const DEBUG = String("%DEBUG%") === "true";

const BROWSER_UI_MOVED_EVENT = "BROWSER_UI_MOVED_EVENT";

// A compilation after moving the browser UI on a big app takes around 700 ms
// for me. So more than double that should be plenty.
const JUST_CHANGED_BROWSER_UI_POSITION_TIMEOUT = 2000;

type Mutable = {
  removeListeners: () => void;
  webSocket: WebSocket;
  webSocketTimeoutId: NodeJS.Timeout | undefined;
};

type Msg =
  | {
      tag: "AppInit";
    }
  | {
      tag: "BrowserUiMoved";
      browserUiPosition: BrowserUiPosition;
    }
  | {
      tag: "EvalErrored";
      date: Date;
    }
  | {
      tag: "EvalNeedsReload";
      date: Date;
      reasons: Array<string>;
    }
  | {
      tag: "EvalSucceeded";
      date: Date;
    }
  | {
      tag: "FocusedTab";
    }
  | {
      tag: "PageVisibilityChangedToVisible";
      date: Date;
    }
  | {
      tag: "SleepBeforeReconnectDone";
      date: Date;
    }
  | {
      tag: "UiMsg";
      date: Date;
      msg: UiMsg;
    }
  | {
      tag: "WebSocketClosed";
      date: Date;
    }
  | {
      tag: "WebSocketConnected";
      date: Date;
    }
  | {
      tag: "WebSocketMessageReceived";
      date: Date;
      data: unknown;
    };

type UiMsg =
  | {
      tag: "ChangedBrowserUiPosition";
      browserUiPosition: BrowserUiPosition;
      sendKey: SendKey;
    }
  | {
      tag: "ChangedCompilationMode";
      compilationMode: CompilationMode;
      sendKey: SendKey;
    }
  | {
      tag: "PressedChevron";
    }
  | {
      tag: "PressedReconnectNow";
    };

type Model = {
  status: Status;
  previousStatusTag: Status["tag"];
  compilationMode: CompilationModeWithProxy;
  browserUiPosition: BrowserUiPosition;
  lastBrowserUiPositionChangeDate: Date | undefined;
  elmCompiledTimestamp: number;
  uiExpanded: boolean;
};

type Cmd =
  | {
      tag: "Eval";
      code: string;
    }
  | {
      tag: "NoCmd";
    }
  | {
      tag: "Reconnect";
      elmCompiledTimestamp: number;
    }
  | {
      tag: "Render";
      model: Model;
      manageFocus: boolean;
    }
  | {
      tag: "SendMessage";
      message: WebSocketToServerMessage;
      // This requires the “send key”. The idea is that this forces you to check
      // `Status` before sending.
      sendKey: SendKey;
    }
  | {
      tag: "SetBrowserUiPosition";
      browserUiPosition: BrowserUiPosition;
    }
  | {
      tag: "SleepBeforeReconnect";
      attemptNumber: number;
    }
  | {
      tag: "TriggerReachedIdleState";
      reason: ReachedIdleStateReason;
    }
  | {
      tag: "UpdateGlobalStatus";
      reloadStatus: ReloadStatus;
    }
  | {
      tag: "WebSocketTimeoutBegin";
    }
  | {
      tag: "WebSocketTimeoutClear";
    };

type Status =
  | {
      tag: "Busy";
      date: Date;
    }
  | {
      tag: "CompileError";
      date: Date;
      sendKey: SendKey;
    }
  | {
      tag: "Connecting";
      date: Date;
      attemptNumber: number;
    }
  | {
      tag: "EvalError";
      date: Date;
    }
  | {
      tag: "Idle";
      date: Date;
      sendKey: SendKey;
    }
  | {
      tag: "SleepingBeforeReconnect";
      date: Date;
      attemptNumber: number;
    }
  | {
      tag: "UnexpectedError";
      date: Date;
      message: string;
    }
  | {
      tag: "WaitingForReload";
      date: Date;
      reasons: Array<string>;
    };

export type ReachedIdleStateReason =
  | "AlreadyUpToDate"
  | "ClientError"
  | "CompileError"
  | "EvalErrored"
  | "EvalSucceeded";

type SendKey = typeof SEND_KEY_DO_NOT_USE_ALL_THE_TIME;

const SEND_KEY_DO_NOT_USE_ALL_THE_TIME: unique symbol = Symbol(
  "This value is supposed to only be obtained via `Status`."
);

function logDebug(...args: Array<unknown>): void {
  if (DEBUG) {
    __ELM_WATCH.LOG_DEBUG(...args);
  }
}

function parseBrowseUiPositionWithFallback(value: unknown): BrowserUiPosition {
  try {
    return BrowserUiPosition(value);
  } catch {
    return ORIGINAL_BROWSER_UI_POSITION;
  }
}

function run(): void {
  try {
    const message = window.sessionStorage.getItem(RELOAD_MESSAGE_KEY);
    if (message !== null) {
      // eslint-disable-next-line no-console
      console.info(message);
      window.sessionStorage.removeItem(RELOAD_MESSAGE_KEY);
    }
  } catch {
    // Ignore failing to read or delete from sessionStorage.
  }

  const elements = IS_WEB_WORKER ? undefined : getOrCreateTargetRoot();
  const browserUiPosition =
    elements === undefined
      ? ORIGINAL_BROWSER_UI_POSITION
      : parseBrowseUiPositionWithFallback(elements.container.dataset.position);
  const getNow: GetNow = () => new Date();

  runTeaProgram<Mutable, Msg, Model, Cmd, undefined>({
    initMutable: initMutable(getNow, elements),
    init: init(getNow(), browserUiPosition),
    update: (msg: Msg, model: Model): [Model, Array<Cmd>] => {
      const [updatedModel, cmds] = update(msg, model);
      const modelChanged = updatedModel !== model;
      const newModel: Model = modelChanged
        ? {
            ...updatedModel,
            previousStatusTag: model.status.tag,
          }
        : model;
      const allCmds: Array<Cmd> = modelChanged
        ? [
            ...cmds,
            {
              tag: "UpdateGlobalStatus",
              reloadStatus: statusToReloadStatus(newModel.status),
            },
            {
              tag: "Render",
              model: newModel,
              manageFocus: msg.tag === "UiMsg",
            },
            model.browserUiPosition === newModel.browserUiPosition
              ? { tag: "NoCmd" }
              : {
                  tag: "SetBrowserUiPosition",
                  browserUiPosition: newModel.browserUiPosition,
                },
          ]
        : cmds;
      logDebug(`${msg.tag} (${TARGET_NAME})`, msg, newModel, allCmds);
      return [newModel, allCmds];
    },
    runCmd: runCmd(getNow, elements),
  }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error("elm-watch: Unexpectedly exited with error:", error);
  });

  // This is great when working on the styling of all statuses.
  // When this call is commented out, esbuild won’t include the
  // `renderMockStatuses` function in the output.
  // renderMockStatuses(getNow, elements);
}

function statusToReloadStatus(status: Status): ReloadStatus {
  switch (status.tag) {
    case "Busy":
    case "Connecting":
      return { tag: "MightWantToReload" };

    case "CompileError":
    case "EvalError":
    case "Idle":
    case "SleepingBeforeReconnect":
    case "UnexpectedError":
      return { tag: "NoReloadWanted" };

    case "WaitingForReload":
      return { tag: "ReloadRequested", reasons: status.reasons };
  }
}

type StatusType = "Error" | "Success" | "Waiting";

function statusToStatusType(statusTag: Status["tag"]): StatusType {
  switch (statusTag) {
    case "Idle":
      return "Success";

    case "Busy":
    case "Connecting":
    case "SleepingBeforeReconnect":
    case "WaitingForReload":
      return "Waiting";

    case "CompileError":
    case "EvalError":
    case "UnexpectedError":
      return "Error";
  }
}

function statusToBrowserUiPositionSendKey(status: Status): SendKey | undefined {
  switch (status.tag) {
    case "CompileError":
    case "Idle":
      return status.sendKey;

    // It works well moving the browser UI while already busy.
    case "Busy":
      return SEND_KEY_DO_NOT_USE_ALL_THE_TIME;

    // We can’t send a message about moving the browser UI if we don’t have a
    // connection.
    case "Connecting":
    case "SleepingBeforeReconnect":
    case "WaitingForReload":
    // These two _might_ work, but it’s unclear. They’re not supposed to happen
    // anyway.
    case "EvalError":
    case "UnexpectedError":
      return undefined;
  }
}

function getOrCreateContainer(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);

  if (existing !== null) {
    return existing;
  }

  const container = h(HTMLDivElement, { id: CONTAINER_ID });
  container.style.all = "unset";
  container.style.position = "fixed";
  container.style.zIndex = "2147483647"; // Maximum z-index supported by browsers.

  const shadowRoot = container.attachShadow({ mode: "open" });
  shadowRoot.append(h(HTMLStyleElement, {}, CSS));
  document.documentElement.append(container);

  return container;
}

type Elements = {
  container: HTMLElement;
  shadowRoot: ShadowRoot;
  root: Element;
  targetRoot: HTMLElement;
};

function getOrCreateTargetRoot(): Elements {
  const container = getOrCreateContainer();
  const { shadowRoot } = container;

  if (shadowRoot === null) {
    throw new Error(
      `elm-watch: Cannot set up hot reload, because an element with ID ${CONTAINER_ID} exists, but \`.shadowRoot\` is null!`
    );
  }

  let root = shadowRoot.querySelector(`.${CLASS.root}`);
  if (root === null) {
    root = h(HTMLDivElement, { className: CLASS.root });
    shadowRoot.append(root);
  }

  const targetRoot = createTargetRoot(TARGET_NAME);
  root.append(targetRoot);

  const elements: Elements = { container, shadowRoot, root, targetRoot };

  setBrowserUiPosition(ORIGINAL_BROWSER_UI_POSITION, elements);

  return elements;
}

function createTargetRoot(targetName: string): HTMLElement {
  return h(HTMLDivElement, {
    className: CLASS.targetRoot,
    attrs: { "data-target": targetName },
  });
}

type PositionCss<Position> = {
  top: Position;
  bottom: Position;
  left: Position;
  right: Position;
};

function browserUiPositionToCss(
  browserUiPosition: BrowserUiPosition
): PositionCss<"-1px" | "auto"> {
  switch (browserUiPosition) {
    case "TopLeft":
      return { top: "-1px", bottom: "auto", left: "-1px", right: "auto" };
    case "TopRight":
      return { top: "-1px", bottom: "auto", left: "auto", right: "-1px" };
    case "BottomLeft":
      return { top: "auto", bottom: "-1px", left: "-1px", right: "auto" };
    case "BottomRight":
      return { top: "auto", bottom: "-1px", left: "auto", right: "-1px" };
  }
}

function browserUiPositionToCssForChooser(
  browserUiPosition: BrowserUiPosition
): PositionCss<"0" | "auto"> {
  switch (browserUiPosition) {
    case "TopLeft":
      return { top: "auto", bottom: "0", left: "auto", right: "0" };
    case "TopRight":
      return { top: "auto", bottom: "0", left: "0", right: "auto" };
    case "BottomLeft":
      return { top: "0", bottom: "auto", left: "auto", right: "0" };
    case "BottomRight":
      return { top: "0", bottom: "auto", left: "0", right: "auto" };
  }
}

function setBrowserUiPosition(
  browserUiPosition: BrowserUiPosition,
  elements: Elements
): void {
  // Only the first target is in charge of the browser UI position.
  const isFirstTargetRoot = elements.targetRoot.previousElementSibling === null;
  if (!isFirstTargetRoot) {
    return;
  }

  elements.container.dataset.position = browserUiPosition;

  for (const [key, value] of Object.entries(
    browserUiPositionToCss(browserUiPosition)
  )) {
    elements.container.style.setProperty(key, value);
  }

  const isInBottomHalf =
    browserUiPosition === "BottomLeft" || browserUiPosition === "BottomRight";
  elements.root.classList.toggle(CLASS.rootBottomHalf, isInBottomHalf);

  elements.shadowRoot.dispatchEvent(
    new CustomEvent(BROWSER_UI_MOVED_EVENT, { detail: browserUiPosition })
  );
}

const initMutable =
  (getNow: GetNow, elements: Elements | undefined) =>
  (
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: undefined) => void
  ): Mutable => {
    let removeListeners: Array<() => void> = [];

    const mutable: Mutable = {
      removeListeners: () => {
        for (const removeListener of removeListeners) {
          removeListener();
        }
      },
      webSocket: initWebSocket(
        getNow,
        INITIAL_ELM_COMPILED_TIMESTAMP,
        dispatch
      ),
      webSocketTimeoutId: undefined,
    };

    // These events might happen before the Web Socket is ready.
    // Firefox throws this error via `FocusedTab`:
    // DOMException: An attempt was made to use an object that is not, or is no longer, usable
    // So wait until the Web Socket is ready before starting those listeners.
    mutable.webSocket.addEventListener(
      "open",
      () => {
        removeListeners = [
          addEventListener(window, "focus", (event) => {
            // Used in tests to trigger focus for just one target.
            if (event instanceof CustomEvent && event.detail !== TARGET_NAME) {
              return;
            }
            dispatch({ tag: "FocusedTab" });
          }),
          addEventListener(window, "visibilitychange", () => {
            if (document.visibilityState === "visible") {
              dispatch({
                tag: "PageVisibilityChangedToVisible",
                date: getNow(),
              });
            }
          }),
          elements === undefined
            ? () => {
                // Do nothing
              }
            : addEventListener(
                elements.shadowRoot,
                BROWSER_UI_MOVED_EVENT,
                (event) => {
                  dispatch({
                    tag: "BrowserUiMoved",
                    browserUiPosition: Decode.fields((field) =>
                      field("detail", parseBrowseUiPositionWithFallback)
                    )(event),
                  });
                }
              ),
        ];
      },
      { once: true }
    );

    __ELM_WATCH.RELOAD_STATUSES[TARGET_NAME] = {
      tag: "MightWantToReload",
    };

    const originalOnInit = __ELM_WATCH.ON_INIT;
    __ELM_WATCH.ON_INIT = () => {
      dispatch({ tag: "AppInit" });
      originalOnInit();
    };

    const originalKillMatching = __ELM_WATCH.KILL_MATCHING;
    __ELM_WATCH.KILL_MATCHING = (targetName) =>
      new Promise((resolve, reject) => {
        if (
          targetName.test(TARGET_NAME) &&
          mutable.webSocket.readyState !== WebSocket.CLOSED
        ) {
          mutable.webSocket.addEventListener("close", () => {
            originalKillMatching(targetName).then(resolve).catch(reject);
          });
          mutable.removeListeners();
          mutable.webSocket.close();
          if (mutable.webSocketTimeoutId !== undefined) {
            clearTimeout(mutable.webSocketTimeoutId);
            mutable.webSocketTimeoutId = undefined;
          }
          elements?.targetRoot.remove();
          resolvePromise(undefined);
        } else {
          originalKillMatching(targetName).then(resolve).catch(reject);
        }
      });

    const originalDisconnect = __ELM_WATCH.DISCONNECT;
    __ELM_WATCH.DISCONNECT = (targetName) => {
      if (
        targetName.test(TARGET_NAME) &&
        mutable.webSocket.readyState !== WebSocket.CLOSED
      ) {
        mutable.webSocket.close();
      } else {
        originalDisconnect(targetName);
      }
    };

    return mutable;
  };

function addEventListener<EventName extends string>(
  target: EventTarget,
  eventName: EventName,
  listener: (event: Event) => void
): () => void {
  target.addEventListener(eventName, listener);
  return () => {
    target.removeEventListener(eventName, listener);
  };
}

function initWebSocket(
  getNow: GetNow,
  elmCompiledTimestamp: number,
  dispatch: (msg: Msg) => void
): WebSocket {
  const hostname =
    window.location.hostname === "" ? "localhost" : window.location.hostname;
  const url = new URL(`ws://${hostname}:${WEBSOCKET_PORT}/`);
  url.searchParams.set("elmWatchVersion", VERSION);
  url.searchParams.set("targetName", TARGET_NAME);
  url.searchParams.set("elmCompiledTimestamp", elmCompiledTimestamp.toString());

  const webSocket = new WebSocket(url);

  webSocket.addEventListener("open", () => {
    dispatch({ tag: "WebSocketConnected", date: getNow() });
  });

  webSocket.addEventListener("close", () => {
    dispatch({
      tag: "WebSocketClosed",
      date: getNow(),
    });
  });

  webSocket.addEventListener("message", (event) => {
    dispatch({
      tag: "WebSocketMessageReceived",
      date: getNow(),
      data: event.data,
    });
  });

  return webSocket;
}

const init = (
  date: Date,
  browserUiPosition: BrowserUiPosition
): [Model, Array<Cmd>] => {
  const model: Model = {
    status: { tag: "Connecting", date, attemptNumber: 1 },
    previousStatusTag: "Idle",
    compilationMode: ORIGINAL_COMPILATION_MODE,
    browserUiPosition,
    lastBrowserUiPositionChangeDate: undefined,
    elmCompiledTimestamp: INITIAL_ELM_COMPILED_TIMESTAMP,
    uiExpanded: false,
  };
  return [model, [{ tag: "Render", model, manageFocus: false }]];
};

function update(msg: Msg, model: Model): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "AppInit":
      // Force a re-render, so the status icon can update. Need to create a new
      // model to trump the `===` check used to avoid re-renders.
      return [{ ...model }, []];

    case "BrowserUiMoved":
      return [{ ...model, browserUiPosition: msg.browserUiPosition }, []];

    case "EvalErrored":
      return [
        {
          ...model,
          status: { tag: "EvalError", date: msg.date },
          uiExpanded: true,
        },
        [
          {
            tag: "TriggerReachedIdleState",
            reason: "EvalErrored",
          },
        ],
      ];

    case "EvalNeedsReload":
      return [
        {
          ...model,
          status: {
            tag: "WaitingForReload",
            date: msg.date,
            reasons: msg.reasons,
          },
          uiExpanded: true,
        },
        [],
      ];

    case "EvalSucceeded":
      return [
        {
          ...model,
          status: {
            tag: "Idle",
            date: msg.date,
            sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
          },
        },
        [
          {
            tag: "TriggerReachedIdleState",
            reason: "EvalSucceeded",
          },
        ],
      ];

    case "FocusedTab":
      return [
        // Force a re-render for the “Error” status type, so that the animation plays again.
        statusToStatusType(model.status.tag) === "Error" ? { ...model } : model,
        // Send these commands regardless of current status: We want to prioritize the target
        // due to the focus no matter what, and after waking up on iOS we need to check the
        // Web Socket connection no matter what as well. For example, it’s possible to lock
        // the phone while Busy, and then we miss the “done” message, which makes us still
        // have the Busy status when unlocking the phone.
        [
          {
            tag: "SendMessage",
            message: { tag: "FocusedTab" },
            sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
          },
          {
            tag: "WebSocketTimeoutBegin",
          },
        ],
      ];

    case "PageVisibilityChangedToVisible":
      return reconnect(model, msg.date, { force: true });

    case "SleepBeforeReconnectDone":
      return reconnect(model, msg.date, { force: false });

    case "UiMsg":
      return onUiMsg(msg.date, msg.msg, model);

    case "WebSocketClosed": {
      const attemptNumber =
        "attemptNumber" in model.status ? model.status.attemptNumber + 1 : 1;
      return [
        {
          ...model,
          status: {
            tag: "SleepingBeforeReconnect",
            date: msg.date,
            attemptNumber,
          },
        },
        [{ tag: "SleepBeforeReconnect", attemptNumber }],
      ];
    }

    case "WebSocketConnected":
      return [{ ...model, status: { tag: "Busy", date: msg.date } }, []];

    case "WebSocketMessageReceived": {
      const result = parseWebSocketMessageData(msg.data);
      switch (result.tag) {
        case "Success":
          return onWebSocketToClientMessage(msg.date, result.message, model);

        case "Error":
          return [
            {
              ...model,
              status: {
                tag: "UnexpectedError",
                date: msg.date,
                message: result.message,
              },
              uiExpanded: true,
            },
            [],
          ];
      }
    }
  }
}

function onUiMsg(date: Date, msg: UiMsg, model: Model): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "ChangedBrowserUiPosition":
      return [
        {
          ...model,
          browserUiPosition: msg.browserUiPosition,
          lastBrowserUiPositionChangeDate: date,
        },
        [
          {
            tag: "SendMessage",
            message: {
              tag: "ChangedBrowserUiPosition",
              browserUiPosition: msg.browserUiPosition,
            },
            sendKey: msg.sendKey,
          },
        ],
      ];

    case "ChangedCompilationMode":
      return [
        {
          ...model,
          status: { tag: "Busy", date },
          compilationMode: msg.compilationMode,
        },
        [
          {
            tag: "SendMessage",
            message: {
              tag: "ChangedCompilationMode",
              compilationMode: msg.compilationMode,
            },
            sendKey: msg.sendKey,
          },
        ],
      ];

    case "PressedChevron":
      return [{ ...model, uiExpanded: !model.uiExpanded }, []];

    case "PressedReconnectNow":
      return reconnect(model, date, { force: true });
  }
}

function onWebSocketToClientMessage(
  date: Date,
  msg: WebSocketToClientMessage,
  model: Model
): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "FocusedTabAcknowledged":
      return [model, [{ tag: "WebSocketTimeoutClear" }]];

    case "StatusChanged":
      return statusChanged(date, msg, model);

    case "SuccessfullyCompiled": {
      const justChangedBrowserUiPosition =
        model.lastBrowserUiPositionChangeDate !== undefined &&
        date.getTime() - model.lastBrowserUiPositionChangeDate.getTime() <
          JUST_CHANGED_BROWSER_UI_POSITION_TIMEOUT;
      return msg.compilationMode !== ORIGINAL_COMPILATION_MODE
        ? [
            {
              ...model,
              status: {
                tag: "WaitingForReload",
                date,
                reasons:
                  ORIGINAL_COMPILATION_MODE === "proxy"
                    ? []
                    : [
                        `compilation mode changed from ${ORIGINAL_COMPILATION_MODE} to ${msg.compilationMode}.`,
                      ],
              },
              compilationMode: msg.compilationMode,
            },
            [],
          ]
        : [
            {
              ...model,
              compilationMode: msg.compilationMode,
              elmCompiledTimestamp: msg.elmCompiledTimestamp,
              browserUiPosition: msg.browserUiPosition,
              lastBrowserUiPositionChangeDate: undefined,
            },
            [
              { tag: "Eval", code: msg.code },
              // This isn’t strictly necessary, but has the side effect of
              // getting rid of the success animation.
              justChangedBrowserUiPosition
                ? {
                    tag: "SetBrowserUiPosition",
                    browserUiPosition: msg.browserUiPosition,
                  }
                : { tag: "NoCmd" },
            ],
          ];
    }

    case "SuccessfullyCompiledButRecordFieldsChanged":
      return [
        {
          ...model,
          status: {
            tag: "WaitingForReload",
            date,
            reasons: [
              `record field mangling in optimize mode was different than last time.`,
            ],
          },
        },
        [],
      ];
  }
}

function statusChanged(
  date: Date,
  { status }: StatusChanged,
  model: Model
): [Model, Array<Cmd>] {
  switch (status.tag) {
    case "AlreadyUpToDate":
      return [
        {
          ...model,
          status: {
            tag: "Idle",
            date,
            sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
          },
          compilationMode: status.compilationMode,
          browserUiPosition: status.browserUiPosition,
        },
        [
          {
            tag: "TriggerReachedIdleState",
            reason: "AlreadyUpToDate",
          },
        ],
      ];

    case "Busy":
      return [
        {
          ...model,
          status: {
            tag: "Busy",
            date,
          },
          compilationMode: status.compilationMode,
          browserUiPosition: status.browserUiPosition,
        },
        [],
      ];

    case "ClientError":
      return [
        {
          ...model,
          status: { tag: "UnexpectedError", date, message: status.message },
          uiExpanded: true,
        },
        [
          {
            tag: "TriggerReachedIdleState",
            reason: "ClientError",
          },
        ],
      ];

    case "CompileError":
      return [
        {
          ...model,
          status: {
            tag: "CompileError",
            date,
            sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
          },
          compilationMode: status.compilationMode,
          browserUiPosition: status.browserUiPosition,
        },
        [
          {
            tag: "TriggerReachedIdleState",
            reason: "CompileError",
          },
        ],
      ];
  }
}

function reconnect(
  model: Model,
  date: Date,
  { force }: { force: boolean }
): [Model, Array<Cmd>] {
  // We never clear reconnect `setTimeout`s. Instead, check that the required
  // amount of time has passed. This is needed since we have the “Reconnect now”
  // button.
  return model.status.tag === "SleepingBeforeReconnect" &&
    (date.getTime() - model.status.date.getTime() >=
      retryWaitMs(model.status.attemptNumber) ||
      force)
    ? [
        {
          ...model,
          status: {
            tag: "Connecting",
            date,
            attemptNumber: model.status.attemptNumber,
          },
        },
        [
          {
            tag: "Reconnect",
            elmCompiledTimestamp: model.elmCompiledTimestamp,
          },
        ],
      ]
    : [model, []];
}

function retryWaitMs(attemptNumber: number): number {
  // At least 1010 ms, at most 1 minute.
  return Math.min(1000 + 10 * attemptNumber ** 2, 1000 * 60);
}

function printRetryWaitMs(attemptNumber: number): string {
  return `${retryWaitMs(attemptNumber) / 1000} seconds`;
}

const runCmd =
  (getNow: GetNow, elements: Elements | undefined) =>
  (
    cmd: Cmd,
    mutable: Mutable,
    dispatch: (msg: Msg) => void,
    _resolvePromise: (result: undefined) => void,
    rejectPromise: (error: Error) => void
  ): void => {
    switch (cmd.tag) {
      case "Eval": {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const f = new Function(cmd.code);
        try {
          f();
          dispatch({ tag: "EvalSucceeded", date: getNow() });
        } catch (unknownError) {
          if (
            unknownError instanceof Error &&
            unknownError.message.startsWith("ELM_WATCH_RELOAD_NEEDED")
          ) {
            dispatch({
              tag: "EvalNeedsReload",
              date: getNow(),
              reasons: unknownError.message.split("\n\n---\n\n").slice(1),
            });
          } else {
            void Promise.reject(unknownError);
            dispatch({ tag: "EvalErrored", date: getNow() });
          }
        }
        return;
      }

      case "NoCmd":
        return;

      case "Reconnect":
        mutable.webSocket = initWebSocket(
          getNow,
          cmd.elmCompiledTimestamp,
          dispatch
        );
        return;

      case "Render": {
        const { model } = cmd;
        const info: Info = {
          version: VERSION,
          webSocketUrl: mutable.webSocket.url,
          targetName: TARGET_NAME,
          originalCompilationMode: ORIGINAL_COMPILATION_MODE,
          initializedElmAppsStatus: checkInitializedElmAppsStatus(),
        };
        if (elements === undefined) {
          if (model.status.tag !== model.previousStatusTag) {
            const isError = statusToStatusType(model.status.tag) === "Error";
            // eslint-disable-next-line no-console
            const consoleMethod = isError ? console.error : console.info;
            consoleMethod(renderWebWorker(model, info));
          }
        } else {
          const { targetRoot } = elements;
          render(getNow, targetRoot, dispatch, model, info, cmd.manageFocus);
        }
        return;
      }

      case "SendMessage": {
        const json = JSON.stringify(cmd.message);
        try {
          mutable.webSocket.send(json);
        } catch (error) {
          // According to MDN, `.send()` throws an exception if the web socket
          // is in the CONNECTING state. We’re not supposed to send messages
          // in that state in the first place, but just in case.
          // `JSON.stringify` is outside the `try` block in case it throws an
          // error – then we at least have a chance of noticing it.
          // eslint-disable-next-line no-console
          console.error("elm-watch: Failed to send Web Socket message:", error);
        }
        return;
      }

      case "SetBrowserUiPosition":
        if (elements !== undefined) {
          setBrowserUiPosition(cmd.browserUiPosition, elements);
        }
        return;

      case "SleepBeforeReconnect":
        setTimeout(() => {
          if (
            typeof document === "undefined" ||
            document.visibilityState === "visible"
          ) {
            dispatch({ tag: "SleepBeforeReconnectDone", date: getNow() });
          }
        }, retryWaitMs(cmd.attemptNumber));
        return;

      case "TriggerReachedIdleState":
        // Let the cmd queue be emptied first.
        Promise.resolve()
          .then(() => {
            __ELM_WATCH.ON_REACHED_IDLE_STATE(cmd.reason);
          })
          .catch(rejectPromise);
        return;

      case "UpdateGlobalStatus":
        __ELM_WATCH.RELOAD_STATUSES[TARGET_NAME] = cmd.reloadStatus;
        reloadPageIfNeeded();
        return;

      // On iOS, if you lock the phone and wait a couple of seconds, the Web
      // Socket disconnects (check the “web socket connections: X” counter in
      // the terminal). Same thing if you just go to the home screen.  When you
      // go back to the tab, I’ve ended up in a state where the Web Socket
      // appears connected, but you don’t receive any messages and when I tried
      // to switch compilation mode the server never got any message. Apparently
      // “broken connections” is a thing with Web Sockets and the way you detect
      // them is by sending a ping-pong pair with a timeout:
      // https://github.com/websockets/ws/tree/975382178f8a9355a5a564bb29cb1566889da9ba#how-to-detect-and-close-broken-connections
      // In our case, the window "focus" event occurs when returning to the page
      // after unlocking the phone, or switching from another tab or app, and we
      // already send a `FocusedTab` message then. That’s the perfect ping, and
      // `FocusedTabAcknowledged` is the pong.
      case "WebSocketTimeoutBegin":
        if (mutable.webSocketTimeoutId === undefined) {
          mutable.webSocketTimeoutId = setTimeout(() => {
            mutable.webSocketTimeoutId = undefined;
            // Sometimes, `mutable.webSocket.readyState` is `WebSocket.OPEN` and
            // sometimes it’s `WebSocket.CLOSED` when getting here (on iOS).
            // - OPEN: That’s not really true.
            // - CLOSED: We missed the "close" event (iOS didn’t give it to us).
            // Either way, `mutable.webSocket.close()` is safe to run even if
            // the Web Socket is already closed. Finally, on OPEN, the
            // `.close()` method seems to never trigger our "close" listener, so
            // always dispatch ourselves. It doesn’t matter if another dispatch
            // is made just after.
            mutable.webSocket.close();
            dispatch({
              tag: "WebSocketClosed",
              date: getNow(),
            });
          }, __ELM_WATCH.WEBSOCKET_TIMEOUT);
        }
        return;

      case "WebSocketTimeoutClear":
        if (mutable.webSocketTimeoutId !== undefined) {
          clearTimeout(mutable.webSocketTimeoutId);
          mutable.webSocketTimeoutId = undefined;
        }
        return;
    }
  };

type ParseWebSocketMessageDataResult =
  | {
      tag: "Error";
      message: string;
    }
  | {
      tag: "Success";
      message: WebSocketToClientMessage;
    };

function parseWebSocketMessageData(
  data: unknown
): ParseWebSocketMessageDataResult {
  try {
    return {
      tag: "Success",
      message: decodeWebSocketToClientMessage(Decode.string(data)),
    };
  } catch (unknownError) {
    return {
      tag: "Error",
      message: `Failed to decode web socket message sent from the server:\n${possiblyDecodeErrorToString(
        unknownError
      )}`,
    };
  }
}

function possiblyDecodeErrorToString(unknownError: unknown): string {
  return unknownError instanceof Decode.DecoderError
    ? unknownError.format()
    : unknownError instanceof Error
    ? unknownError.message
    : Decode.repr(unknownError);
}

function functionToNull(value: unknown): unknown {
  return typeof value === "function" ? null : value;
}

type ProgramType = ReturnType<typeof ProgramType>;
const ProgramType = Decode.stringUnion({
  "Platform.worker": null,
  "Browser.sandbox": null,
  "Browser.element": null,
  "Browser.document": null,
  "Browser.application": null,
  Html: null,
});

const ElmModule: Decode.Decoder<Array<ProgramType>> = Decode.chain(
  Decode.record(
    Decode.chain(
      functionToNull,
      Decode.multi({
        null: () => [],
        array: Decode.array(
          Decode.fields((field) => field("__elmWatchProgramType", ProgramType))
        ),
        object: (value) => ElmModule(value),
      })
    )
  ),
  (record) => Object.values(record).flat()
);

const ProgramTypes = Decode.fields((field) => field("Elm", ElmModule));

function checkInitializedElmAppsStatus(): InitializedElmAppsStatus {
  // If this target is a proxy, or if another one is, it’s not safe to touch
  // `window.Elm` since it can throw errors by design, but not errors that
  // we want to show with a different icon. In this case, we don’t know if
  // it will be possible to switch to debug mode, so don’t allow that yet.
  if (window.Elm !== undefined && "__elmWatchProxy" in window.Elm) {
    return {
      tag: "DebuggerModeStatus",
      status: {
        tag: "Disabled",
        reason: noDebuggerYetReason,
      },
    };
  }

  if (window.Elm === undefined) {
    return { tag: "MissingWindowElm" };
  }

  let programTypes;
  try {
    programTypes = ProgramTypes(window);
  } catch (unknownError) {
    return {
      tag: "DecodeError",
      message: possiblyDecodeErrorToString(unknownError),
    };
  }

  if (programTypes.length === 0) {
    return { tag: "NoProgramsAtAll" };
  }

  const noDebugger = programTypes.filter((programType) => {
    switch (programType) {
      case "Platform.worker":
      case "Html":
        return true;
      case "Browser.sandbox":
      case "Browser.element":
      case "Browser.document":
      case "Browser.application":
        return false;
    }
  });

  // If we have _only_ programs that don’t support the debugger we know for sure
  // that we cannot enable it. Most likely there’s just one single program on
  // the page, and that’s where this is the most helpful anyway.
  return {
    tag: "DebuggerModeStatus",
    status:
      noDebugger.length === programTypes.length
        ? {
            tag: "Disabled",
            reason: noDebuggerReason(new Set(noDebugger)),
          }
        : { tag: "Enabled" },
  };
}

function reloadPageIfNeeded(): void {
  let shouldReload = false;
  const reasons: Array<[string, Array<string>]> = [];

  for (const [targetName, reloadStatus] of Object.entries(
    __ELM_WATCH.RELOAD_STATUSES
  )) {
    switch (reloadStatus.tag) {
      case "MightWantToReload":
        return;
      case "NoReloadWanted":
        break;
      case "ReloadRequested":
        shouldReload = true;
        if (reloadStatus.reasons.length > 0) {
          reasons.push([targetName, reloadStatus.reasons]);
        }
        break;
    }
  }

  if (!shouldReload) {
    return;
  }

  const first = reasons[0];
  const [separator, reasonString] =
    reasons.length === 1 && first !== undefined && first[1].length === 1
      ? [" ", `${first[1].join("")}\n(target: ${first[0]})`]
      : [
          ":\n\n",
          reasons
            .map(([targetName, subReasons]) =>
              [
                targetName,
                ...subReasons.map((subReason) => `- ${subReason}`),
              ].join("\n")
            )
            .join("\n\n"),
        ];
  const message =
    reasons.length === 0
      ? undefined
      : `elm-watch: I did a full page reload because${separator}${reasonString}`;
  __ELM_WATCH.RELOAD_STATUSES = {};
  __ELM_WATCH.RELOAD_PAGE(message);
}

function h<T extends HTMLElement>(
  t: new () => T,
  {
    attrs,
    style,
    localName,
    ...props
  }: Partial<
    Omit<T, "style"> & {
      attrs: Record<string, string>;
      style: Partial<CSSStyleDeclaration>;
    }
  >,
  ...children: Array<HTMLElement | string | undefined>
): T {
  const element = document.createElement(
    localName ??
      t.name
        .replace(/^HTML(\w+)Element$/, "$1")
        .replace("Anchor", "a")
        .replace("Paragraph", "p")
        .replace(/^([DOU])List$/, "$1l")
        .toLowerCase()
  ) as T;

  Object.assign(element, props);

  if (attrs !== undefined) {
    for (const [key, value] of Object.entries(attrs)) {
      element.setAttribute(key, value);
    }
  }

  if (style !== undefined) {
    for (const [key, value] of Object.entries(style)) {
      (element.style as unknown as Record<string, string>)[key] = value;
    }
  }

  for (const child of children) {
    if (child !== undefined) {
      element.append(
        typeof child === "string" ? document.createTextNode(child) : child
      );
    }
  }

  return element;
}

type Info = {
  version: string;
  webSocketUrl: string;
  targetName: string;
  originalCompilationMode: CompilationModeWithProxy;
  initializedElmAppsStatus: InitializedElmAppsStatus;
};

function renderWebWorker(model: Model, info: Info): string {
  const statusData = statusIconAndText(model.status, info);
  return `${statusData.icon} elm-watch: ${statusData.status} ${formatTime(
    model.status.date
  )} (${info.targetName})`;
}

function render(
  getNow: GetNow,
  targetRoot: HTMLElement,
  dispatch: (msg: Msg) => void,
  model: Model,
  info: Info,
  manageFocus: boolean
): void {
  targetRoot.replaceChildren(
    view(
      (msg) => {
        dispatch({ tag: "UiMsg", date: getNow(), msg });
      },
      model,
      info,
      manageFocus
    )
  );

  const firstFocusableElement = targetRoot.querySelector(`button, [tabindex]`);
  if (manageFocus && firstFocusableElement instanceof HTMLElement) {
    firstFocusableElement.focus();
  }

  __ELM_WATCH.ON_RENDER(TARGET_NAME);
}

const CLASS = {
  browserUiPositionButton: "browserUiPositionButton",
  browserUiPositionChooser: "browserUiPositionChooser",
  chevronButton: "chevronButton",
  compilationModeWithIcon: "compilationModeWithIcon",
  container: "container",
  debugModeIcon: "debugModeIcon",
  expandedUiContainer: "expandedUiContainer",
  flashError: "flashError",
  flashSuccess: "flashSuccess",
  root: "root",
  rootBottomHalf: "rootBottomHalf",
  shortStatusContainer: "shortStatusContainer",
  targetName: "targetName",
  targetRoot: "targetRoot",
};

function getStatusClass({
  statusType,
  statusTypeChanged,
  hasReceivedHotReload,
  uiRelatedUpdate,
}: {
  statusType: StatusType;
  statusTypeChanged: boolean;
  hasReceivedHotReload: boolean;
  uiRelatedUpdate: boolean;
}): string | undefined {
  switch (statusType) {
    case "Success":
      return statusTypeChanged && hasReceivedHotReload
        ? CLASS.flashSuccess
        : undefined;
    case "Error":
      return uiRelatedUpdate ? undefined : CLASS.flashError;
    case "Waiting":
      return undefined;
  }
}

const CSS = `
pre {
  margin: 0;
  white-space: pre-wrap;
  border-left: 0.25em solid var(--grey);
  padding-left: 0.5em;
}

input,
button,
select,
textarea {
  font-family: inherit;
  font-size: inherit;
  font-weight: inherit;
  letter-spacing: inherit;
  line-height: inherit;
  color: inherit;
  margin: 0;
}

fieldset {
  display: grid;
  gap: 0.25em;
  margin: 0;
  border: 1px solid var(--grey);
  padding: 0.25em 0.75em 0.5em;
}

fieldset:disabled {
  color: var(--grey);
}

p,
dd {
  margin: 0;
}

dl {
  display: grid;
  grid-template-columns: auto auto;
  gap: 0.25em 1em;
  margin: 0;
  white-space: nowrap;
}

dt {
  text-align: right;
  color: var(--grey);
}

time {
  display: inline-grid;
  overflow: hidden;
}

time::after {
  content: attr(data-format);
  visibility: hidden;
  height: 0;
}

.${CLASS.root} {
  --grey: #767676;
  display: flex;
  align-items: start;
  overflow: auto;
  max-height: 100vh;
  max-width: 100vw;
  color: black;
  font-family: system-ui;
}

.${CLASS.rootBottomHalf} {
  align-items: end;
}

.${CLASS.targetRoot} + .${CLASS.targetRoot} {
  margin-left: -1px;
}

.${CLASS.targetRoot}:only-of-type .${CLASS.debugModeIcon},
.${CLASS.targetRoot}:only-of-type .${CLASS.targetName} {
  display: none;
}

.${CLASS.container} {
  display: flex;
  flex-direction: column-reverse;
  background-color: white;
  border: 1px solid var(--grey);
}

.${CLASS.rootBottomHalf} .${CLASS.container} {
  flex-direction: column;
}

.${CLASS.expandedUiContainer} {
  padding: 1em;
  padding-top: 0.75em;
  display: grid;
  gap: 0.75em;
  outline: none;
  contain: paint;
}

.${CLASS.rootBottomHalf} .${CLASS.expandedUiContainer} {
  padding-bottom: 0.75em;
}

.${CLASS.expandedUiContainer}:is(.length0, .length1) {
  grid-template-columns: min-content;
}

.${CLASS.expandedUiContainer} > dl {
  justify-self: start;
}

.${CLASS.expandedUiContainer} label {
  display: grid;
  grid-template-columns: min-content auto;
  align-items: center;
  gap: 0.25em;
}

.${CLASS.expandedUiContainer} label.Disabled {
  color: var(--grey);
}

.${CLASS.expandedUiContainer} label > small {
  grid-column: 2;
}

.${CLASS.compilationModeWithIcon} {
  display: flex;
  align-items: center;
  gap: 0.25em;
}

.${CLASS.browserUiPositionChooser} {
  position: absolute;
  display: grid;
  grid-template-columns: min-content min-content;
  pointer-events: none;
}

.${CLASS.browserUiPositionButton} {
  appearance: none;
  padding: 0;
  border: none;
  background: none;
  border-radius: none;
  pointer-events: auto;
  width: 1em;
  height: 1em;
  text-align: center;
  line-height: 1em;
}

.${CLASS.browserUiPositionButton}:hover {
  background-color: rgba(0, 0, 0, 0.25);
}

.${CLASS.targetRoot}:not(:first-child) .${CLASS.browserUiPositionChooser} {
  display: none;
}

.${CLASS.shortStatusContainer} {
  line-height: 1;
  padding: 0.25em;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 0.25em;
}

.${CLASS.flashError}::before,
.${CLASS.flashSuccess}::before {
  content: "";
  position: absolute;
  margin-top: 0.5em;
  margin-left: 0.5em;
  --size: min(500px, 100vmin);
  width: var(--size);
  height: var(--size);
  border-radius: 50%;
  animation: flash 0.7s 0.05s ease-out both;
  pointer-events: none;
}

.${CLASS.flashError}::before {
  background-color: #eb0000;
}

.${CLASS.flashSuccess}::before {
  background-color: #00b600;
}

@keyframes flash {
  from {
    transform: translate(-50%, -50%) scale(0);
    opacity: 0.9;
  }

  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0;
  }
}

@keyframes nudge {
  from {
    opacity: 0;
  }

  to {
    opacity: 0.8;
  }
}

@media (prefers-reduced-motion: reduce) {
  .${CLASS.flashError}::before,
  .${CLASS.flashSuccess}::before {
    transform: translate(-50%, -50%);
    width: 2em;
    height: 2em;
    animation: nudge 0.25s ease-in-out 4 alternate forwards;
  }
}

.${CLASS.chevronButton} {
  appearance: none;
  border: none;
  border-radius: 0;
  background: none;
  padding: 0;
  cursor: pointer;
}
`;

function view(
  dispatch: (msg: UiMsg) => void,
  passedModel: Model,
  info: Info,
  manageFocus: boolean
): HTMLElement {
  const model: Model = __ELM_WATCH.MOCKED_TIMINGS
    ? {
        ...passedModel,
        status: {
          ...passedModel.status,
          date: new Date("2022-02-05T13:10:05Z"),
        },
      }
    : passedModel;

  const statusData: StatusData = {
    ...statusIconAndText(model.status, info),
    ...viewStatus(dispatch, model.status, model.compilationMode, info),
  };

  const statusType = statusToStatusType(model.status.tag);
  const statusTypeChanged =
    statusType !== statusToStatusType(model.previousStatusTag);

  const statusClass = getStatusClass({
    statusType,
    statusTypeChanged,
    hasReceivedHotReload:
      model.elmCompiledTimestamp !== INITIAL_ELM_COMPILED_TIMESTAMP,
    uiRelatedUpdate: manageFocus,
  });

  return h(
    HTMLDivElement,
    { className: CLASS.container },
    model.uiExpanded
      ? viewExpandedUi(
          model.status,
          statusData,
          info,
          model.browserUiPosition,
          dispatch
        )
      : undefined,
    h(
      HTMLDivElement,
      {
        className: CLASS.shortStatusContainer,
        // Placed on the span to increase clickable area.
        onclick: () => {
          dispatch({ tag: "PressedChevron" });
        },
      },
      h(
        HTMLButtonElement,
        {
          className: CLASS.chevronButton,
          attrs: { "aria-expanded": model.uiExpanded.toString() },
        },
        icon(
          model.uiExpanded ? "▲" : "▼",
          model.uiExpanded ? "Collapse elm-watch" : "Expand elm-watch"
        )
      ),
      compilationModeIcon(model.compilationMode),
      icon(
        statusData.icon,
        statusData.status,
        statusClass === undefined
          ? {}
          : {
              className: statusClass,
              onanimationend: (event) => {
                // The animations are designed to work even without this (they
                // stay on the last frame). We also have `pointer-events: none`.
                // But remove the absolutely positioned animation element just
                // in case.
                if (event.currentTarget instanceof HTMLElement) {
                  event.currentTarget.classList.remove(statusClass);
                }
              },
            }
      ),
      h(
        HTMLTimeElement,
        { dateTime: model.status.date.toISOString() },
        formatTime(model.status.date)
      ),
      h(HTMLSpanElement, { className: CLASS.targetName }, TARGET_NAME)
    )
  );
}

function icon(
  emoji: string,
  alt: string,
  props?: Partial<HTMLSpanElement>
): HTMLElement {
  return h(
    HTMLSpanElement,
    { attrs: { "aria-label": alt }, ...props },
    h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, emoji)
  );
}

function viewExpandedUi(
  status: Status,
  statusData: StatusData,
  info: Info,
  browserUiPosition: BrowserUiPosition,
  dispatch: (msg: UiMsg) => void
): HTMLElement {
  const items: Array<[string, HTMLElement | string]> = [
    ["target", info.targetName],
    ["elm-watch", info.version],
    ["web socket", printWebSocketUrl(info.webSocketUrl)],
    [
      "updated",
      h(
        HTMLTimeElement,
        {
          dateTime: status.date.toISOString(),
          attrs: { "data-format": "2044-04-30 04:44:44" },
        },
        `${formatDate(status.date)} ${formatTime(status.date)}`
      ),
    ],
    ["status", statusData.status],
    ...statusData.dl,
  ];

  const browserUiPositionSendKey = statusToBrowserUiPositionSendKey(status);

  return h(
    HTMLDivElement,
    {
      className: `${CLASS.expandedUiContainer} length${statusData.content.length}`,
      attrs: {
        // Using the attribute instead of the property so that it can be
        // selected with `querySelector`.
        tabindex: "-1",
      },
    },
    h(
      HTMLDListElement,
      {},
      ...items.flatMap(([key, value]) => [
        h(HTMLElement, { localName: "dt" }, key),
        h(HTMLElement, { localName: "dd" }, value),
      ])
    ),
    ...statusData.content,
    browserUiPositionSendKey === undefined
      ? undefined
      : viewBrowserUiPositionChooser(
          browserUiPosition,
          dispatch,
          browserUiPositionSendKey
        )
  );
}

const allBrowserUiPositionsInOrder: Array<BrowserUiPosition> = [
  "TopLeft",
  "TopRight",
  "BottomLeft",
  "BottomRight",
];

function viewBrowserUiPositionChooser(
  currentPosition: BrowserUiPosition,
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey
): HTMLElement {
  const arrows = getBrowserUiPositionArrows(currentPosition);
  return h(
    HTMLDivElement,
    {
      className: CLASS.browserUiPositionChooser,
      style: browserUiPositionToCssForChooser(currentPosition),
    },
    ...allBrowserUiPositionsInOrder.map((position) => {
      const arrow = arrows[position];
      return arrow === undefined
        ? h(HTMLDivElement, { style: { visibility: "hidden" } }, "·")
        : h(
            HTMLButtonElement,
            {
              className: CLASS.browserUiPositionButton,
              attrs: { "data-position": position },
              onclick: () => {
                dispatch({
                  tag: "ChangedBrowserUiPosition",
                  browserUiPosition: position,
                  sendKey,
                });
              },
            },
            arrow
          );
    })
  );
}

const ARROW_UP = "↑";
const ARROW_DOWN = "↓";
const ARROW_LEFT = "←";
const ARROW_RIGHT = "→";
const ARROW_UP_LEFT = "↖";
const ARROW_UP_RIGHT = "↗";
const ARROW_DOWN_LEFT = "↙";
const ARROW_DOWN_RIGHT = "↘";

function getBrowserUiPositionArrows(browserUiPosition: BrowserUiPosition): {
  [key in BrowserUiPosition]: string | undefined;
} {
  switch (browserUiPosition) {
    case "TopLeft":
      return {
        TopLeft: undefined,
        TopRight: ARROW_RIGHT,
        BottomLeft: ARROW_DOWN,
        BottomRight: ARROW_DOWN_RIGHT,
      };

    case "TopRight":
      return {
        TopLeft: ARROW_LEFT,
        TopRight: undefined,
        BottomLeft: ARROW_DOWN_LEFT,
        BottomRight: ARROW_DOWN,
      };

    case "BottomLeft":
      return {
        TopLeft: ARROW_UP,
        TopRight: ARROW_UP_RIGHT,
        BottomLeft: undefined,
        BottomRight: ARROW_RIGHT,
      };

    case "BottomRight":
      return {
        TopLeft: ARROW_UP_LEFT,
        TopRight: ARROW_UP,
        BottomLeft: ARROW_LEFT,
        BottomRight: undefined,
      };
  }
}

type StatusData = {
  icon: string;
  status: string;
  dl: Array<[string, string]>;
  content: Array<HTMLElement>;
};

function statusIconAndText(
  status: Status,
  info: Info
): Pick<StatusData, "icon" | "status"> {
  switch (status.tag) {
    case "Busy":
      return {
        icon: "⏳",
        status: "Waiting for compilation",
      };

    case "CompileError":
      return {
        icon: "🚨",
        status: "Compilation error",
      };

    case "Connecting":
      return {
        icon: "🔌",
        status: "Connecting",
      };

    case "EvalError":
      return {
        icon: "⛔️",
        status: "Eval error",
      };

    case "Idle":
      return {
        icon: idleIcon(info.initializedElmAppsStatus),
        status: "Successfully compiled",
      };

    case "SleepingBeforeReconnect":
      return {
        icon: "🔌",
        status: "Sleeping",
      };

    case "UnexpectedError":
      return {
        icon: "❌",
        status: "Unexpected error",
      };

    case "WaitingForReload":
      return {
        icon: "⏳",
        status: "Waiting for reload",
      };
  }
}

function viewStatus(
  dispatch: (msg: UiMsg) => void,
  status: Status,
  compilationMode: CompilationModeWithProxy,
  info: Info
): Pick<StatusData, "content" | "dl"> {
  switch (status.tag) {
    case "Busy":
      return {
        dl: [],
        content: viewCompilationModeChooser({
          dispatch,
          sendKey: undefined,
          compilationMode,
          // Avoid the warning flashing by when switching modes (which is usually very fast).
          warnAboutCompilationModeMismatch: false,
          info,
        }),
      };

    case "CompileError":
      return {
        dl: [],
        content: [
          ...viewCompilationModeChooser({
            dispatch,
            sendKey: status.sendKey,
            compilationMode,
            warnAboutCompilationModeMismatch: true,
            info,
          }),
          h(
            HTMLParagraphElement,
            {},
            h(
              HTMLElement,
              { localName: "strong" },
              "Check the terminal to see errors!"
            )
          ),
        ],
      };

    case "Connecting":
      return {
        dl: [
          ["attempt", status.attemptNumber.toString()],
          ["sleep", printRetryWaitMs(status.attemptNumber)],
        ],
        content: [
          h(HTMLButtonElement, { disabled: true }, "Connecting web socket…"),
        ],
      };

    case "EvalError":
      return {
        dl: [],
        content: [
          h(
            HTMLParagraphElement,
            {},
            "Check the console in the browser developer tools to see errors!"
          ),
        ],
      };

    case "Idle":
      return {
        dl: [],
        content: viewCompilationModeChooser({
          dispatch,
          sendKey: status.sendKey,
          compilationMode,
          warnAboutCompilationModeMismatch: true,
          info,
        }),
      };

    case "SleepingBeforeReconnect":
      return {
        dl: [
          ["attempt", status.attemptNumber.toString()],
          ["sleep", printRetryWaitMs(status.attemptNumber)],
        ],
        content: [
          h(
            HTMLButtonElement,
            {
              onclick: () => {
                dispatch({ tag: "PressedReconnectNow" });
              },
            },
            "Reconnect web socket now"
          ),
        ],
      };

    case "UnexpectedError":
      return {
        dl: [],
        content: [
          h(
            HTMLParagraphElement,
            {},
            "I ran into an unexpected error! This is the error message:"
          ),
          h(HTMLPreElement, {}, status.message),
        ],
      };

    case "WaitingForReload":
      return {
        dl: [],
        content: [
          h(
            HTMLParagraphElement,
            {},
            "Waiting for other targets to finish compiling…"
          ),
        ],
      };
  }
}

function idleIcon(status: InitializedElmAppsStatus): string {
  switch (status.tag) {
    case "DecodeError":
    case "MissingWindowElm":
      return "❌";

    case "NoProgramsAtAll":
      return "❓";

    case "DebuggerModeStatus":
      return "✅";
  }
}

function compilationModeIcon(
  compilationMode: CompilationModeWithProxy
): HTMLElement | undefined {
  switch (compilationMode) {
    case "proxy":
      return undefined;
    case "debug":
      return icon("🐛", "Debug mode", { className: CLASS.debugModeIcon });
    case "standard":
      return undefined;
    case "optimize":
      return icon("🚀", "Optimize mode");
  }
}

function printWebSocketUrl(webSocketUrl: string): string {
  const url = new URL(webSocketUrl);
  const hostname = url.hostname.endsWith(".localhost")
    ? "localhost"
    : url.hostname;
  return `${url.protocol}//${hostname}:${url.port}`;
}

type CompilationModeOption = {
  mode: CompilationMode;
  name: string;
  status: Toggled;
};

type InitializedElmAppsStatus =
  | {
      tag: "DebuggerModeStatus";
      status: Toggled;
    }
  | {
      tag: "DecodeError";
      message: string;
    }
  | {
      tag: "MissingWindowElm";
    }
  | {
      tag: "NoProgramsAtAll";
    };

type Toggled =
  | {
      tag: "Disabled";
      reason: string;
    }
  | {
      tag: "Enabled";
    };

const noDebuggerYetReason = "The Elm debugger isn't available at this point.";

function noDebuggerReason(noDebuggerProgramTypes: Set<ProgramType>): string {
  return `The Elm debugger isn't supported by ${humanList(
    Array.from(noDebuggerProgramTypes, (programType) => `\`${programType}\``),
    "and"
  )} programs.`;
}

function humanList(list: Array<string>, joinWord: string): string {
  const { length } = list;
  return length <= 1
    ? list.join("")
    : length === 2
    ? list.join(` ${joinWord} `)
    : `${list.slice(0, length - 2).join(", ")}, ${list
        .slice(-2)
        .join(` ${joinWord} `)}`;
}

function viewCompilationModeChooser({
  dispatch,
  sendKey,
  compilationMode: selectedMode,
  warnAboutCompilationModeMismatch,
  info,
}: {
  dispatch: (msg: UiMsg) => void;
  sendKey: SendKey | undefined;
  compilationMode: CompilationModeWithProxy;
  warnAboutCompilationModeMismatch: boolean;
  info: Info;
}): Array<HTMLElement> {
  switch (info.initializedElmAppsStatus.tag) {
    case "DecodeError":
      return [
        h(
          HTMLParagraphElement,
          {},
          "window.Elm does not look like expected! This is the error message:"
        ),
        h(HTMLPreElement, {}, info.initializedElmAppsStatus.message),
      ];

    case "MissingWindowElm":
      return [
        h(
          HTMLParagraphElement,
          {},
          "elm-watch requires ",
          h(
            HTMLAnchorElement,
            {
              href: "https://github.com/lydell/elm-watch#windowelm",
              target: "_blank",
              rel: "noreferrer",
            },
            "window.Elm"
          ),
          " to exist, but it is undefined!"
        ),
      ];

    case "NoProgramsAtAll":
      return [
        h(
          HTMLParagraphElement,
          {},
          "It looks like no Elm apps were initialized by elm-watch. Check the console in the browser developer tools to see potential errors!"
        ),
      ];

    case "DebuggerModeStatus": {
      const compilationModes: Array<CompilationModeOption> = [
        {
          mode: "debug",
          name: "Debug",
          status: info.initializedElmAppsStatus.status,
        },
        { mode: "standard", name: "Standard", status: { tag: "Enabled" } },
        { mode: "optimize", name: "Optimize", status: { tag: "Enabled" } },
      ];

      return [
        h(
          HTMLFieldSetElement,
          { disabled: sendKey === undefined },
          h(HTMLLegendElement, {}, "Compilation mode"),
          ...compilationModes.map(({ mode, name, status }) => {
            const nameWithIcon = h(
              HTMLSpanElement,
              { className: CLASS.compilationModeWithIcon },
              name,
              mode === selectedMode ? compilationModeIcon(mode) : undefined
            );

            return h(
              HTMLLabelElement,
              { className: status.tag },
              h(HTMLInputElement, {
                type: "radio",
                name: `CompilationMode-${info.targetName}`,
                value: mode,
                checked: mode === selectedMode,
                disabled: sendKey === undefined || status.tag === "Disabled",
                onchange:
                  sendKey === undefined
                    ? undefined
                    : () => {
                        dispatch({
                          tag: "ChangedCompilationMode",
                          compilationMode: mode,
                          sendKey,
                        });
                      },
              }),
              ...(status.tag === "Enabled"
                ? [
                    nameWithIcon,
                    warnAboutCompilationModeMismatch &&
                    mode === selectedMode &&
                    selectedMode !== info.originalCompilationMode &&
                    info.originalCompilationMode !== "proxy"
                      ? h(
                          HTMLElement,
                          { localName: "small" },
                          `Note: The code currently running is in ${ORIGINAL_COMPILATION_MODE} mode.`
                        )
                      : undefined,
                  ]
                : [
                    nameWithIcon,
                    h(HTMLElement, { localName: "small" }, status.reason),
                  ])
            );
          })
        ),
      ];
    }
  }
}

function renderMockStatuses(
  getNow: GetNow,
  elements: Elements | undefined
): void {
  if (elements === undefined) {
    return;
  }

  const date = getNow();

  const info: Omit<Info, "targetName"> = {
    version: VERSION,
    webSocketUrl: "ws://localhost:53167",
    originalCompilationMode: "standard",
    initializedElmAppsStatus: {
      tag: "DebuggerModeStatus",
      status: { tag: "Enabled" },
    },
  };

  const mockStatuses: Record<
    string,
    Status & {
      info?: Omit<Info, "targetName">;
      compilationMode?: CompilationMode;
    }
  > = {
    Busy: {
      tag: "Busy",
      date,
    },
    Idle: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
    },
    "Really long target name that is annoying to work display correctly": {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
    },
    LongSubdomain: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        webSocketUrl: "ws://development.admin.example.com.localhost:53167",
      },
    },
    IPAdress: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        webSocketUrl: "ws://192.168.123.123:53167",
      },
    },
    NoDebuggerYetWithDebugLogOptimizeError: {
      tag: "CompileError",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        originalCompilationMode: "standard",
        initializedElmAppsStatus: {
          tag: "DebuggerModeStatus",
          status: {
            tag: "Disabled",
            reason: noDebuggerYetReason,
          },
        },
      },
      compilationMode: "optimize",
    },
    DisabledDebugger1: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        initializedElmAppsStatus: {
          tag: "DebuggerModeStatus",
          status: {
            tag: "Disabled",
            reason: noDebuggerReason(new Set(["Html"])),
          },
        },
      },
    },
    DisabledDebugger2: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        initializedElmAppsStatus: {
          tag: "DebuggerModeStatus",
          status: {
            tag: "Disabled",
            reason: noDebuggerReason(new Set(["Html", "Platform.worker"])),
          },
        },
      },
    },
    NoElmApps: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        initializedElmAppsStatus: {
          tag: "NoProgramsAtAll",
        },
      },
    },
    WindowElmDecodeError: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        initializedElmAppsStatus: {
          tag: "DecodeError",
          message: new Decode.DecoderError({
            tag: "object",
            got: 5,
            key: "Main",
          }).format(),
        },
      },
    },
    CompileError: {
      tag: "CompileError",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
    },
    Connecting: {
      tag: "Connecting",
      date,
      attemptNumber: 1,
    },
    Connecting2: {
      tag: "Connecting",
      date,
      attemptNumber: 2,
    },
    Connecting100: {
      tag: "Connecting",
      date,
      attemptNumber: 100,
    },
    EvalError: {
      tag: "EvalError",
      date,
    },
    SleepingBeforeReconnect: {
      tag: "SleepingBeforeReconnect",
      date,
      attemptNumber: 1,
    },
    UnexpectedError: {
      tag: "UnexpectedError",
      message: `
The compiled JavaScript code running in the browser says it was compiled with:

elm-watch 1.0.0

But the server is:

elm-watch 1.0.1

Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
      `.trim(),
      date,
    },
    WaitingForReload: {
      tag: "WaitingForReload",
      date,
      reasons: [],
    },
  };

  for (const [targetName, status] of Object.entries(mockStatuses)) {
    const targetRoot = createTargetRoot(targetName);
    elements.root.append(targetRoot);
    const model: Model = {
      status,
      previousStatusTag: status.tag,
      compilationMode: status.compilationMode ?? "standard",
      browserUiPosition: "BottomLeft",
      lastBrowserUiPositionChangeDate: undefined,
      elmCompiledTimestamp: 0,
      uiExpanded: true,
    };
    render(
      getNow,
      targetRoot,
      () => {
        // Ignore messages.
      },
      model,
      { ...(status.info ?? info), targetName },
      false
    );
  }
}

void renderMockStatuses;

run();
