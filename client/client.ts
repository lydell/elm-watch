import * as Codec from "tiny-decoders";

import { formatDate, formatTime } from "../src/Helpers";
import { NonEmptyArray } from "../src/NonEmptyArray";
import { runTeaProgram } from "../src/TeaProgram";
import {
  AbsolutePath,
  BrowserUiPosition,
  CompilationMode,
  CompilationModeWithProxy,
  GetNow,
} from "../src/Types";
import { reloadAllCssIfNeeded } from "./css";
import {
  decodeWebSocketToClientMessage,
  ErrorLocation,
  OpenEditorError,
  StatusChange,
  WebSocketToClientMessage,
  WebSocketToServerMessage,
} from "./WebSocketMessages";

// Support environments, such as Web Workers, where `window` does not exist.
const window = globalThis as unknown as Window;

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
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
  RELOAD_STATUSES: Map</* targetName */ string, ReloadStatus>;
  RELOAD_PAGE: (message: string | undefined) => void;
  TARGET_DATA: Map</* targetName */ string, TargetData>;
  SOME_TARGET_IS_PROXY: boolean;
  IS_REGISTERING: boolean;
  REGISTER: (targetName: string, elmExports: ElmExports) => void;
  HOT_RELOAD: (targetName: string, elmExports: ElmExports) => void;
  SHOULD_SKIP_INIT_CMDS: (targetName: string) => boolean;
  ON_RENDER: (targetName: string) => void;
  ON_REACHED_IDLE_STATE: (reason: ReachedIdleStateReason) => void;
  KILL_MATCHING: (targetName: RegExp) => Promise<void>;
  DISCONNECT: (targetName: RegExp) => void;
  LOG_DEBUG: typeof console.debug;
};

type TargetData = {
  originalFlattenedElmExports: Map</* moduleName */ string, ElmModule>;
  initializedElmApps: Map</* moduleName */ string, Array<ElmApp>>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
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

type ReloadReason =
  | {
      tag: "FlagsTypeChanged";
      jsonErrorMessage: string;
    }
  | {
      tag: "HotReloadCaughtError";
      caughtError: unknown;
    }
  | {
      tag: "InitReturnValueChanged";
    }
  | {
      tag: "MessageTypeChangedInDebugMode";
    }
  | {
      tag: "NewPortAdded";
      name: string;
    }
  | {
      tag: "ProgramTypeChanged";
      previousProgramType: ProgramType;
      newProgramType: ProgramType;
    };

type ReloadReasonWithModuleName = ReloadReason & { moduleName: string };

type ProgramType =
  | "Platform.worker"
  | "Browser.sandbox"
  | "Browser.element"
  | "Browser.document"
  | "Browser.application"
  | "Html";

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
        // eslint-disable-next-line no-console
        console.info(message);
      }
      const why =
        message === undefined
          ? "because a hot reload was not possible"
          : "see above";
      const info = `elm-watch: A full reload or restart of the program running your Elm code is needed (${why}). In a web browser page, I would have reloaded the page. You need to do this manually, or define a \`globalThis.ELM_WATCH_FULL_RELOAD\` function.`;
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
    console.debug,
};

let { __ELM_WATCH } = window;

// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (typeof __ELM_WATCH !== "object" || __ELM_WATCH === null) {
  // Each property is added later below.
  __ELM_WATCH = {} as unknown as __ELM_WATCH;
  // Using `Object.defineProperty` makes `__ELM_WATCH` not appear when
  // you type just `window.` in the Chrome browser console.
  Object.defineProperty(window, "__ELM_WATCH", { value: __ELM_WATCH });
}

for (const [key, value] of Object.entries(DEFAULT_ELM_WATCH)) {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (__ELM_WATCH[key as keyof __ELM_WATCH] === undefined) {
    (__ELM_WATCH as Record<string, unknown>)[key] = value;
  }
}

const VERSION = "%VERSION%";
const WEBSOCKET_TOKEN = "%WEBSOCKET_TOKEN%";
const TARGET_NAME = "%TARGET_NAME%";
const INITIAL_ELM_COMPILED_TIMESTAMP = Number(
  "%INITIAL_ELM_COMPILED_TIMESTAMP%",
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
const WEBSOCKET_CONNECTION = "%WEBSOCKET_CONNECTION%";
const CONTAINER_ID = "elm-watch";
const DEBUG = String("%DEBUG%") === "true";

// Public events:
const ELM_WATCH_CHANGED_FILE_URL_PATHS_EVENT =
  "elm-watch:changed-file-url-paths";
// Internal events:
const BROWSER_UI_MOVED_EVENT = "BROWSER_UI_MOVED_EVENT";
const CLOSE_ALL_ERROR_OVERLAYS_EVENT = "CLOSE_ALL_ERROR_OVERLAYS_EVENT";

const ELM_WATCH_CHANGED_FILE_URL_BATCH_TIME = 10;

// A compilation after moving the browser UI on a big app takes around 700 ms
// for me. So more than double that should be plenty.
const JUST_CHANGED_BROWSER_UI_POSITION_TIMEOUT = 2000;

__ELM_WATCH.SOME_TARGET_IS_PROXY ||= ORIGINAL_COMPILATION_MODE === "proxy";
__ELM_WATCH.IS_REGISTERING = true;

type Mutable = {
  shouldSkipInitCmds: boolean;
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
      reasons: Array<ReloadReasonWithModuleName>;
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
      tag: "ReloadAllCssDone";
      didChange: boolean;
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
      tag: "ChangedOpenErrorOverlay";
      openErrorOverlay: boolean;
    }
  | {
      tag: "PressedChevron";
    }
  | {
      tag: "PressedOpenEditor";
      file: AbsolutePath;
      line: number;
      column: number;
      sendKey: SendKey;
    }
  | {
      tag: "PressedReconnectNow";
    };

type Model = {
  status: Status;
  compilationMode: CompilationModeWithProxy;
  browserUiPosition: BrowserUiPosition;
  lastBrowserUiPositionChangeDate: Date | undefined;
  elmCompiledTimestamp: number;
  elmCompiledTimestampBeforeReload: number | undefined;
  uiExpanded: boolean;
};

type Cmd =
  | {
      tag: "Eval";
      code: string;
    }
  | {
      tag: "Flash";
      flashType: FlashType;
    }
  | {
      tag: "HandleStaticFilesChanged";
      changedFileUrlPaths: NonEmptyArray<string> | "AnyFileMayHaveChanged";
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
      tag: "UpdateErrorOverlay";
      errors: Map<string, OverlayError>;
      sendKey: SendKey | undefined;
    }
  | {
      tag: "UpdateGlobalStatus";
      reloadStatus: ReloadStatus;
      elmCompiledTimestamp: number;
    }
  | {
      tag: "WebSocketTimeoutBegin";
    }
  | {
      tag: "WebSocketTimeoutClear";
    };

type OverlayError = {
  title: string;
  location: ErrorLocation | undefined;
  htmlContent: string;
  foregroundColor: string;
  backgroundColor: string;
};

type Status =
  | {
      tag: "Busy";
      date: Date;
      errorOverlay: ErrorOverlay | undefined;
    }
  | {
      tag: "CompileError";
      date: Date;
      sendKey: SendKey;
      errorOverlay: ErrorOverlay;
      openEditorError: OpenEditorError | undefined;
    }
  | {
      tag: "Connecting";
      date: Date;
      attemptNumber: number;
    }
  | {
      tag: "ElmJsonError";
      date: Date;
      error: string;
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

type ErrorOverlay = {
  errors: Map<string, OverlayError>;
  openErrorOverlay: boolean;
};

export type ReachedIdleStateReason =
  | "AlreadyUpToDate"
  | "ClientError"
  | "CompileError"
  | "ElmJsonError"
  | "EvalErrored"
  | "EvalSucceeded"
  | "OpenEditorFailed"
  | "ReloadTrouble";

type SendKey = typeof SEND_KEY_DO_NOT_USE_ALL_THE_TIME;

const SEND_KEY_DO_NOT_USE_ALL_THE_TIME: unique symbol = Symbol(
  "This value is supposed to only be obtained via `Status`.",
);

function logDebug(...args: Array<unknown>): void {
  if (DEBUG) {
    __ELM_WATCH.LOG_DEBUG(...args);
  }
}

function BrowserUiPositionWithFallback(value: unknown): BrowserUiPosition {
  const decoderResult = BrowserUiPosition.decoder(value);
  switch (decoderResult.tag) {
    case "DecoderError":
      return ORIGINAL_BROWSER_UI_POSITION;
    case "Valid":
      return decoderResult.value;
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
      // eslint-disable-next-line no-console
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

  const elements = HAS_WINDOW ? getOrCreateTargetRoot() : undefined;
  const browserUiPosition =
    elements === undefined
      ? ORIGINAL_BROWSER_UI_POSITION
      : BrowserUiPositionWithFallback(elements.container.dataset["position"]);
  const getNow: GetNow = () => new Date();

  if (HAS_WINDOW) {
    removeElmWatchIndexHtmlComment();
  }

  runTeaProgram<Mutable, Msg, Model, Cmd, undefined>({
    initMutable: initMutable(getNow, elements),
    init: init(getNow(), browserUiPosition, elmCompiledTimestampBeforeReload),
    update: (msg: Msg, model: Model): [Model, Array<Cmd>] => {
      const [updatedModel, cmds] = update(msg, model);
      const modelChanged = updatedModel !== model;
      const reloadTrouble =
        model.status.tag !== updatedModel.status.tag &&
        updatedModel.status.tag === "WaitingForReload" &&
        updatedModel.elmCompiledTimestamp ===
          updatedModel.elmCompiledTimestampBeforeReload;
      const newModel: Model = modelChanged
        ? {
            ...updatedModel,
            uiExpanded: reloadTrouble ? true : updatedModel.uiExpanded,
          }
        : model;
      const oldErrorOverlay = getErrorOverlay(model.status);
      const newErrorOverlay = getErrorOverlay(newModel.status);
      const statusType = statusToStatusType(newModel.status.tag);
      const statusTypeChanged =
        statusType !== statusToStatusType(model.status.tag);
      const statusFlashType = getStatusFlashType({
        statusType,
        statusTypeChanged,
        hasReceivedHotReload:
          newModel.elmCompiledTimestamp !== INITIAL_ELM_COMPILED_TIMESTAMP,
        uiRelatedUpdate: msg.tag === "UiMsg",
        errorOverlayVisible: elements !== undefined && !elements.overlay.hidden,
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
            // the error overlay is visible or not.
            newModel.status.tag === model.status.tag &&
            oldErrorOverlay?.openErrorOverlay ===
              newErrorOverlay?.openErrorOverlay
              ? { tag: "NoCmd" }
              : {
                  tag: "UpdateErrorOverlay",
                  errors:
                    // eslint-disable-next-line @typescript-eslint/prefer-optional-chain
                    newErrorOverlay === undefined ||
                    !newErrorOverlay.openErrorOverlay
                      ? new Map<string, OverlayError>()
                      : newErrorOverlay.errors,
                  sendKey: statusToSpecialCaseSendKey(newModel.status),
                },
            ...(elements !== undefined ||
            newModel.status.tag !== model.status.tag
              ? [
                  {
                    tag: "Render",
                    model: newModel,
                    manageFocus: msg.tag === "UiMsg",
                  } as const,
                ]
              : []),
            ...flashCmd,
            model.browserUiPosition === newModel.browserUiPosition
              ? { tag: "NoCmd" }
              : {
                  tag: "SetBrowserUiPosition",
                  browserUiPosition: newModel.browserUiPosition,
                },
            reloadTrouble
              ? { tag: "TriggerReachedIdleState", reason: "ReloadTrouble" }
              : { tag: "NoCmd" },
          ]
        : [...cmds, ...flashCmd];
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

function getErrorOverlay(status: Status): ErrorOverlay | undefined {
  return "errorOverlay" in status ? status.errorOverlay : undefined;
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

    // It works well moving the browser UI while already busy.
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

function getOrCreateContainer(): HTMLDialogElement {
  const existing = document.getElementById(CONTAINER_ID);

  if (existing !== null) {
    return existing as HTMLDialogElement;
  }

  const container = h(
    typeof HTMLDialogElement === "function"
      ? HTMLDialogElement
      : (HTMLDivElement as typeof HTMLDialogElement),
    { id: CONTAINER_ID },
  );
  // Note: If we add any more styling to this element, Chrome and Safari expand all the styles
  // in the element inspector, which takes several lines and is pretty distracting.
  container.style.all = "initial";

  // `<dialog>` elements cannot have a shadow root, so we need an inner element.
  const containerInner = h(HTMLDivElement, {});
  containerInner.style.all = "initial";
  containerInner.style.position = "fixed";
  containerInner.style.zIndex = "2147483647"; // Maximum z-index supported by browsers. (Popover fallback.)

  // In Safari, when making a `<dialog>` element into a popovers, it
  // always covers the entire page (making it impossible to click things),
  // which is another reason for having the inner element.
  // This enables popover mode, allowing `.showPopover()` to be called later:
  containerInner.popover = "manual";

  const shadowRoot = containerInner.attachShadow({ mode: "open" });
  shadowRoot.append(h(HTMLStyleElement, {}, CSS));
  container.append(containerInner);
  document.documentElement.append(container);

  return container;
}

type Elements = {
  container: HTMLDialogElement;
  containerInner: HTMLElement;
  shadowRoot: ShadowRoot;
  overlay: HTMLElement;
  overlayCloseButton: HTMLElement;
  root: Element;
  targetRoot: HTMLElement;
};

function getOrCreateTargetRoot(): Elements {
  const container = getOrCreateContainer();
  const containerInner = container.firstElementChild;

  if (containerInner === null) {
    throw new Error(
      `elm-watch: Cannot set up hot reload, because an element with ID ${CONTAINER_ID} exists, but \`.firstElementChild\` is null!`,
    );
  }

  const { shadowRoot } = containerInner;

  if (shadowRoot === null) {
    throw new Error(
      `elm-watch: Cannot set up hot reload, because an element with ID ${CONTAINER_ID} exists, but \`.shadowRoot\` is null!`,
    );
  }

  let overlay = shadowRoot.querySelector(`.${CLASS.overlay}`);
  if (overlay === null) {
    overlay = h(HTMLDivElement, {
      className: CLASS.overlay,
      attrs: { "data-test-id": "Overlay" },
    });
    shadowRoot.append(overlay);
  }

  let overlayCloseButton = shadowRoot.querySelector(
    `.${CLASS.overlayCloseButton}`,
  );
  if (overlayCloseButton === null) {
    const closeAllErrorOverlays = (): void => {
      shadowRoot.dispatchEvent(new CustomEvent(CLOSE_ALL_ERROR_OVERLAYS_EVENT));
    };
    overlayCloseButton = h(HTMLButtonElement, {
      className: CLASS.overlayCloseButton,
      attrs: {
        "aria-label": "Close error overlay",
        "data-test-id": "OverlayCloseButton",
      },
      onclick: closeAllErrorOverlays,
    });
    shadowRoot.append(overlayCloseButton);
    const overlayNonNull = overlay;
    window.addEventListener(
      "keydown",
      (event) => {
        if (overlayNonNull.hasChildNodes() && event.key === "Escape") {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeAllErrorOverlays();
        }
      },
      true,
    );
  }

  let root = shadowRoot.querySelector(`.${CLASS.root}`);
  if (root === null) {
    root = h(HTMLDivElement, { className: CLASS.root });
    shadowRoot.append(root);
  }

  const targetRoot = createTargetRoot(TARGET_NAME);
  root.append(targetRoot);

  const elements: Elements = {
    container,
    containerInner: containerInner as HTMLElement,
    shadowRoot,
    overlay: overlay as HTMLElement,
    overlayCloseButton: overlayCloseButton as HTMLElement,
    root,
    targetRoot,
  };

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
  browserUiPosition: BrowserUiPosition,
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
  browserUiPosition: BrowserUiPosition,
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
  elements: Elements,
): void {
  // Only the first target is in charge of the browser UI position.
  const isFirstTargetRoot = elements.targetRoot.previousElementSibling === null;
  if (!isFirstTargetRoot) {
    return;
  }

  elements.container.dataset["position"] = browserUiPosition;

  for (const [key, value] of Object.entries(
    browserUiPositionToCss(browserUiPosition),
  )) {
    elements.containerInner.style.setProperty(key, value);
  }

  const isInBottomHalf =
    browserUiPosition === "BottomLeft" || browserUiPosition === "BottomRight";
  elements.root.classList.toggle(CLASS.rootBottomHalf, isInBottomHalf);

  elements.shadowRoot.dispatchEvent(
    new CustomEvent(BROWSER_UI_MOVED_EVENT, { detail: browserUiPosition }),
  );
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
  (getNow: GetNow, elements: Elements | undefined) =>
  (
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: undefined) => void,
  ): Mutable => {
    let removeListeners: Array<() => void> = [];

    const mutable: Mutable = {
      shouldSkipInitCmds: true,
      removeListeners: () => {
        for (const removeListener of removeListeners) {
          removeListener();
        }
      },
      webSocket: initWebSocket(
        getNow,
        INITIAL_ELM_COMPILED_TIMESTAMP,
        dispatch,
      ),
      webSocketTimeoutId: undefined,
    };

    // These events might happen before the WebSocket is ready.
    // Firefox throws this error via `FocusedTab`:
    // DOMException: An attempt was made to use an object that is not, or is no longer, usable
    // So wait until the WebSocket is ready before starting those listeners.
    if (elements !== undefined) {
      mutable.webSocket.addEventListener(
        "open",
        () => {
          removeListeners = [
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
            addEventListener(
              elements.shadowRoot,
              BROWSER_UI_MOVED_EVENT,
              (event) => {
                dispatch({
                  tag: "BrowserUiMoved",
                  browserUiPosition: BrowserUiPositionWithFallback(
                    (event as CustomEvent).detail,
                  ),
                });
              },
            ),
            addEventListener(
              elements.shadowRoot,
              CLOSE_ALL_ERROR_OVERLAYS_EVENT,
              () => {
                dispatch({
                  tag: "UiMsg",
                  date: getNow(),
                  msg: {
                    tag: "ChangedOpenErrorOverlay",
                    openErrorOverlay: false,
                  },
                });
              },
            ),
          ];
        },
        { once: true },
      );
    }

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
    __ELM_WATCH.REGISTER = (targetName, elmExports) => {
      originalRegister(targetName, elmExports);
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
      });
    };

    const originalHotReload = __ELM_WATCH.HOT_RELOAD;
    __ELM_WATCH.HOT_RELOAD = (targetName, elmExports) => {
      originalHotReload(targetName, elmExports);
      if (targetName !== TARGET_NAME) {
        return;
      }
      const targetData = __ELM_WATCH.TARGET_DATA.get(TARGET_NAME);
      if (targetData === undefined) {
        return;
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
          if (mutable.webSocketTimeoutId !== undefined) {
            clearTimeout(mutable.webSocketTimeoutId);
            mutable.webSocketTimeoutId = undefined;
          }
          elements?.targetRoot.remove();
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

function initWebSocket(
  getNow: GetNow,
  elmCompiledTimestamp: number,
  dispatch: (msg: Msg) => void,
): WebSocket {
  const [hostname, protocol] =
    // Browser: `window.location` always exists.
    // Web Worker: `window` has been set to `globalThis` at the top, which has `.location`.
    // Node.js: `window.location` does not exist.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    window.location === undefined
      ? ["localhost", "ws"]
      : [
          window.location.hostname === ""
            ? "localhost"
            : window.location.hostname,
          window.location.protocol === "https:" ? "wss" : "ws",
        ];
  const url = new URL(
    /^\d+$/.test(WEBSOCKET_CONNECTION)
      ? `${protocol}://${hostname}:${WEBSOCKET_CONNECTION}/elm-watch`
      : WEBSOCKET_CONNECTION,
  );
  url.searchParams.set("elmWatchVersion", VERSION);
  url.searchParams.set("webSocketToken", WEBSOCKET_TOKEN);
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

  // In Node.js, if you start the Node.js program (with the elm-watch client) before you start `elm-watch` hot,
  // the "error" event is emitted. Treating it like "closed" allows us to try reconnecting.
  webSocket.addEventListener("error", () => {
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
  browserUiPosition: BrowserUiPosition,
  elmCompiledTimestampBeforeReload: number | undefined,
): [Model, Array<Cmd>] => {
  const model: Model = {
    status: { tag: "Connecting", date, attemptNumber: 1 },
    compilationMode: ORIGINAL_COMPILATION_MODE,
    browserUiPosition,
    lastBrowserUiPositionChangeDate: undefined,
    elmCompiledTimestamp: INITIAL_ELM_COMPILED_TIMESTAMP,
    elmCompiledTimestampBeforeReload,
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
            reasons: Array.from(new Set(msg.reasons.map(reloadReasonToString))),
          },
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
        model,
        [
          // Replay the error animation.
          ...(statusToStatusType(model.status.tag) === "Error"
            ? [{ tag: "Flash", flashType: "error" } as const]
            : []),
          // Send these commands regardless of current status: We want to prioritize the target
          // due to the focus no matter what, and after waking up on iOS we need to check the
          // WebSocket connection no matter what as well. For example, it’s possible to lock
          // the phone while Busy, and then we miss the “done” message, which makes us still
          // have the Busy status when unlocking the phone.
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

    case "ReloadAllCssDone":
      return [
        model,
        msg.didChange ? [{ tag: "Flash", flashType: "success" }] : [],
      ];

    case "SleepBeforeReconnectDone":
      return reconnect(model, msg.date, { force: false });

    case "UiMsg":
      return onUiMsg(msg.date, msg.msg, model);

    case "WebSocketClosed":
      // This message is triggered from both the WebSocket "error" and "closed" events.
      // Sometimes, both events happen at the same time. We only want to start reconnecting once,
      // so check if we’re already sleeping before doing anything.
      if (model.status.tag === "SleepingBeforeReconnect") {
        return [model, []];
      } else {
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
      return [
        {
          ...model,
          status: { tag: "Busy", date: msg.date, errorOverlay: undefined },
        },
        [],
      ];

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
          status: {
            tag: "Busy",
            date,
            errorOverlay: getErrorOverlay(model.status),
          },
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

    case "ChangedOpenErrorOverlay":
      return "errorOverlay" in model.status &&
        model.status.errorOverlay !== undefined
        ? [
            {
              ...model,
              status: {
                ...model.status,
                errorOverlay: {
                  ...model.status.errorOverlay,
                  openErrorOverlay: msg.openErrorOverlay,
                },
              },
              uiExpanded: false,
            },
            [
              {
                tag: "SendMessage",
                message: {
                  tag: "ChangedOpenErrorOverlay",
                  openErrorOverlay: msg.openErrorOverlay,
                },
                sendKey:
                  // It works well clicking an error location to open it in an editor while busy.
                  model.status.tag === "Busy"
                    ? SEND_KEY_DO_NOT_USE_ALL_THE_TIME
                    : model.status.sendKey,
              },
            ],
          ]
        : [model, []];

    case "PressedChevron":
      return [{ ...model, uiExpanded: !model.uiExpanded }, []];

    case "PressedOpenEditor":
      return [
        model,
        [
          {
            tag: "SendMessage",
            message: {
              tag: "PressedOpenEditor",
              file: msg.file,
              line: msg.line,
              column: msg.column,
            },
            sendKey: msg.sendKey,
          },
        ],
      ];

    case "PressedReconnectNow":
      return reconnect(model, date, { force: true });
  }
}

function onWebSocketToClientMessage(
  date: Date,
  msg: WebSocketToClientMessage,
  model: Model,
): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "FocusedTabAcknowledged":
      return [model, [{ tag: "WebSocketTimeoutClear" }]];

    case "OpenEditorFailed":
      return [
        model.status.tag === "CompileError"
          ? {
              ...model,
              status: { ...model.status, openEditorError: msg.error },
              uiExpanded: true,
            }
          : model,
        [
          {
            tag: "TriggerReachedIdleState",
            reason: "OpenEditorFailed",
          },
        ],
      ];

    case "StaticFilesChanged":
      return [
        { ...model, status: { ...model.status, date } },
        [
          {
            tag: "HandleStaticFilesChanged",
            changedFileUrlPaths: msg.changedFileUrlPaths,
          },
        ],
      ];

    case "StaticFilesMayHaveChangedWhileDisconnected":
      return [
        { ...model, status: { ...model.status, date } },
        [
          {
            tag: "HandleStaticFilesChanged",
            changedFileUrlPaths: "AnyFileMayHaveChanged",
          },
        ],
      ];

    case "StatusChanged":
      return statusChanged(date, msg.status, model);

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
  status: StatusChange,
  model: Model,
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
            errorOverlay: getErrorOverlay(model.status),
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
            errorOverlay: {
              errors: new Map(
                status.errors.map((error) => {
                  const overlayError: OverlayError = {
                    title: error.title,
                    location: error.location,
                    htmlContent: error.htmlContent,
                    foregroundColor: status.foregroundColor,
                    backgroundColor: status.backgroundColor,
                  };
                  const id = Codec.JSON.stringify(Codec.unknown, overlayError);
                  return [id, overlayError];
                }),
              ),
              openErrorOverlay: status.openErrorOverlay,
            },
            openEditorError: undefined,
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

    case "ElmJsonError":
      return [
        {
          ...model,
          status: { tag: "ElmJsonError", date, error: status.error },
        },
        [
          {
            tag: "TriggerReachedIdleState",
            reason: "ElmJsonError",
          },
        ],
      ];
  }
}

function reconnect(
  model: Model,
  date: Date,
  { force }: { force: boolean },
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
    rejectPromise: (error: Error) => void,
  ): void => {
    switch (cmd.tag) {
      case "Eval":
        evalWithBackwardsCompatibility(cmd.code).catch((unknownError) => {
          void Promise.reject(unknownError);
          dispatch({ tag: "EvalErrored", date: getNow() });
        });
        return;

      case "Flash":
        if (elements !== undefined) {
          flash(elements, cmd.flashType);
        }
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
            ELM_WATCH_CHANGED_FILE_URL_BATCH_TIME
        ) {
          __ELM_WATCH.CHANGED_CSS = now;
          reloadAllCssIfNeeded(__ELM_WATCH.ORIGINAL_STYLES)
            .then((didChange) => {
              dispatch({ tag: "ReloadAllCssDone", didChange });
            })
            .catch(rejectPromise);
        }

        return;
      }

      case "NoCmd":
        return;

      case "Reconnect":
        mutable.webSocket = initWebSocket(
          getNow,
          cmd.elmCompiledTimestamp,
          dispatch,
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
        if (elements === undefined) {
          const isError = statusToStatusType(model.status.tag) === "Error";
          const isWebWorker =
            typeof (window as unknown as { WorkerGlobalScope: unknown })
              .WorkerGlobalScope !== "undefined" && !isError;
          const consoleMethodName =
            // `console.info` looks nicer in the browser console for Web Workers.
            // On Node.js, we want to always print to stderr.
            isError || !isWebWorker ? "error" : "info";
          // eslint-disable-next-line no-console
          const consoleMethod = console[consoleMethodName];
          consoleMethod(renderWithoutDomElements(model, info));
        } else {
          const { targetRoot } = elements;
          render(getNow, targetRoot, dispatch, model, info, cmd.manageFocus);

          // elm-watch’s overlay needs to be a modal `<dialog>` for two reasons:
          // - It makes sure you cannot interact with elements behind it.
          // - We need it to win against other modal `<dialog>`s on the page – they make
          //   all other content on the page, including our overlay, inert.
          // Support for `<dialog>` shipped in Firefox and Safari in 2022-03-14.
          // These methods are not supported in JSDOM, so we only call them if they exist.
          if (
            typeof elements.container.close === "function" &&
            typeof elements.container.showModal === "function" &&
            // Support users removing elm-watch’s UI (`.showModal()` throws an error in that case).
            elements.container.isConnected
          ) {
            if (elements.overlay.hidden) {
              elements.container.close();
            } else {
              elements.container.showModal();
            }
          }

          // Put the inner container in the top level. This is needed to stay on top of
          // popovers. See: https://developer.mozilla.org/en-US/docs/Glossary/Top_layer
          // The latest shown popover gets drawn on top, so we need to enter and exit
          // popover frequently for elm-watch to force it to be on the very top.
          // `.showPopover()` shipped in Firefox 125, released 2024-04-16.
          // At the time of writing (2024-10-27) that was a bit too recent to be
          // required, so we use only call the methods if they exist. The element falls
          // back to having the highest z-index.
          if (
            typeof elements.containerInner.hidePopover === "function" &&
            typeof elements.containerInner.showPopover === "function" &&
            // Support users removing elm-watch’s UI (`.showPopover()` throws an error in that case).
            elements.containerInner.isConnected
          ) {
            elements.containerInner.hidePopover();
            elements.containerInner.showPopover();
          }
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
          // eslint-disable-next-line no-console
          console.error("elm-watch: Failed to send WebSocket message:", error);
        }
        return;
      }

      case "SetBrowserUiPosition":
        if (elements !== undefined) {
          setBrowserUiPosition(cmd.browserUiPosition, elements);
        }
        return;

      case "SleepBeforeReconnect":
        runInitCmds(mutable);
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
        runInitCmds(mutable);
        // Let the cmd queue be emptied first.
        Promise.resolve()
          .then(() => {
            __ELM_WATCH.ON_REACHED_IDLE_STATE(cmd.reason);
          })
          .catch(rejectPromise);
        return;

      case "UpdateErrorOverlay":
        if (elements !== undefined) {
          updateErrorOverlay(
            TARGET_NAME,
            (msg) => {
              dispatch({ tag: "UiMsg", date: getNow(), msg });
            },
            cmd.sendKey,
            cmd.errors,
            elements.overlay,
            elements.overlayCloseButton,
          );
        }
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
        if (mutable.webSocketTimeoutId === undefined) {
          mutable.webSocketTimeoutId = setTimeout(() => {
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

// For backwards compatibility, we need to first try eval-ing the code like
// we did before supporting modules. While any strict mode enabled script
// should work just fine to execute as a module (which are always in strict mode),
// non-strict mode scripts might use features that break in a module or strict mode.
// For example, if the user has postprocessed the code to do things like
// `this.FOO = true` (inspired by how the Elm JS basically does `this.Elm = stuff`).
// Top-level `this` is `undefined` in module mode, while it refers to the global
// object in script mode (`window` in web pages). (In CommonJS, it refers to `exports`.)
// This backwards compatibility can be removed in a major version.
// When we do, revert this commit to make the tests pass: bbdbe86f24c8d047f2cd7d9a04c1d3de19d77822
let evalWithBackwardsCompatibility = async (code: string): Promise<void> => {
  let f;
  try {
    // This can fail if the code has incorrect syntax.
    // Note that the code isn’t executed until we call the function.
    // This is good – this allows us to syntax check the code without side effects.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
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
    // or `export`, and will likely have that next time too. Swap over to a variation
    // of this function where we try module mode first, and script mode second.
    // `new Function(code)` isn’t free – spending time on that on each hot reload can
    // up to double the time.
    [evalWithBackwardsCompatibility, evalWithBackwardsCompatibility2] = [
      evalWithBackwardsCompatibility2,
      evalWithBackwardsCompatibility,
    ];
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  f();
};

// Like `evalWithBackwardsCompatibility` but tries the modes in the opposite order:
// Module first, then script.
let evalWithBackwardsCompatibility2 = async (code: string): Promise<void> => {
  try {
    await evalAsModule(code);
  } catch (moduleError) {
    // If eval-ing as a module fails, try script mode.
    // Note that this is not 100 % clean: Every line but the last might succeed,
    // and then the very last line might be `this.FOO = 1337`, which then fails
    // as `this` is `undefined` in modules. Then trying script mode is going to
    // succeed, but in practice all the code ran twice. That should be fine though –
    // an unnecessary hot reload shouldn’t cause any trouble. One known effect
    // is that the green animation does not appear. However, since we flip back the
    // functions it’s going to work next time. And I don’t think it’s very likely
    // this will happen. And in the next major version, script mode eval-ing will
    // be removed anyway.
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const f = new Function(code);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      f();
    } catch (scriptError) {
      throw new Error(
        `Error when evaluated as a module:\n\n${unknownErrorToString(moduleError)}\n\nError when evaluated as a script:\n\n${unknownErrorToString(scriptError)}`,
      );
    }
    // Swap back to trying script mode before module mode, as that succeeded better.
    [evalWithBackwardsCompatibility, evalWithBackwardsCompatibility2] = [
      evalWithBackwardsCompatibility2,
      evalWithBackwardsCompatibility,
    ];
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
  data: unknown,
): ParseWebSocketMessageDataResult {
  const decoderResult = decodeWebSocketToClientMessage(data);
  switch (decoderResult.tag) {
    case "DecoderError":
      return {
        tag: "Error",
        message: `Failed to decode web socket message sent from the server:\n${Codec.format(
          decoderResult.error,
        )}`,
      };
    case "Valid":
      return {
        tag: "Success",
        message: decoderResult.value,
      };
  }
}

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
    reasons.length === 1 && first !== undefined && first[1].length === 1
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
        .toLowerCase(),
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
        typeof child === "string" ? document.createTextNode(child) : child,
      );
    }
  }

  return element;
}

type Info = {
  version: string;
  webSocketUrl: URL;
  targetName: string;
  originalCompilationMode: CompilationModeWithProxy;
  debugModeToggled: Toggled;
};

function renderWithoutDomElements(model: Model, info: Info): string {
  const statusData = statusIconAndText(model);
  return `${statusData.icon} elm-watch: ${statusData.status} ${formatTime(
    model.status.date,
  )} (${info.targetName})`;
}

function render(
  getNow: GetNow,
  targetRoot: HTMLElement,
  dispatch: (msg: Msg) => void,
  model: Model,
  info: Info,
  manageFocus: boolean,
): void {
  targetRoot.replaceChildren(
    view(
      (msg) => {
        dispatch({ tag: "UiMsg", date: getNow(), msg });
      },
      model,
      info,
    ),
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
  envNotSet: "envNotSet",
  errorLocationButton: "errorLocationButton",
  errorTitle: "errorTitle",
  expandedUiContainer: "expandedUiContainer",
  flash: "flash",
  overlay: "overlay",
  overlayCloseButton: "overlayCloseButton",
  root: "root",
  rootBottomHalf: "rootBottomHalf",
  shortStatusContainer: "shortStatusContainer",
  targetName: "targetName",
  targetRoot: "targetRoot",
};

function getStatusFlashType({
  statusType,
  statusTypeChanged,
  hasReceivedHotReload,
  uiRelatedUpdate,
  errorOverlayVisible,
}: {
  statusType: StatusType;
  statusTypeChanged: boolean;
  hasReceivedHotReload: boolean;
  uiRelatedUpdate: boolean;
  errorOverlayVisible: boolean;
}): FlashType | undefined {
  switch (statusType) {
    case "Success":
      return statusTypeChanged && hasReceivedHotReload ? "success" : undefined;
    case "Error":
      return errorOverlayVisible
        ? statusTypeChanged && hasReceivedHotReload
          ? "error"
          : undefined
        : uiRelatedUpdate
          ? undefined
          : "error";
    case "Waiting":
      return undefined;
  }
}

type FlashType = "error" | "success";

function flash(elements: Elements, flashType: FlashType): void {
  for (const element of elements.targetRoot.querySelectorAll(
    `.${CLASS.flash}`,
  )) {
    element.setAttribute("data-flash", flashType);
  }
}

const CHEVRON_UP = "▲";
const CHEVRON_DOWN = "▼";

const CSS = `
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

.${CLASS.overlay} {
  position: fixed;
  z-index: -2;
  inset: 0;
  overflow-y: auto;
  padding: 2ch 0;
  user-select: text;
}

.${CLASS.overlayCloseButton} {
  position: fixed;
  z-index: -1;
  top: 0;
  right: 0;
  appearance: none;
  padding: 1em;
  border: none;
  border-radius: 0;
  background: none;
  cursor: pointer;
  font-size: 1.25em;
  filter: drop-shadow(0 0 0.125em var(--backgroundColor));
}

.${CLASS.overlayCloseButton}::before,
.${CLASS.overlayCloseButton}::after {
  content: "";
  display: block;
  position: absolute;
  top: 50%;
  left: 50%;
  width: 0.125em;
  height: 1em;
  background-color: var(--foregroundColor);
  transform: translate(-50%, -50%) rotate(45deg);
}

.${CLASS.overlayCloseButton}::after {
  transform: translate(-50%, -50%) rotate(-45deg);
}

.${CLASS.overlay},
.${CLASS.overlay} pre {
  font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
}

.${CLASS.overlay} details {
  --border-thickness: 0.125em;
  border-top: var(--border-thickness) solid;
  margin: 2ch 0;
}

.${CLASS.overlay} summary {
  cursor: pointer;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 0 2ch;
  word-break: break-word;
}

.${CLASS.overlay} summary::-webkit-details-marker {
  display: none;
}

.${CLASS.overlay} summary::marker {
  content: none;
}

.${CLASS.overlay} summary > * {
  pointer-events: auto;
}

.${CLASS.errorTitle} {
  display: inline-block;
  font-weight: bold;
  --padding: 1ch;
  padding: 0 var(--padding);
  transform: translate(calc(var(--padding) * -1), calc(-50% - var(--border-thickness) / 2));
}

.${CLASS.errorTitle}::before {
  content: "${CHEVRON_DOWN}";
  display: inline-block;
  margin-right: 1ch;
  transform: translateY(-0.0625em);
}

details[open] > summary > .${CLASS.errorTitle}::before {
  content: "${CHEVRON_UP}";
}

.${CLASS.errorLocationButton} {
  appearance: none;
  padding: 0;
  border: none;
  border-radius: 0;
  background: none;
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}

.${CLASS.overlay} pre {
  margin: 0;
  padding: 2ch;
  overflow-x: auto;
}

.${CLASS.root} {
  all: initial;
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

.${CLASS.envNotSet} {
  display: grid;
  gap: 0.75em;
  margin: 2em 0;
}

.${CLASS.envNotSet},
.${CLASS.root} pre {
  border-left: 0.25em solid var(--grey);
  padding-left: 0.5em;
}

.${CLASS.root} pre {
  margin: 0;
  white-space: pre-wrap;
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

[data-flash]::before {
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

[data-flash="error"]::before {
  background-color: #eb0000;
}

[data-flash="success"]::before {
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
  [data-flash]::before {
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
    ...statusIconAndText(model),
    ...viewStatus(dispatch, model, info),
  };

  return h(
    HTMLDivElement,
    { className: CLASS.container },
    model.uiExpanded
      ? viewExpandedUi(
          model.status,
          statusData,
          info,
          model.browserUiPosition,
          dispatch,
        )
      : undefined,
    h(
      HTMLDivElement,
      {
        className: CLASS.shortStatusContainer,
        // Placed on the div to increase clickable area.
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
          model.uiExpanded ? CHEVRON_UP : CHEVRON_DOWN,
          model.uiExpanded ? "Collapse elm-watch" : "Expand elm-watch",
        ),
      ),
      compilationModeIcon(model.compilationMode),
      icon(statusData.icon, statusData.status, {
        className: CLASS.flash,
        onanimationend: (event) => {
          // The animations are designed to work even without this (they
          // stay on the last frame). We also have `pointer-events: none`.
          // But remove the absolutely positioned animation element just
          // in case.
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.removeAttribute("data-flash");
          }
        },
      }),
      h(
        HTMLTimeElement,
        { dateTime: model.status.date.toISOString() },
        formatTime(model.status.date),
      ),
      h(HTMLSpanElement, { className: CLASS.targetName }, TARGET_NAME),
    ),
  );
}

function icon(
  emoji: string,
  alt: string,
  props?: Partial<HTMLSpanElement>,
): HTMLElement {
  return h(
    HTMLSpanElement,
    { attrs: { "aria-label": alt }, ...props },
    h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, emoji),
  );
}

function viewExpandedUi(
  status: Status,
  statusData: StatusData,
  info: Info,
  browserUiPosition: BrowserUiPosition,
  dispatch: (msg: UiMsg) => void,
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
        `${formatDate(status.date)} ${formatTime(status.date)}`,
      ),
    ],
    ["status", statusData.status],
    ...statusData.dl,
  ];

  const browserUiPositionSendKey = statusToSpecialCaseSendKey(status);

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
      ]),
    ),
    ...statusData.content,
    browserUiPositionSendKey === undefined
      ? undefined
      : viewBrowserUiPositionChooser(
          browserUiPosition,
          dispatch,
          browserUiPositionSendKey,
        ),
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
  sendKey: SendKey,
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
            arrow,
          );
    }),
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

function statusIconAndText(model: Model): Pick<StatusData, "icon" | "status"> {
  switch (model.status.tag) {
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

    case "ElmJsonError":
      return {
        icon: "🚨",
        status: "elm.json or inputs error",
      };

    case "EvalError":
      return {
        icon: "⛔️",
        status: "Eval error",
      };

    case "Idle":
      return {
        icon: "✅",
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
      return model.elmCompiledTimestamp ===
        model.elmCompiledTimestampBeforeReload
        ? {
            icon: "❌",
            status: "Reload trouble",
          }
        : {
            icon: "⏳",
            status: "Waiting for reload",
          };
  }
}

function viewStatus(
  dispatch: (msg: UiMsg) => void,
  model: Model,
  info: Info,
): Pick<StatusData, "content" | "dl"> {
  const { status, compilationMode } = model;
  switch (status.tag) {
    case "Busy":
      return {
        dl: [],
        content: [
          ...viewCompilationModeChooser({
            dispatch,
            sendKey: undefined,
            compilationMode,
            // Avoid the warning flashing by when switching modes (which is usually very fast).
            warnAboutCompilationModeMismatch: false,
            info,
          }),
          ...(status.errorOverlay === undefined
            ? []
            : [viewErrorOverlayToggleButton(dispatch, status.errorOverlay)]),
        ],
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
          viewErrorOverlayToggleButton(dispatch, status.errorOverlay),
          ...(status.openEditorError === undefined
            ? []
            : viewOpenEditorError(status.openEditorError)),
        ],
      };

    case "Connecting":
      return {
        dl: [
          ["attempt", status.attemptNumber.toString()],
          ["sleep", printRetryWaitMs(status.attemptNumber)],
        ],
        content: [
          ...viewHttpsInfo(info.webSocketUrl),
          h(HTMLButtonElement, { disabled: true }, "Connecting web socket…"),
        ],
      };

    case "ElmJsonError":
      return {
        dl: [],
        content: [
          h(HTMLPreElement, { style: { minWidth: "80ch" } }, status.error),
        ],
      };

    case "EvalError":
      return {
        dl: [],
        content: [
          h(
            HTMLParagraphElement,
            {},
            "Check the console in the browser developer tools to see errors!",
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
          ...viewHttpsInfo(info.webSocketUrl),
          h(
            HTMLButtonElement,
            {
              onclick: () => {
                dispatch({ tag: "PressedReconnectNow" });
              },
            },
            "Reconnect web socket now",
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
            "I ran into an unexpected error! This is the error message:",
          ),
          h(HTMLPreElement, {}, status.message),
        ],
      };

    case "WaitingForReload":
      return {
        dl: [],
        content:
          model.elmCompiledTimestamp === model.elmCompiledTimestampBeforeReload
            ? [
                "A while ago I reloaded the page to get new compiled JavaScript.",
                "But it looks like after the last page reload I got the same JavaScript as before, instead of new stuff!",
                `The old JavaScript was compiled ${new Date(
                  model.elmCompiledTimestamp,
                ).toLocaleString()}, and so was the JavaScript currently running.`,
                "I currently need to reload the page again, but fear a reload loop if I try.",
                "Do you have accidental HTTP caching enabled maybe?",
                "Try hard refreshing the page and see if that helps, and consider disabling HTTP caching during development.",
              ].map((text) => h(HTMLParagraphElement, {}, text))
            : [h(HTMLParagraphElement, {}, "Waiting for other targets…")],
      };
  }
}

function viewErrorOverlayToggleButton(
  dispatch: (msg: UiMsg) => void,
  errorOverlay: ErrorOverlay,
): HTMLElement {
  return h(
    HTMLButtonElement,
    {
      attrs: {
        "data-test-id": errorOverlay.openErrorOverlay
          ? "HideErrorOverlayButton"
          : "ShowErrorOverlayButton",
      },
      onclick: () => {
        dispatch({
          tag: "ChangedOpenErrorOverlay",
          openErrorOverlay: !errorOverlay.openErrorOverlay,
        });
      },
    },
    errorOverlay.openErrorOverlay ? "Hide errors" : "Show errors",
  );
}

function viewOpenEditorError(error: OpenEditorError): Array<HTMLElement> {
  switch (error.tag) {
    case "EnvNotSet":
      return [
        h(
          HTMLDivElement,
          { className: CLASS.envNotSet },
          h(
            HTMLParagraphElement,
            {},
            "ℹ️ Clicking error locations only works if you set it up.",
          ),
          h(
            HTMLParagraphElement,
            {},
            "Check this out: ",
            h(
              HTMLAnchorElement,
              {
                href: "https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations",
                target: "_blank",
                rel: "noreferrer",
              },
              h(
                HTMLElement,
                { localName: "strong" },
                "Clickable error locations",
              ),
            ),
          ),
        ),
      ];

    case "InvalidFilePath":
    case "CommandFailed":
      return [
        h(
          HTMLParagraphElement,
          {},
          h(
            HTMLElement,
            { localName: "strong" },
            "Opening the location in your editor failed!",
          ),
        ),
        h(HTMLPreElement, {}, error.message),
      ];
  }
}

function compilationModeIcon(
  compilationMode: CompilationModeWithProxy,
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

function printWebSocketUrl(url: URL): string {
  const hostname = url.hostname.endsWith(".localhost")
    ? "localhost"
    : url.hostname;
  return `${url.protocol}//${hostname}:${url.port}${url.pathname}`;
}

function viewHttpsInfo(webSocketUrl: URL): Array<HTMLElement> {
  return webSocketUrl.protocol === "wss:"
    ? [
        h(
          HTMLParagraphElement,
          {},
          h(HTMLElement, { localName: "strong" }, "Having trouble connecting?"),
        ),
        h(HTMLParagraphElement, {}, "Setting up HTTPS can be a bit tricky."),
        h(
          HTMLParagraphElement,
          {},
          "Read all about ",
          h(
            HTMLAnchorElement,
            {
              href: "https://lydell.github.io/elm-watch/https/",
              target: "_blank",
              rel: "noreferrer",
            },
            "HTTPS with elm-watch",
          ),
          ".",
        ),
      ]
    : [];
}

type CompilationModeOption = {
  mode: CompilationMode;
  name: string;
  toggled: Toggled;
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

const noDebuggerNoAppsReason =
  "The Elm debugger cannot be enabled until at least one Elm app has been initialized. (Check the browser console for errors if you expected an Elm app to be initialized by now.)";

function noDebuggerReason(noDebuggerProgramTypes: Set<ProgramType>): string {
  return `The Elm debugger isn't supported by ${humanList(
    Array.from(noDebuggerProgramTypes, (programType) => `\`${programType}\``),
    "and",
  )} programs.`;
}

function reloadReasonToString(reason: ReloadReasonWithModuleName): string {
  switch (reason.tag) {
    case "FlagsTypeChanged":
      return `the flags type in \`${reason.moduleName}\` changed and now the passed flags aren't correct anymore. The idea is to try to run with new flags!\nThis is the error:\n${reason.jsonErrorMessage}`;
    case "HotReloadCaughtError":
      return `hot reload for \`${reason.moduleName}\` failed, probably because of incompatible model changes.\nThis is the error:\n${unknownErrorToString(reason.caughtError)}`;
    case "InitReturnValueChanged":
      return `\`${reason.moduleName}.init\` returned something different than last time. Let's start fresh!`;
    case "MessageTypeChangedInDebugMode":
      return `the message type in \`${reason.moduleName}\` changed in debug mode ("debug metadata" changed).`;
    case "NewPortAdded":
      return `a new port '${reason.name}' was added. The idea is to give JavaScript code a chance to set it up!`;
    case "ProgramTypeChanged":
      return `\`${reason.moduleName}.main\` changed from \`${reason.previousProgramType}\` to \`${reason.newProgramType}\`.`;
  }
}

// This is slightly different from `unknownErrorToString` in `Helpers.ts`, which only
// needs to support Node.js (V8). This one supports browsers having different `.stack`.
function unknownErrorToString(error: unknown): string {
  return error instanceof Error
    ? error.stack !== undefined
      ? // In Chrome (V8), `.stack` looks like this: `${errorConstructorName}: ${message}\n${stack}`.
        // In Firefox and Safari, `.stack` is only the stacktrace (does not contain the message).
        error.stack.includes(error.message)
        ? error.stack
        : `${error.message}\n${error.stack}`
      : error.message
    : Codec.repr(error);
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
  const compilationModes: Array<CompilationModeOption> = [
    { mode: "debug", name: "Debug", toggled: info.debugModeToggled },
    { mode: "standard", name: "Standard", toggled: { tag: "Enabled" } },
    { mode: "optimize", name: "Optimize", toggled: { tag: "Enabled" } },
  ];

  return [
    h(
      HTMLFieldSetElement,
      { disabled: sendKey === undefined },
      h(HTMLLegendElement, {}, "Compilation mode"),
      ...compilationModes.map(({ mode, name, toggled: status }) => {
        const nameWithIcon = h(
          HTMLSpanElement,
          { className: CLASS.compilationModeWithIcon },
          name,
          mode === selectedMode ? compilationModeIcon(mode) : undefined,
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
                ? null
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
                      `Note: The code currently running is in ${ORIGINAL_COMPILATION_MODE} mode.`,
                    )
                  : undefined,
              ]
            : [
                nameWithIcon,
                h(HTMLElement, { localName: "small" }, status.reason),
              ]),
        );
      }),
    ),
  ];
}

const DATA_TARGET_NAMES = "data-target-names";

function updateErrorOverlay(
  targetName: string,
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey | undefined,
  errors: Map<string, OverlayError>,
  overlay: HTMLElement,
  overlayCloseButton: HTMLElement,
): void {
  const existingErrorElements = new Map<
    string,
    { targetNames: Set<string>; element: Element }
  >(
    Array.from(overlay.children, (element) => [
      element.id,
      {
        targetNames: new Set(
          // Newline is not a valid target name character.
          (element.getAttribute(DATA_TARGET_NAMES) ?? "").split("\n"),
        ),
        element,
      },
    ]),
  );

  for (const [id, { targetNames, element }] of existingErrorElements) {
    if (targetNames.has(targetName) && !errors.has(id)) {
      targetNames.delete(targetName);
      if (targetNames.size === 0) {
        element.remove();
      } else {
        element.setAttribute(DATA_TARGET_NAMES, [...targetNames].join("\n"));
      }
    }
  }

  let previousElement: Element | undefined = undefined;

  for (const [id, error] of errors) {
    const maybeExisting = existingErrorElements.get(id);
    if (maybeExisting === undefined) {
      const element = viewOverlayError(
        targetName,
        dispatch,
        sendKey,
        id,
        error,
      );
      if (previousElement === undefined) {
        overlay.prepend(element);
      } else {
        previousElement.after(element);
      }
      overlay.style.backgroundColor = error.backgroundColor;
      overlayCloseButton.style.setProperty(
        "--foregroundColor",
        error.foregroundColor,
      );
      overlayCloseButton.style.setProperty(
        "--backgroundColor",
        error.backgroundColor,
      );
      previousElement = element;
    } else {
      if (!maybeExisting.targetNames.has(targetName)) {
        maybeExisting.element.setAttribute(
          DATA_TARGET_NAMES,
          [...maybeExisting.targetNames, targetName].join("\n"),
        );
      }
      previousElement = maybeExisting.element;
    }
  }

  const hidden = !overlay.hasChildNodes();
  overlay.hidden = hidden;
  overlayCloseButton.hidden = hidden;

  // Avoid drawing the close button on top of a scrollbar.
  overlayCloseButton.style.right = `${
    overlay.offsetWidth - overlay.clientWidth
  }px`;
}

function viewOverlayError(
  targetName: string,
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey | undefined,
  id: string,
  error: OverlayError,
): HTMLElement {
  return h(
    HTMLDetailsElement,
    {
      open: true,
      id,
      style: {
        backgroundColor: error.backgroundColor,
        color: error.foregroundColor,
      },
      attrs: {
        [DATA_TARGET_NAMES]: targetName,
      },
    },
    h(
      HTMLElement,
      { localName: "summary" },
      h(
        HTMLSpanElement,
        {
          className: CLASS.errorTitle,
          style: {
            backgroundColor: error.backgroundColor,
          },
        },
        error.title,
      ),
      error.location === undefined
        ? undefined
        : h(
            HTMLParagraphElement,
            {},
            viewErrorLocation(dispatch, sendKey, error.location),
          ),
    ),
    h(HTMLPreElement, { innerHTML: error.htmlContent }),
  );
}

function viewErrorLocation(
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey | undefined,
  location: ErrorLocation,
): HTMLElement | string {
  switch (location.tag) {
    case "FileOnly":
      return viewErrorLocationButton(
        dispatch,
        sendKey,
        {
          file: location.file,
          line: 1,
          column: 1,
        },
        location.file,
      );

    case "FileWithLineAndColumn": {
      return viewErrorLocationButton(
        dispatch,
        sendKey,
        location,
        `${location.file}:${location.line}:${location.column}`,
      );
    }

    case "Target":
      return `Target: ${location.targetName}`;
  }
}

function viewErrorLocationButton(
  dispatch: (msg: UiMsg) => void,
  sendKey: SendKey | undefined,
  location: {
    file: AbsolutePath;
    line: number;
    column: number;
  },
  text: string,
): HTMLButtonElement | string {
  return sendKey === undefined
    ? text
    : h(
        HTMLButtonElement,
        {
          className: CLASS.errorLocationButton,
          onclick: () => {
            dispatch({
              tag: "PressedOpenEditor",
              file: location.file,
              line: location.line,
              column: location.column,
              sendKey,
            });
          },
        },
        text,
      );
}

function renderMockStatuses(
  getNow: GetNow,
  elements: Elements | undefined,
): void {
  if (elements === undefined) {
    return;
  }

  const date = getNow();

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
      errorOverlay: undefined,
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
      errorOverlay: {
        errors: new Map(),
        openErrorOverlay: false,
      },
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
      errorOverlay: {
        errors: new Map(),
        openErrorOverlay: false,
      },
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
    const targetRoot = createTargetRoot(targetName);
    elements.root.append(targetRoot);
    const model: Model = {
      status,
      compilationMode: status.compilationMode ?? "standard",
      browserUiPosition: "BottomLeft",
      lastBrowserUiPositionChangeDate: undefined,
      elmCompiledTimestamp: 0,
      elmCompiledTimestampBeforeReload: undefined,
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
      false,
    );
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
