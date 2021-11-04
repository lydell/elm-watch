import * as Decode from "tiny-decoders";

import { formatDate, formatTime } from "../src/Helpers";
import { runTeaProgram } from "../src/TeaProgram";
import type {
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

const VERSION = "%VERSION%";
const TARGET_NAME = "%TARGET_NAME%";
const INITIAL_ELM_COMPILED_TIMESTAMP = Number(
  "%INITIAL_ELM_COMPILED_TIMESTAMP%"
);
const COMPILATION_MODE = "%COMPILATION_MODE%" as CompilationModeWithProxy;
const WEBSOCKET_PORT = "%WEBSOCKET_PORT%";
const CONTAINER_ID = "elmWatch";

type Mutable = {
  webSocket: WebSocket;
};

type Msg =
  | {
      tag: "EvalErrored";
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
  elmCompiledTimestamp: number;
  uiExpanded: boolean;
};

type Cmd =
  | {
      tag: "Eval";
      code: string;
    }
  | {
      tag: "Reconnect";
      elmCompiledTimestamp: number;
    }
  | {
      tag: "ReloadPage";
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
      tag: "SleepBeforeReconnect";
      attemptNumber: number;
    };

type Status =
  | {
      tag: "Busy";
      date: Date;
      compilationMode?: CompilationMode;
    }
  | {
      tag: "CompileError";
      date: Date;
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
    };

type SendKey = typeof SEND_KEY_DO_NOT_USE_ALL_THE_TIME;

const SEND_KEY_DO_NOT_USE_ALL_THE_TIME: unique symbol = Symbol(
  "This value is supposed to only be obtained via `Status`."
);

function run(): void {
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

  const existingTargetRoot = Array.from(root.children).find(
    (element) => element.getAttribute("data-target") === TARGET_NAME
  );

  if (existingTargetRoot !== undefined) {
    return;
  }

  const targetRoot = createTargetRoot(TARGET_NAME);

  const getNow: GetNow = () => new Date();

  void runTeaProgram<Mutable, Msg, Model, Cmd, never>({
    initMutable: initMutable(getNow),
    init: init(getNow()),
    update: (msg: Msg, model: Model): [Model, Array<Cmd>] => {
      const [newModel, cmds] = update(msg, model);
      return [
        newModel,
        [
          ...cmds,
          { tag: "Render", model: newModel, manageFocus: msg.tag === "UiMsg" },
        ],
      ];
    },
    runCmd: runCmd(getNow, targetRoot),
  });

  // This is great when working on the styling of all statuses.
  // When this call is commented out, esbuild won’t include the
  // `renderMockStatuses` function in the output.
  renderMockStatuses(root);
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
  container.style.left = "0";
  container.style.bottom = "0";

  const shadowRoot = container.attachShadow({ mode: "open" });
  shadowRoot.append(h(HTMLStyleElement, {}, CSS));
  document.documentElement.append(container);

  return container;
}

function createTargetRoot(targetName: string): HTMLElement {
  return h(HTMLDivElement, {
    className: CLASS.targetRoot,
    attrs: { "data-target": targetName },
  });
}

const initMutable =
  (getNow: GetNow) =>
  (dispatch: (msg: Msg) => void): Mutable => {
    window.addEventListener("focus", () => {
      dispatch({ tag: "FocusedTab" });
    });

    window.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        dispatch({ tag: "PageVisibilityChangedToVisible", date: getNow() });
      }
    });

    return {
      webSocket: initWebSocket(
        getNow,
        INITIAL_ELM_COMPILED_TIMESTAMP,
        dispatch
      ),
    };
  };

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

  webSocket.addEventListener("error", (event) => {
    // eslint-disable-next-line no-console
    console.warn("elm-watch: Got a WebSocket error event:", event);
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

const init = (date: Date): [Model, Array<Cmd>] => {
  const model: Model = {
    status: { tag: "Connecting", date, attemptNumber: 1 },
    elmCompiledTimestamp: INITIAL_ELM_COMPILED_TIMESTAMP,
    uiExpanded: false,
  };
  return [model, [{ tag: "Render", model, manageFocus: false }]];
};

function update(msg: Msg, model: Model): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "EvalErrored":
      return [
        {
          ...model,
          status: { tag: "EvalError", date: msg.date },
          uiExpanded: true,
        },
        [],
      ];

    case "FocusedTab":
      return [
        model,
        model.status.tag === "Idle"
          ? [
              {
                tag: "SendMessage",
                message: { tag: "FocusedTab" },
                sendKey: model.status.sendKey,
              },
            ]
          : [],
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
    case "ChangedCompilationMode":
      return [
        {
          ...model,
          status: { tag: "Busy", date, compilationMode: msg.compilationMode },
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
    case "StatusChanged": {
      const [status, uiChange] = statusChanged(date, msg);
      return [
        {
          ...model,
          status,
          uiExpanded: uiChange === "ExpandUI" ? true : model.uiExpanded,
        },
        [],
      ];
    }

    case "SuccessfullyCompiled":
      return msg.compilationMode !== COMPILATION_MODE
        ? [model, [{ tag: "ReloadPage" }]]
        : [
            {
              ...model,
              status: {
                tag: "Idle",
                date,
                sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
              },
              elmCompiledTimestamp: msg.elmCompiledTimestamp,
            },
            [{ tag: "Eval", code: msg.code }],
          ];
  }
}

function statusChanged(
  date: Date,
  { status }: StatusChanged
): [Status, "ExpandUI" | "KeepUI"] {
  switch (status.tag) {
    case "AlreadyUpToDate":
      return [
        { tag: "Idle", date, sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME },
        "KeepUI",
      ];

    case "Busy":
      return [
        { tag: "Busy", date, compilationMode: status.compilationMode },
        "KeepUI",
      ];

    case "ClientError":
      return [
        { tag: "UnexpectedError", date, message: status.message },
        "ExpandUI",
      ];

    case "CompileError":
      return [{ tag: "CompileError", date }, "KeepUI"];
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

const runCmd =
  (getNow: GetNow, targetRoot: HTMLElement) =>
  (cmd: Cmd, mutable: Mutable, dispatch: (msg: Msg) => void): void => {
    switch (cmd.tag) {
      case "Eval": {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const f = new Function(cmd.code);
        try {
          f();
        } catch (unknownError) {
          void Promise.reject(unknownError);
          dispatch({ tag: "EvalErrored", date: getNow() });
        }
        return;
      }

      case "Reconnect":
        mutable.webSocket = initWebSocket(
          getNow,
          cmd.elmCompiledTimestamp,
          dispatch
        );
        return;

      case "ReloadPage":
        window.location.reload();
        return;

      case "Render":
        render(
          getNow,
          targetRoot,
          dispatch,
          cmd.model,
          {
            version: VERSION,
            webSocketUrl: mutable.webSocket.url,
            targetName: TARGET_NAME,
            compilationMode: COMPILATION_MODE,
            debuggerModeStatus: checkCanEnableDebugger(),
          },
          cmd.manageFocus
        );
        return;

      case "SendMessage":
        mutable.webSocket.send(JSON.stringify(cmd.message));
        return;

      case "SleepBeforeReconnect":
        setTimeout(() => {
          if (document.visibilityState === "visible") {
            dispatch({ tag: "SleepBeforeReconnectDone", date: getNow() });
          }
        }, retryWaitMs(cmd.attemptNumber));
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
    const errorMessage =
      unknownError instanceof Decode.DecoderError
        ? unknownError.format()
        : unknownError instanceof Error
        ? unknownError.message
        : Decode.repr(unknownError);
    return {
      tag: "Error",
      message: `Failed to decode web socket message sent from the server:\n${errorMessage}`,
    };
  }
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

function checkCanEnableDebugger(): Toggled {
  let programTypes;
  try {
    programTypes = ProgramTypes(window);
  } catch {
    return { tag: "Enabled" };
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
    ? { tag: "Disabled", reason: noDebuggerReason(new Set(noDebugger)) }
    : { tag: "Enabled" };
}

function emptyNode(node: Node): void {
  while (node.firstChild !== null) {
    node.removeChild(node.firstChild);
  }
}

function h<T extends HTMLElement>(
  t: new () => T,
  {
    attrs,
    localName,
    ...props
  }: Partial<T & { attrs: Record<string, string> }>,
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
  compilationMode: CompilationModeWithProxy;
  debuggerModeStatus: Toggled;
};

function render(
  getNow: GetNow,
  targetRoot: HTMLElement,
  dispatch: (msg: Msg) => void,
  model: Model,
  info: Info,
  manageFocus: boolean
): void {
  emptyNode(targetRoot);

  targetRoot.append(
    view(
      (msg) => {
        dispatch({ tag: "UiMsg", date: getNow(), msg });
      },
      model,
      info
    )
  );

  const firstFocusableElement = targetRoot.querySelector(`button, [tabindex]`);
  if (manageFocus && firstFocusableElement instanceof HTMLElement) {
    firstFocusableElement.focus();
  }
}

const CLASS = {
  chevronButton: "chevronButton",
  container: "container",
  expandedUiContainer: "expandedUiContainer",
  shortStatusContainer: "shortStatusContainer",
  targetName: "targetName",
  targetRoot: "targetRoot",
  root: "root",
};

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
  margin: 0;
}

fieldset {
  display: grid;
  gap: 0.25em;
  margin: 0;
  border: 1px solid var(--grey);
  padding: 0.25em 0.75em 0.5em;
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

.${CLASS.root} {
  --grey: #767676;
  display: flex;
  flex-direction: column;
  align-items: start;
  gap: 0.125em;
  overflow-y: auto;
  max-height: 100vh;
  color: black;
  font-family: system-ui;
}

.${CLASS.targetRoot}:only-of-type .${CLASS.targetName} {
  display: none;
}

.${CLASS.container} {
  background-color: white;
}

.${CLASS.expandedUiContainer} {
  padding: 0.75em 1em;
  display: grid;
  gap: 0.75em;
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

.${CLASS.shortStatusContainer} {
  line-height: 1;
  padding: 0.25em;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 0.25em;
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
  model: Model,
  info: Info
): HTMLElement {
  const statusData = viewStatus(dispatch, model.status, info);

  return h(
    HTMLDivElement,
    { className: CLASS.container },
    model.uiExpanded
      ? viewExpandedUi(model.status, statusData, info)
      : undefined,
    h(
      HTMLSpanElement,
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
      info.compilationMode === "optimize"
        ? icon("⚡️", "Optimize mode")
        : undefined,
      icon(statusData.icon, statusData.status),
      h(
        HTMLTimeElement,
        { dateTime: model.status.date.toISOString() },
        formatTime(model.status.date)
      ),
      h(HTMLSpanElement, { className: CLASS.targetName }, TARGET_NAME)
    )
  );
}

function icon(emoji: string, alt: string): HTMLElement {
  return h(
    HTMLSpanElement,
    { attrs: { "aria-label": alt } },
    h(HTMLSpanElement, { attrs: { "aria-hidden": "true" } }, emoji)
  );
}

function viewExpandedUi(
  status: Status,
  statusData: StatusData,
  info: Info
): HTMLElement {
  const items: Array<[string, HTMLElement | string]> = [
    ["target", info.targetName],
    ["elm-watch", info.version],
    ["web socket", new URL(info.webSocketUrl).origin],
    [
      "updated",
      h(
        HTMLTimeElement,
        { dateTime: status.date.toISOString() },
        `${formatDate(status.date)} ${formatTime(status.date)}`
      ),
    ],
    ["status", statusData.status],
    ...statusData.dl,
  ];

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
    ...statusData.content
  );
}

type StatusData = {
  icon: string;
  status: string;
  dl: Array<[string, string]>;
  content: Array<HTMLElement>;
};

function viewStatus(
  dispatch: (msg: UiMsg) => void,
  status: Status,
  info: Info
): StatusData {
  switch (status.tag) {
    case "Busy":
      return {
        icon: "⏳",
        status: "Waiting for compilation",
        dl: [],
        content: [
          viewCompilationModeChooser({
            dispatch,
            sendKey: undefined,
            compilationMode: status.compilationMode ?? info.compilationMode,
            debuggerModeStatus: info.debuggerModeStatus,
            targetName: info.targetName,
          }),
        ],
      };

    case "CompileError":
      return {
        icon: "🚨",
        status: "Compilation error",
        dl: [],
        content: [
          h(HTMLParagraphElement, {}, "Check the terminal to see errors!"),
        ],
      };

    case "Connecting":
      return {
        icon: "🔌",
        status: "Web socket connecting",
        dl:
          status.attemptNumber > 1
            ? [["attempt", status.attemptNumber.toString()]]
            : [],
        content: [],
      };

    case "EvalError":
      return {
        icon: "⛔️",
        status: "Eval error",
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
        icon: "✅",
        status: "Successfully compiled",
        dl: [],
        content: [
          viewCompilationModeChooser({
            dispatch,
            sendKey: status.sendKey,
            compilationMode: info.compilationMode,
            debuggerModeStatus: info.debuggerModeStatus,
            targetName: info.targetName,
          }),
        ],
      };

    case "SleepingBeforeReconnect":
      return {
        icon: "🔌",
        status: "Sleeping before reconnecting",
        dl: [
          ["attempt", status.attemptNumber.toString()],
          ["sleep", `${retryWaitMs(status.attemptNumber) / 1000} seconds`],
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
        icon: "❌",
        status: "Unexpected error",
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
  }
}

type CompilationModeOption = {
  mode: CompilationMode;
  name: string;
  status: Toggled;
};

type Toggled =
  | {
      tag: "Disabled";
      reason: string;
    }
  | {
      tag: "Enabled";
    };

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
    : `${list.slice(0, length - 2).join(",")}, ${list
        .slice(-2)
        .join(` ${joinWord} `)}`;
}

function viewCompilationModeChooser({
  dispatch,
  sendKey,
  compilationMode: selectedMode,
  debuggerModeStatus,
  targetName,
}: {
  dispatch: (msg: UiMsg) => void;
  sendKey: SendKey | undefined;
  compilationMode: CompilationModeWithProxy;
  debuggerModeStatus: Toggled;
  targetName: string;
}): HTMLElement {
  const compilationModes: Array<CompilationModeOption> = [
    {
      mode: "debug",
      name: "Debug",
      status: debuggerModeStatus,
    },
    { mode: "standard", name: "Standard", status: { tag: "Enabled" } },
    { mode: "optimize", name: "Optimize", status: { tag: "Enabled" } },
  ];

  return h(
    HTMLFieldSetElement,
    { disabled: sendKey === undefined },
    h(HTMLLegendElement, {}, "Compilation mode"),
    ...compilationModes.map(({ mode, name, status }) =>
      h(
        HTMLLabelElement,
        { className: status.tag },
        h(HTMLInputElement, {
          type: "radio",
          name: `CompilationMode-${targetName}`,
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
          ? [name]
          : [name, h(HTMLElement, { localName: "small" }, status.reason)])
      )
    )
  );
}

function renderMockStatuses(root: Element): void {
  const info: Omit<Info, "targetName"> = {
    version: VERSION,
    webSocketUrl: "ws://localhost:53167",
    compilationMode: "standard",
    debuggerModeStatus: { tag: "Enabled" },
  };

  const mockStatuses: Record<
    string,
    Status & { info?: Omit<Info, "targetName"> }
  > = {
    Busy: {
      tag: "Busy",
      date: new Date(),
    },
    Idle: {
      tag: "Idle",
      date: new Date(),
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
    },
    "Really long target name that is annoying to work display correctly": {
      tag: "Idle",
      date: new Date(),
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
    },
    DisabledDebugger1: {
      tag: "Idle",
      date: new Date(),
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        debuggerModeStatus: {
          tag: "Disabled",
          reason: noDebuggerReason(new Set(["Html"])),
        },
      },
    },
    DisabledDebugger2: {
      tag: "Idle",
      date: new Date(),
      sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
      info: {
        ...info,
        debuggerModeStatus: {
          tag: "Disabled",
          reason: noDebuggerReason(new Set(["Html", "Platform.worker"])),
        },
      },
    },
    CompileError: {
      tag: "CompileError",
      date: new Date(),
    },
    Connecting: {
      tag: "Connecting",
      date: new Date(),
      attemptNumber: 1,
    },
    Connecting2: {
      tag: "Connecting",
      date: new Date(),
      attemptNumber: 2,
    },
    Connecting100: {
      tag: "Connecting",
      date: new Date(),
      attemptNumber: 100,
    },
    EvalError: {
      tag: "EvalError",
      date: new Date(),
    },
    SleepingBeforeReconnect: {
      tag: "SleepingBeforeReconnect",
      date: new Date(),
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
      date: new Date(),
    },
  };

  for (const [targetName, status] of Object.entries(mockStatuses)) {
    const targetRoot = createTargetRoot(targetName);
    const model: Model = {
      status,
      elmCompiledTimestamp: 0,
      uiExpanded: true,
    };
    render(
      () => new Date(),
      targetRoot,
      () => {
        // Ignore messages.
      },
      model,
      { ...(status.info ?? info), targetName },
      false
    );
    root.append(targetRoot);
  }
}

run();
