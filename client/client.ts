import * as Codec from "tiny-decoders";

import type { ClientConfig } from "../src/ClientConfig.ts";
import { formatTime } from "../src/Helpers.ts";
import { runTeaProgram } from "../src/TeaProgram.ts";
import type { CompilationMode, GetNow } from "../src/Types.ts";
import { reloadAllCssIfNeeded, runSerially, type SerialState } from "./css.ts";
import {
  createUi,
  type FlashType,
  type Info,
  type OverlayError,
  retryWaitMs,
  SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
  type SendKey,
  type Status,
  statusIconAndText,
  type TargetSnapshot,
  type Toggled,
  type Ui,
  type UiTarget,
} from "./Ui.ts";
import * as Update from "./Update.ts";
import {
  type Cmd,
  getErrors,
  type Model,
  type Msg,
  type ProgramType,
  type ReachedIdleStateReason,
  type ReloadReason,
  type ReloadReasonWithModuleName,
  type ReloadStatus,
  unknownErrorToString,
  type UpdateConfig,
} from "./Update.ts";
import { WebSocketToServerMessage } from "./WebSocketMessages.ts";

// Support environments, such as Web Workers, where `window` does not exist.
const window = globalThis as unknown as Window;

// oxlint-disable-next-line typescript/no-unnecessary-condition
const HAS_WINDOW = window.window !== undefined;

// These used to be separate properties on `window`, like
// `window.__ELM_WATCH_MOCKED_TIMINGS`. It’s better to group them all together
// to avoid “polluting” `window` when using the browser console.
type __ELM_WATCH = {
  MOCKED_TIMINGS: boolean;
  WEBSOCKET_TIMEOUT: number;
  CHANGED_CSS: Date;
  CHANGED_FILE_URL_PATHS: { timestamp: Date; changed: Set<string> };
  ORIGINAL_STYLES: WeakMap<CSSStyleRule, string>;
  CSS_RELOAD: SerialState<boolean>;
  RELOAD_STATUSES: Map</* targetName */ string, ReloadStatus>;
  RELOAD_PAGE: (message: string | undefined) => void;
  TARGET_DATA: Map</* targetName */ string, TargetData>;
  SOME_TARGET_IS_PROXY: boolean;
  IS_REGISTERING: boolean;
  REGISTER: (
    targetName: string,
    elmExports: ElmExports,
    schedulerEnqueue: unknown,
  ) => void;
  HOT_RELOAD: (
    targetName: string,
    elmExports: ElmExports,
    setSchedulerEnqueue: (schedulerEnqueue: unknown) => void,
  ) => void;
  SHOULD_SKIP_INIT_CMDS: (targetName: string) => boolean;
  ON_RENDER: (targetName: string) => void;
  ON_REACHED_IDLE_STATE: (reason: ReachedIdleStateReason) => void;
  KILL_MATCHING: (targetName: RegExp) => Promise<void>;
  DISCONNECT: (targetName: RegExp) => void;
  LOG_DEBUG: typeof console.debug;
  // The version number is explained in Ui.ts.
  UI_V1: Ui | undefined;
};

type TargetData = {
  originalFlattenedElmExports: Map</* moduleName */ string, ElmModule>;
  initializedElmApps: Map</* moduleName */ string, Array<ElmApp>>;
  // `_Scheduler_enqueue` from the original script. See `_Platform_export` in `Inject.ts`.
  originalSchedulerEnqueue: unknown;
};

declare global {
  // oxlint-disable-next-line typescript/consistent-type-definitions
  interface Window {
    Elm?: ElmExports;
    ELM_WATCH_FULL_RELOAD?: () => void;
    __ELM_WATCH: __ELM_WATCH;
  }
}

type ElmExports = Record<`${UppercaseLetter}${string}`, ElmModule>;

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
  init: (options?: { node?: Element; flags?: unknown }) => ElmApp;
  [key: `${UppercaseLetter}${string}`]: ElmModule;
};

type ElmWatchReturnDataInit = (
  arg: "__elmWatchReturnData",
) => ElmWatchReturnData;

type ElmApp = {
  ports?: Record<
    string,
    { subscribe?: (value: unknown) => void; send?: (value: unknown) => void }
  >;
  __elmWatchHotReload: (
    elmWatchReturnData: ElmWatchReturnData,
  ) => Array<ReloadReason>;
  __elmWatchRunInitCmds: () => void;
  __elmWatchProgramType: ProgramType;
};

type ElmWatchReturnData = {
  programType: ProgramType;
  moreData: never;
};

const RELOAD_MESSAGE_KEY = "__elmWatchReloadMessage";
const RELOAD_TARGET_NAME_KEY_PREFIX = "__elmWatchReloadTarget__";

const DEFAULT_ELM_WATCH: __ELM_WATCH = {
  MOCKED_TIMINGS: false,

  // In a browser on the same computer, sending a message and receiving a reply
  // takes around 2-4 ms. In iOS Safari via WiFi, I’ve seen it take up to 120 ms.
  // So 1 second should be plenty above the threshold, while not taking too long.
  WEBSOCKET_TIMEOUT: 1000,

  ON_RENDER: () => {
    // Do nothing.
  },

  ON_REACHED_IDLE_STATE: () => {
    // Do nothing.
  },

  CHANGED_CSS: new Date(0),

  CHANGED_FILE_URL_PATHS: { timestamp: new Date(0), changed: new Set() },

  ORIGINAL_STYLES: new WeakMap(),

  CSS_RELOAD: { running: undefined, queued: undefined },

  RELOAD_STATUSES: new Map(),

  RELOAD_PAGE: (message) => {
    if (message !== undefined) {
      try {
        window.sessionStorage.setItem(RELOAD_MESSAGE_KEY, message);
      } catch {
        // Ignore failing to write to sessionStorage.
      }
    }
    // Allow customizing how to “reload the page”, for Web Workers and Node.js
    // (or in the browser if you really want to).
    if (typeof window.ELM_WATCH_FULL_RELOAD === "function") {
      window.ELM_WATCH_FULL_RELOAD();
    } else if (HAS_WINDOW) {
      window.location.reload();
    } else {
      if (message !== undefined) {
        // oxlint-disable-next-line no-console
        console.info(message);
      }
      const why =
        message === undefined
          ? "because a hot reload was not possible"
          : "see above";
      const info = `elm-watch: A full reload or restart of the program running your Elm code is needed (${why}). In a web browser page, I would have reloaded the page. You need to do this manually, or define a \`globalThis.ELM_WATCH_FULL_RELOAD\` function.`;
      // oxlint-disable-next-line no-console
      console.error(info);
    }
  },

  TARGET_DATA: new Map(),

  SOME_TARGET_IS_PROXY: false,

  IS_REGISTERING: true,

  REGISTER: () => {
    // Do nothing.
  },

  HOT_RELOAD: () => {
    // Do nothing.
  },

  SHOULD_SKIP_INIT_CMDS: () => false,

  KILL_MATCHING: () => Promise.resolve(),

  DISCONNECT: () => {
    // Do nothing.
  },

  LOG_DEBUG:
    // oxlint-disable-next-line no-console
    console.debug,

  UI_V1: undefined,
};

let { __ELM_WATCH } = window;

// oxlint-disable-next-line typescript/no-unnecessary-condition
if (typeof __ELM_WATCH !== "object" || __ELM_WATCH === null) {
  // Each property is added later below.
  __ELM_WATCH = {} as unknown as __ELM_WATCH;
  // Using `Object.defineProperty` makes `__ELM_WATCH` not appear when
  // you type just `window.` in the Chrome browser console.
  Object.defineProperty(window, "__ELM_WATCH", { value: __ELM_WATCH });
}

for (const [key, value] of Object.entries(DEFAULT_ELM_WATCH)) {
  if (__ELM_WATCH[key as keyof __ELM_WATCH] === undefined) {
    (__ELM_WATCH as Record<string, unknown>)[key] = value;
  }
}

// Replaced when injecting this code. See ClientConfig.ts.
declare const __ELM_WATCH_CLIENT_CONFIG__: ClientConfig;

// Replaced at build time.
const VERSION = "%VERSION%";
const {
  webSocketToken: WEBSOCKET_TOKEN,
  targetName: TARGET_NAME,
  initialElmCompiledTimestamp: INITIAL_ELM_COMPILED_TIMESTAMP,
  // Note: The JS code running is compiled in `ORIGINAL_COMPILATION_MODE`. But
  // that does not necessarily match the selected compilation mode for the target.
  // If you have a `Debug.log` and switch to optimize mode it won’t be possible to
  // compile, because `Debug.log` isn’t allowed in optimize mode. Therefore we
  // have the selected compilation mode in the `Model` and the running mode here.
  originalCompilationMode: ORIGINAL_COMPILATION_MODE,
  webSocketConnection: WEBSOCKET_CONNECTION,
  debug: DEBUG,
} = __ELM_WATCH_CLIENT_CONFIG__;

const UPDATE_CONFIG: UpdateConfig = {
  originalCompilationMode: ORIGINAL_COMPILATION_MODE,
  initialElmCompiledTimestamp: INITIAL_ELM_COMPILED_TIMESTAMP,
};

const ELM_WATCH_CHANGED_FILE_URL_PATHS_EVENT =
  "elm-watch:changed-file-url-paths";

const ELM_WATCH_CHANGED_FILE_URL_BATCH_TIME = 10;

__ELM_WATCH.SOME_TARGET_IS_PROXY ||= ORIGINAL_COMPILATION_MODE === "proxy";
__ELM_WATCH.IS_REGISTERING = true;

type Mutable = {
  shouldSkipInitCmds: boolean;
  uiTarget: UiTarget | undefined;
  removeListeners: () => void;
  webSocket: WebSocket;
  webSocketTimeoutId: NodeJS.Timeout | undefined;
};

function logDebug(...args: Array<unknown>): void {
  if (DEBUG) {
    __ELM_WATCH.LOG_DEBUG(...args);
  }
}

// Removes the information comment added by SimpleStaticFileServer.ts
// so that it does not take space in the element inspector (it is only
// supposed to be read when viewing the source).
function removeElmWatchIndexHtmlComment(): void {
  const node = document.firstChild;
  if (
    node instanceof Comment &&
    node.data.trimStart().startsWith("elm-watch debug information:")
  ) {
    node.remove();
  }
}

function run(): void {
  let elmCompiledTimestampBeforeReload: number | undefined = undefined;
  try {
    const message = window.sessionStorage.getItem(RELOAD_MESSAGE_KEY);
    if (message !== null) {
      // oxlint-disable-next-line no-console
      console.info(message);
      window.sessionStorage.removeItem(RELOAD_MESSAGE_KEY);
    }
    const key = RELOAD_TARGET_NAME_KEY_PREFIX + TARGET_NAME;
    const previous = window.sessionStorage.getItem(key);
    if (previous !== null) {
      const number = Number(previous);
      if (Number.isFinite(number)) {
        elmCompiledTimestampBeforeReload = number;
      }
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore failing to read or delete from sessionStorage.
  }

  const ui = HAS_WINDOW ? (__ELM_WATCH.UI_V1 ??= createUi()) : undefined;
  const uiTarget = ui?.register(TARGET_NAME);
  const getNow: GetNow = () => new Date();

  if (HAS_WINDOW) {
    removeElmWatchIndexHtmlComment();
  }

  runTeaProgram<Mutable, Msg, Model, Cmd, undefined>({
    initMutable: initMutable(getNow, uiTarget),
    init: Update.init(
      UPDATE_CONFIG,
      getNow(),
      elmCompiledTimestampBeforeReload,
    ),
    update: (msg: Msg, model: Model): [Model, Array<Cmd>] => {
      const [updatedModel, cmds] = Update.update(UPDATE_CONFIG, msg, model);
      const modelChanged = updatedModel !== model;
      const reloadTrouble =
        model.status.tag !== updatedModel.status.tag &&
        updatedModel.status.tag === "WaitingForReload" &&
        updatedModel.elmCompiledTimestamp ===
          updatedModel.elmCompiledTimestampBeforeReload;
      const newModel = modelChanged ? updatedModel : model;
      const oldErrors = getErrors(model.status);
      const newErrors = getErrors(newModel.status);
      const statusType = statusToStatusType(newModel.status.tag);
      const statusTypeChanged =
        statusType !== statusToStatusType(model.status.tag);
      const statusFlashType = getStatusFlashType({
        statusType,
        statusTypeChanged,
        hasReceivedHotReload:
          newModel.elmCompiledTimestamp !== INITIAL_ELM_COMPILED_TIMESTAMP,
      });
      const flashCmd: Array<Cmd> =
        statusFlashType === undefined || cmds.some((cmd) => cmd.tag === "Flash")
          ? []
          : [{ tag: "Flash", flashType: statusFlashType }];
      const allCmds: Array<Cmd> = modelChanged
        ? [
            ...cmds,
            {
              tag: "UpdateGlobalStatus",
              reloadStatus: statusToReloadStatus(newModel),
              elmCompiledTimestamp: newModel.elmCompiledTimestamp,
            },
            // This needs to be done before Render, since it depends on whether
            // the error overlay is visible or not. The errors are kept as-is
            // between statuses (such as `Busy`) until there is a new result.
            oldErrors === newErrors
              ? { tag: "NoCmd" }
              : {
                  tag: "UpdateErrorOverlay",
                  errors: newErrors ?? new Map<string, OverlayError>(),
                  sendKey: statusToSpecialCaseSendKey(newModel.status),
                  // New errors open the error overlay, even if the user
                  // closed it before.
                  open: newErrors !== undefined,
                },
            // Before Render, so that the panel is open in the first render
            // of the new status.
            reloadTrouble ? { tag: "OpenPanel" } : { tag: "NoCmd" },
            ...(ui !== undefined || newModel.status.tag !== model.status.tag
              ? [
                  {
                    tag: "Render",
                    model: newModel,
                  } as const,
                ]
              : []),
            ...flashCmd,
            reloadTrouble
              ? { tag: "TriggerReachedIdleState", reason: "ReloadTrouble" }
              : { tag: "NoCmd" },
          ]
        : [...cmds, ...flashCmd];
      logDebug(`${msg.tag} (${TARGET_NAME})`, msg, newModel, allCmds);
      return [newModel, allCmds];
    },
    runCmd: runCmd(getNow),
  }).catch((error) => {
    // oxlint-disable-next-line no-console
    console.error("elm-watch: Unexpectedly exited with error:", error);
  });

  // This is great when working on the styling of all statuses.
  // When this call is commented out, esbuild won’t include the
  // `renderMockStatuses` function in the output.
  // renderMockStatuses(ui);
}

function statusToReloadStatus(model: Model): ReloadStatus {
  switch (model.status.tag) {
    case "Busy":
    case "Connecting":
      return { tag: "MightWantToReload" };

    case "CompileError":
    case "ElmJsonError":
    case "EvalError":
    case "Idle":
    case "SleepingBeforeReconnect":
    case "UnexpectedError":
      return { tag: "NoReloadWanted" };

    case "WaitingForReload":
      return model.elmCompiledTimestamp ===
        model.elmCompiledTimestampBeforeReload
        ? { tag: "NoReloadWanted" }
        : { tag: "ReloadRequested", reasons: model.status.reasons };
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
    case "ElmJsonError":
    case "EvalError":
    case "UnexpectedError":
      return "Error";
  }
}

function statusToSpecialCaseSendKey(status: Status): SendKey | undefined {
  switch (status.tag) {
    case "CompileError":
    case "Idle":
      return status.sendKey;

    // It works well clicking an error location to open it in an editor while busy.
    case "Busy":
      return SEND_KEY_DO_NOT_USE_ALL_THE_TIME;

    // We can’t send messages about anything if we don’t have a connection.
    case "Connecting":
    case "SleepingBeforeReconnect":
    case "WaitingForReload":
    // We can’t really send messages if there are elm.json errors.
    case "ElmJsonError":
    // These two _might_ work, but it’s unclear. They’re not supposed to happen
    // anyway.
    case "EvalError":
    case "UnexpectedError":
      return undefined;
  }
}

function flattenElmExports(elmExports: ElmExports): Array<[string, ElmModule]> {
  return flattenElmExportsHelper("Elm", elmExports as ElmModule);
}

function flattenElmExportsHelper(
  moduleName: string,
  module: ElmModule,
): Array<[string, ElmModule]> {
  return Object.entries(module).flatMap(([key, value]) =>
    key === "init"
      ? [[moduleName, module]]
      : flattenElmExportsHelper(`${moduleName}.${key}`, value as ElmModule),
  );
}

const initMutable =
  (getNow: GetNow, uiTarget: UiTarget | undefined) =>
  (
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: undefined) => void,
  ): Mutable => {
    // These listeners are started right away, even though the web socket isn’t
    // connected yet. `update` makes sure not to send any messages until
    // connected (Firefox throws “An attempt was made to use an object that is
    // not, or is no longer, usable” when sending on a connecting web socket).
    const removeListeners: Array<() => void> =
      uiTarget === undefined
        ? []
        : [
            addEventListener(window, "focus", (event) => {
              // Used in tests to trigger focus for just one target.
              if (
                event instanceof CustomEvent &&
                event.detail !== TARGET_NAME
              ) {
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
            uiTarget.subscribe({
              onUiMsg: (msg) => {
                dispatch({ tag: "UiMsg", date: getNow(), msg });
              },
            }),
          ];

    const mutable: Mutable = {
      shouldSkipInitCmds: true,
      uiTarget,
      removeListeners: () => {
        for (const removeListener of removeListeners) {
          removeListener();
        }
      },
      webSocket: initWebSocket(
        getNow,
        INITIAL_ELM_COMPILED_TIMESTAMP,
        dispatch,
        (webSocket) => webSocket === mutable.webSocket,
      ),
      webSocketTimeoutId: undefined,
    };

    __ELM_WATCH.RELOAD_STATUSES.set(TARGET_NAME, {
      tag: "MightWantToReload",
    });

    const wrapElmAppInit = (
      initializedElmApps: TargetData["initializedElmApps"],
      moduleName: string,
      module: ElmModule,
      init: ElmModule["init"],
    ): void => {
      module.init = (...args) => {
        const app = init(...args);
        const apps = initializedElmApps.get(moduleName);
        if (apps === undefined) {
          initializedElmApps.set(moduleName, [app]);
        } else {
          apps.push(app);
        }
        dispatch({ tag: "AppInit" });
        return app;
      };
    };

    const originalRegister = __ELM_WATCH.REGISTER;
    __ELM_WATCH.REGISTER = (targetName, elmExports, schedulerEnqueue) => {
      originalRegister(targetName, elmExports, schedulerEnqueue);
      if (targetName !== TARGET_NAME) {
        return;
      }
      __ELM_WATCH.IS_REGISTERING = false;
      if (__ELM_WATCH.TARGET_DATA.has(TARGET_NAME)) {
        throw new Error(
          `elm-watch: This target is already registered! Maybe a duplicate script is being loaded accidentally? Target: ${TARGET_NAME}`,
        );
      }
      const initializedElmApps: TargetData["initializedElmApps"] = new Map();
      const flattenedElmExports = flattenElmExports(elmExports);
      for (const [moduleName, module] of flattenedElmExports) {
        wrapElmAppInit(initializedElmApps, moduleName, module, module.init);
      }
      __ELM_WATCH.TARGET_DATA.set(TARGET_NAME, {
        originalFlattenedElmExports: new Map(flattenedElmExports),
        initializedElmApps,
        originalSchedulerEnqueue: schedulerEnqueue,
      });
    };

    const originalHotReload = __ELM_WATCH.HOT_RELOAD;
    __ELM_WATCH.HOT_RELOAD = (targetName, elmExports, setSchedulerEnqueue) => {
      originalHotReload(targetName, elmExports, setSchedulerEnqueue);
      if (targetName !== TARGET_NAME) {
        return;
      }
      const targetData = __ELM_WATCH.TARGET_DATA.get(TARGET_NAME);
      if (targetData === undefined) {
        return;
      }
      // Make the new code use the original code’s scheduler, so there’s only ever
      // one queue. This is done for every hot reload, whether or not any apps are
      // running. Only the original script is kept in memory for this (not every
      // hot reloaded script). The original script might not have a scheduler
      // (`Html` programs only).
      if (typeof targetData.originalSchedulerEnqueue === "function") {
        setSchedulerEnqueue(targetData.originalSchedulerEnqueue);
      }
      const reloadReasons: Array<ReloadReasonWithModuleName> = [];
      for (const [moduleName, module] of flattenElmExports(elmExports)) {
        const originalElmModule =
          targetData.originalFlattenedElmExports.get(moduleName);
        if (originalElmModule !== undefined) {
          wrapElmAppInit(
            targetData.initializedElmApps,
            moduleName,
            originalElmModule,
            module.init,
          );
        }
        const apps = targetData.initializedElmApps.get(moduleName) ?? [];
        for (const app of apps) {
          const data = (module.init as unknown as ElmWatchReturnDataInit)(
            "__elmWatchReturnData",
          );
          if (app.__elmWatchProgramType !== data.programType) {
            reloadReasons.push({
              tag: "ProgramTypeChanged",
              previousProgramType: app.__elmWatchProgramType,
              newProgramType: data.programType,
              moduleName,
            });
          } else {
            try {
              const innerReasons = app.__elmWatchHotReload(data);
              for (const innerReason of innerReasons) {
                reloadReasons.push({ ...innerReason, moduleName });
              }
            } catch (error) {
              reloadReasons.push({
                tag: "HotReloadCaughtError",
                caughtError: error,
                moduleName,
              });
            }
          }
        }
      }
      mutable.shouldSkipInitCmds = false;
      if (reloadReasons.length === 0) {
        dispatch({
          tag: "EvalSucceeded",
          date: getNow(),
        });
      } else {
        dispatch({
          tag: "EvalNeedsReload",
          date: getNow(),
          reasons: reloadReasons,
        });
      }
    };

    const originalShouldSkipInitCmds = __ELM_WATCH.SHOULD_SKIP_INIT_CMDS;
    __ELM_WATCH.SHOULD_SKIP_INIT_CMDS = (targetName) =>
      originalShouldSkipInitCmds(targetName) ||
      (targetName === TARGET_NAME && mutable.shouldSkipInitCmds);

    const originalKillMatching = __ELM_WATCH.KILL_MATCHING;
    __ELM_WATCH.KILL_MATCHING = (targetName) =>
      new Promise((resolve, reject) => {
        if (targetName.test(TARGET_NAME)) {
          const needsToCloseWebSocket =
            mutable.webSocket.readyState !== WebSocket.CLOSED;
          if (needsToCloseWebSocket) {
            mutable.webSocket.addEventListener("close", () => {
              originalKillMatching(targetName).then(resolve).catch(reject);
            });
            mutable.webSocket.close();
          }
          mutable.removeListeners();
          clearWebSocketTimeout(mutable);
          uiTarget?.unregister();
          resolvePromise(undefined);
          if (!needsToCloseWebSocket) {
            originalKillMatching(targetName).then(resolve).catch(reject);
          }
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

function addEventListener(
  target: EventTarget,
  eventName: string,
  listener: (event: Event) => void,
): () => void {
  target.addEventListener(eventName, listener);
  return () => {
    target.removeEventListener(eventName, listener);
  };
}

function clearWebSocketTimeout(mutable: Mutable): void {
  if (mutable.webSocketTimeoutId !== undefined) {
    clearTimeout(mutable.webSocketTimeoutId);
    mutable.webSocketTimeoutId = undefined;
  }
}

function initWebSocket(
  getNow: GetNow,
  elmCompiledTimestamp: number,
  dispatch: (msg: Msg) => void,
  isCurrent: (webSocket: WebSocket) => boolean,
): WebSocket {
  const [hostname, protocol] =
    // Browser: `window.location` always exists.
    // Web Worker: `window` has been set to `globalThis` at the top, which has `.location`.
    // Node.js: `window.location` does not exist.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    window.location === undefined
      ? ["localhost", "ws"]
      : [
          window.location.hostname === ""
            ? "localhost"
            : window.location.hostname,
          window.location.protocol === "https:" ? "wss" : "ws",
        ];
  const url = new URL(
    typeof WEBSOCKET_CONNECTION === "number"
      ? `${protocol}://${hostname}:${WEBSOCKET_CONNECTION}/elm-watch`
      : WEBSOCKET_CONNECTION,
  );
  url.searchParams.set("elmWatchVersion", VERSION);
  url.searchParams.set("webSocketToken", WEBSOCKET_TOKEN);
  url.searchParams.set("targetName", TARGET_NAME);
  url.searchParams.set("elmCompiledTimestamp", elmCompiledTimestamp.toString());

  const webSocket = new WebSocket(url);

  // After reconnecting, events from previous web sockets must be ignored. For
  // example, the "close" event of a broken connection can arrive long after we
  // have given up on it and connected again.
  const dispatchIfCurrent = (msg: Msg): void => {
    if (isCurrent(webSocket)) {
      dispatch(msg);
    }
  };

  webSocket.addEventListener("open", () => {
    dispatchIfCurrent({ tag: "WebSocketConnected", date: getNow() });
  });

  webSocket.addEventListener("close", () => {
    dispatchIfCurrent({
      tag: "WebSocketClosed",
      date: getNow(),
    });
  });

  // In Node.js, if you start the Node.js program (with the elm-watch client) before you start `elm-watch` hot,
  // the "error" event is emitted. Treating it like "closed" allows us to try reconnecting.
  webSocket.addEventListener("error", () => {
    dispatchIfCurrent({
      tag: "WebSocketClosed",
      date: getNow(),
    });
  });

  webSocket.addEventListener("message", (event) => {
    dispatchIfCurrent({
      tag: "WebSocketMessageReceived",
      date: getNow(),
      data: event.data,
    });
  });

  return webSocket;
}

const runCmd =
  (getNow: GetNow) =>
  (
    cmd: Cmd,
    mutable: Mutable,
    dispatch: (msg: Msg) => void,
    _resolvePromise: (result: undefined) => void,
    rejectPromise: (error: Error) => void,
  ): void => {
    switch (cmd.tag) {
      case "Eval":
        evalCode(cmd.code).catch((unknownError) => {
          void Promise.reject(unknownError);
          dispatch({ tag: "EvalErrored", date: getNow() });
        });
        return;

      case "Flash":
        mutable.uiTarget?.flash(cmd.flashType);
        return;

      case "HandleStaticFilesChanged": {
        const now = getNow();
        let shouldReloadCss = false;
        if (cmd.changedFileUrlPaths === "AnyFileMayHaveChanged") {
          shouldReloadCss = true;
        } else {
          if (
            now.getTime() -
              __ELM_WATCH.CHANGED_FILE_URL_PATHS.timestamp.getTime() >
            ELM_WATCH_CHANGED_FILE_URL_BATCH_TIME
          ) {
            __ELM_WATCH.CHANGED_FILE_URL_PATHS = {
              timestamp: now,
              changed: new Set(),
            };
          }

          const justChangedFileUrlPaths = new Set<string>();

          for (const path of cmd.changedFileUrlPaths) {
            if (path.toLowerCase().endsWith(".css")) {
              shouldReloadCss = true;
            } else if (!__ELM_WATCH.CHANGED_FILE_URL_PATHS.changed.has(path)) {
              justChangedFileUrlPaths.add(path);
            }
          }

          // There might be several targets on the page, all receiving the same
          // changed file url paths. This fires the event only once per batch.
          // (Every target most likely gets the same paths.)
          if (justChangedFileUrlPaths.size > 0) {
            for (const path of justChangedFileUrlPaths) {
              __ELM_WATCH.CHANGED_FILE_URL_PATHS.changed.add(path);
            }
            window.dispatchEvent(
              new CustomEvent(ELM_WATCH_CHANGED_FILE_URL_PATHS_EVENT, {
                detail: justChangedFileUrlPaths,
              }),
            );
          }
        }

        // Same thing here: Every target does not need to reload CSS.
        if (
          shouldReloadCss &&
          now.getTime() - __ELM_WATCH.CHANGED_CSS.getTime() >
            ELM_WATCH_CHANGED_FILE_URL_BATCH_TIME &&
          HAS_WINDOW
        ) {
          __ELM_WATCH.CHANGED_CSS = now;
          runSerially(__ELM_WATCH.CSS_RELOAD, () =>
            reloadAllCssIfNeeded(__ELM_WATCH.ORIGINAL_STYLES),
          )
            .then((didChange) => {
              dispatch({ tag: "ReloadAllCssDone", didChange });
            })
            .catch(rejectPromise);
        }

        return;
      }

      case "NoCmd":
        return;

      case "OpenPanel":
        mutable.uiTarget?.openPanel();
        return;

      case "Reconnect":
        // The previous web socket should already be closed, but make sure it
        // is, and that its timeout can’t close the new web socket.
        mutable.webSocket.close();
        clearWebSocketTimeout(mutable);
        mutable.webSocket = initWebSocket(
          getNow,
          cmd.elmCompiledTimestamp,
          dispatch,
          (webSocket) => webSocket === mutable.webSocket,
        );
        return;

      case "Render": {
        const { model } = cmd;
        const info: Info = {
          version: VERSION,
          webSocketUrl: new URL(mutable.webSocket.url),
          targetName: TARGET_NAME,
          originalCompilationMode: ORIGINAL_COMPILATION_MODE,
          debugModeToggled: getDebugModeToggled(),
        };
        if (mutable.uiTarget === undefined) {
          const isError = statusToStatusType(model.status.tag) === "Error";
          const isWebWorker =
            typeof (window as unknown as { WorkerGlobalScope: unknown })
              .WorkerGlobalScope !== "undefined" && !isError;
          const consoleMethodName =
            // `console.info` looks nicer in the browser console for Web Workers.
            // On Node.js, we want to always print to stderr.
            isError || !isWebWorker ? "error" : "info";
          const consoleMethod = console[consoleMethodName];
          consoleMethod(renderWithoutDomElements(model, info));
        } else {
          mutable.uiTarget.render(modelToSnapshot(model, info));
          __ELM_WATCH.ON_RENDER(TARGET_NAME);
        }
        return;
      }

      case "SendMessage": {
        const json = Codec.JSON.stringify(
          WebSocketToServerMessage,
          cmd.message,
        );
        try {
          mutable.webSocket.send(json);
        } catch (error) {
          // According to MDN, `.send()` throws an exception if the web socket
          // is in the CONNECTING state. We’re not supposed to send messages
          // in that state in the first place, but just in case.
          // `JSON.stringify` is outside the `try` block in case it throws an
          // error – then we at least have a chance of noticing it.
          // oxlint-disable-next-line no-console
          console.error("elm-watch: Failed to send WebSocket message:", error);
        }
        return;
      }

      case "SleepBeforeReconnect":
        runInitCmds(mutable);
        setTimeout(() => {
          if (
            typeof document === "undefined" ||
            document.visibilityState === "visible"
          ) {
            dispatch({
              tag: "SleepBeforeReconnectDone",
              date: getNow(),
              attemptNumber: cmd.attemptNumber,
              sleepStartDate: cmd.sleepStartDate,
            });
          }
        }, retryWaitMs(cmd.attemptNumber));
        return;

      case "TriggerReachedIdleState":
        runInitCmds(mutable);
        // Let the cmd queue be emptied first.
        Promise.resolve()
          .then(() => {
            __ELM_WATCH.ON_REACHED_IDLE_STATE(cmd.reason);
          })
          .catch(rejectPromise);
        return;

      case "UpdateErrorOverlay":
        mutable.uiTarget?.setErrors(cmd.errors, cmd.sendKey, {
          open: cmd.open,
        });
        return;

      case "UpdateGlobalStatus":
        __ELM_WATCH.RELOAD_STATUSES.set(TARGET_NAME, cmd.reloadStatus);
        switch (cmd.reloadStatus.tag) {
          case "NoReloadWanted":
          case "MightWantToReload":
            break;
          case "ReloadRequested":
            try {
              window.sessionStorage.setItem(
                RELOAD_TARGET_NAME_KEY_PREFIX + TARGET_NAME,
                cmd.elmCompiledTimestamp.toString(),
              );
            } catch {
              // Ignore failing to write to sessionStorage.
            }
        }
        reloadPageIfNeeded();
        return;

      // On iOS, if you lock the phone and wait a couple of seconds, the Web
      // Socket disconnects (check the “web socket connections: X” counter in
      // the terminal). Same thing if you just go to the home screen.  When you
      // go back to the tab, I’ve ended up in a state where the WebSocket
      // appears connected, but you don’t receive any messages and when I tried
      // to switch compilation mode the server never got any message. Apparently
      // “broken connections” is a thing with WebSockets and the way you detect
      // them is by sending a ping-pong pair with a timeout:
      // https://github.com/websockets/ws/tree/975382178f8a9355a5a564bb29cb1566889da9ba#how-to-detect-and-close-broken-connections
      // In our case, the window "focus" event occurs when returning to the page
      // after unlocking the phone, or switching from another tab or app, and we
      // already send a `FocusedTab` message then. That’s the perfect ping, and
      // `FocusedTabAcknowledged` is the pong.
      case "WebSocketTimeoutBegin":
        mutable.webSocketTimeoutId ??= setTimeout(() => {
          mutable.webSocketTimeoutId = undefined;
          // Sometimes, `mutable.webSocket.readyState` is `WebSocket.OPEN` and
          // sometimes it’s `WebSocket.CLOSED` when getting here (on iOS).
          // - OPEN: That’s not really true.
          // - CLOSED: We missed the "close" event (iOS didn’t give it to us).
          // Either way, `mutable.webSocket.close()` is safe to run even if
          // the WebSocket is already closed. Finally, on OPEN, the
          // `.close()` method seems to never trigger our "close" listener, so
          // always dispatch ourselves. It doesn’t matter if another dispatch
          // is made just after.
          mutable.webSocket.close();
          dispatch({
            tag: "WebSocketClosed",
            date: getNow(),
          });
        }, __ELM_WATCH.WEBSOCKET_TIMEOUT);
        return;

      case "WebSocketTimeoutClear":
        clearWebSocketTimeout(mutable);
        return;
    }
  };

function runInitCmds(mutable: Mutable): void {
  if (!mutable.shouldSkipInitCmds) {
    return;
  }
  const targetData = __ELM_WATCH.TARGET_DATA.get(TARGET_NAME);
  if (targetData !== undefined) {
    for (const apps of targetData.initializedElmApps.values()) {
      for (const app of apps) {
        app.__elmWatchRunInitCmds();
      }
    }
  }
  mutable.shouldSkipInitCmds = false;
}

// In the Azimutt example, this method takes about 40 ms (which is about the same as
// `f = new Function(code); f()` which doesn’t support modules).
async function evalAsModuleViaBlob(code: string): Promise<void> {
  const objectURL = URL.createObjectURL(
    new Blob([code], { type: "text/javascript" }),
  );
  await import(objectURL);
  URL.revokeObjectURL(objectURL);
}

// In the Azimutt example, this method takes about 200 ms.
// JSDOM does not support `URL.createObjectURL`, and Node.js does not support `import(blob)`.
async function evalAsModuleViaDataUri(code: string): Promise<void> {
  await import(`data:text/javascript,${encodeURIComponent(code)}`);
}

let evalAsModule = evalAsModuleViaDataUri;
evalAsModuleViaBlob("")
  .then(() => {
    evalAsModule = evalAsModuleViaBlob;
  })
  .catch(() => {
    // `evalAsModuleViaBlob` not supported, using the slower `evalAsModuleViaDataUri`.
  });

// We first try eval-ing the code as a script, and only fall back to eval-ing it
// as a module if that fails with a syntax error (likely due to `import` or `export`).
// Script mode is preferred because:
// - It is synchronous.
// - It does not leak memory. Every `import()` of a new URL is kept in the
//   browser’s module map until the page is reloaded, so each hot reload in module
//   mode keeps a copy of the code in memory. In Chromium, a 145 KB hot reload
//   used about 0.5 MB more per reload (about 2 MB with `evalAsModuleViaDataUri`).
// - It is backwards compatible with non-strict mode scripts, which might use
//   features that break in a module or strict mode. For example, if the user has
//   postprocessed the code to do things like `this.FOO = true` (inspired by how
//   the Elm JS basically does `this.Elm = stuff`). Top-level `this` is `undefined`
//   in module mode, while it refers to the global object in script mode (`window`
//   in web pages). (In CommonJS, it refers to `exports`.)
// So people who postprocess their code into ESM pay a bit in time and memory, while
// everyone else gets the fastest option.
async function evalScriptFirst(code: string): Promise<void> {
  let f;
  try {
    // This can fail if the code has incorrect syntax.
    // Note that the code isn’t executed until we call the function.
    // This is good – this allows us to syntax check the code without side effects.
    // oxlint-disable-next-line typescript/no-implied-eval
    f = new Function(code);
  } catch (scriptError) {
    // If there was a syntax error, there’s a chance it was due to `import` and `export`.
    try {
      await evalAsModule(code);
    } catch (moduleError) {
      // If eval-ing as a module failed too, present both errors as we can’t know which
      // is more useful to the user.
      throw new Error(
        `Error when evaluated as a module:\n\n${unknownErrorToString(moduleError)}\n\nError when evaluated as a script:\n\n${unknownErrorToString(scriptError)}`,
      );
    }
    // If the code parsed and ran successfully, the code most likely has `import`
    // or `export`, and will likely have that next time too. Switch over to trying
    // module mode first, and script mode second.
    // `new Function(code)` isn’t free – spending time on that on each hot reload can
    // up to double the time.
    evalCode = evalModuleFirst;
    return;
  }
  // oxlint-disable-next-line typescript/no-unsafe-call
  f();
}

// Like `evalScriptFirst` but tries the modes in the opposite order:
// Module first, then script.
async function evalModuleFirst(code: string): Promise<void> {
  try {
    await evalAsModule(code);
  } catch (moduleError) {
    // If eval-ing as a module fails, try script mode.
    // Note that this is not 100 % clean: Every line but the last might succeed,
    // and then the very last line might be `this.FOO = 1337`, which then fails
    // as `this` is `undefined` in modules. Then trying script mode is going to
    // succeed, but in practice all the code ran twice. That should be fine though –
    // an unnecessary hot reload shouldn’t cause any trouble. One known effect
    // is that the green animation does not appear. However, since we switch back to
    // `evalScriptFirst` it’s going to work next time. And I don’t think it’s very likely
    // this will happen.
    try {
      // oxlint-disable-next-line typescript/no-implied-eval
      const f = new Function(code);
      // oxlint-disable-next-line typescript/no-unsafe-call
      f();
    } catch (scriptError) {
      throw new Error(
        `Error when evaluated as a module:\n\n${unknownErrorToString(moduleError)}\n\nError when evaluated as a script:\n\n${unknownErrorToString(scriptError)}`,
      );
    }
    // Switch back to trying script mode before module mode, as that succeeded better.
    evalCode = evalScriptFirst;
  }
}

let evalCode = evalScriptFirst;

function getDebugModeToggled(): Toggled {
  // If this target is a proxy, or if another one is, we don’t know if
  // it will be possible to switch to debug mode, so don’t allow that yet.
  if (__ELM_WATCH.SOME_TARGET_IS_PROXY) {
    return {
      tag: "Disabled",
      reason: noDebuggerYetReason,
    };
  }

  const targetData = __ELM_WATCH.TARGET_DATA.get(TARGET_NAME);

  const programTypes: Array<ProgramType> =
    targetData === undefined
      ? []
      : Array.from(targetData.initializedElmApps.values()).flatMap((apps) =>
          apps.map((app) => app.__elmWatchProgramType),
        );

  // It’s a valid use case to not initialize any Elm apps right away. (Maybe that is done when clicking a button.)
  // We can’t know if the debugger can be enabled until at least one Elm app has been initialized.
  if (programTypes.length === 0) {
    return {
      tag: "Disabled",
      reason: noDebuggerNoAppsReason,
    };
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
  return noDebugger.length === programTypes.length
    ? {
        tag: "Disabled",
        reason: noDebuggerReason(new Set(noDebugger)),
      }
    : { tag: "Enabled" };
}

function reloadPageIfNeeded(): void {
  let shouldReload = false;
  const reasons: Array<[string, Array<string>]> = [];

  for (const [
    targetName,
    reloadStatus,
  ] of __ELM_WATCH.RELOAD_STATUSES.entries()) {
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
    reasons.length === 1 && first?.[1].length === 1
      ? [" ", `${first[1].join("")}\n(target: ${first[0]})`]
      : [
          ":\n\n",
          reasons
            .map(([targetName, subReasons]) =>
              [
                targetName,
                ...subReasons.map((subReason) => `- ${subReason}`),
              ].join("\n"),
            )
            .join("\n\n"),
        ];
  const message =
    reasons.length === 0
      ? undefined
      : `elm-watch: I did a full page reload because${separator}${reasonString}`;
  __ELM_WATCH.RELOAD_STATUSES = new Map();
  __ELM_WATCH.RELOAD_PAGE(message);
}

function renderWithoutDomElements(model: Model, info: Info): string {
  const statusData = statusIconAndText(model);
  return `${statusData.icon} elm-watch: ${statusData.status} ${formatTime(
    model.status.date,
  )} (${info.targetName})`;
}

function modelToSnapshot(model: Model, info: Info): TargetSnapshot {
  return {
    status: __ELM_WATCH.MOCKED_TIMINGS
      ? { ...model.status, date: new Date("2022-02-05T13:10:05Z") }
      : model.status,
    compilationMode: model.compilationMode,
    elmCompiledTimestamp: model.elmCompiledTimestamp,
    elmCompiledTimestampBeforeReload: model.elmCompiledTimestampBeforeReload,
    info,
    sendKey: statusToSpecialCaseSendKey(model.status),
  };
}

function getStatusFlashType({
  statusType,
  statusTypeChanged,
  hasReceivedHotReload,
}: {
  statusType: StatusType;
  statusTypeChanged: boolean;
  hasReceivedHotReload: boolean;
}): FlashType | undefined {
  switch (statusType) {
    case "Success":
      return statusTypeChanged && hasReceivedHotReload ? "success" : undefined;
    case "Error":
      return statusTypeChanged ? "error" : undefined;
    case "Waiting":
      return undefined;
  }
}

const noDebuggerYetReason = "The Elm debugger isn't available at this point.";

const noDebuggerNoAppsReason =
  "The Elm debugger cannot be enabled until at least one Elm app has been initialized. (Check the browser console for errors if you expected an Elm app to be initialized by now.)";

function noDebuggerReason(noDebuggerProgramTypes: Set<ProgramType>): string {
  return `The Elm debugger isn't supported by ${humanList(
    Array.from(noDebuggerProgramTypes, (programType) => `\`${programType}\``),
    "and",
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

function renderMockStatuses(ui: Ui | undefined): void {
  if (ui === undefined) {
    return;
  }

  const date = new Date();

  const info: Omit<Info, "targetName"> = {
    version: VERSION,
    webSocketUrl: new URL("ws://localhost:53167"),
    originalCompilationMode: "standard",
    debugModeToggled: { tag: "Enabled" },
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
      errors: undefined,
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
        webSocketUrl: new URL(
          "ws://development.admin.example.com.localhost:53167",
        ),
      },
    },
    IPAdress: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        webSocketUrl: new URL("ws://192.168.123.123:53167"),
      },
    },
    NoDebuggerYetWithDebugLogOptimizeError: {
      tag: "CompileError",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      errors: new Map(),
      openEditorError: undefined,
      info: {
        ...info,
        originalCompilationMode: "standard",
        debugModeToggled: {
          tag: "Disabled",
          reason: noDebuggerYetReason,
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
        debugModeToggled: {
          tag: "Disabled",
          reason: noDebuggerReason(new Set(["Html"])),
        },
      },
    },
    DisabledDebugger2: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        debugModeToggled: {
          tag: "Disabled",
          reason: noDebuggerReason(new Set(["Html", "Platform.worker"])),
        },
      },
    },
    NoElmApps: {
      tag: "Idle",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        debugModeToggled: {
          tag: "Disabled",
          reason: noDebuggerNoAppsReason,
        },
      },
    },
    CompileError: {
      tag: "CompileError",
      date,
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      errors: new Map(),
      openEditorError: { tag: "EnvNotSet" },
    },
    ElmJsonError: {
      tag: "ElmJsonError",
      date,
      error: "Elm.json error",
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
    ConnectingWss: {
      tag: "Connecting",
      date,
      attemptNumber: 1,
      info: {
        ...info,
        webSocketUrl: new URL("wss://localhost:53167"),
      },
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
    SleepingBeforeReconnectWss: {
      tag: "SleepingBeforeReconnect",
      date,
      attemptNumber: 1,
      info: {
        ...info,
        webSocketUrl: new URL("wss://localhost:53167"),
      },
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
    const uiTarget = ui.register(targetName);
    uiTarget.render({
      status,
      compilationMode: status.compilationMode ?? "standard",
      elmCompiledTimestamp: 0,
      elmCompiledTimestampBeforeReload: undefined,
      info: { ...(status.info ?? info), targetName },
      sendKey: statusToSpecialCaseSendKey(status),
    });
    uiTarget.openPanel();
  }
}

void renderMockStatuses;

// Node.js used to not have a `WebSocket` global. We used to skip running the elm-watch client
// for `Platform.worker` programs run (in a certain way) in Node.js.
// These days, Node.js does have `WebSocket`, and the elm-watch client does work in Node.js.
// But we keep the check for backwards compatibility.
if (typeof WebSocket !== "undefined") {
  run();
}
