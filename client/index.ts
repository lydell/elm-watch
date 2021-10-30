import * as Decode from "tiny-decoders";

import { runTeaProgram } from "../src/TeaProgram";
import type { GetNow } from "../src/Types";
import {
  CompilationModeWithProxy,
  decodeWebSocketToClientMessage,
  StatusChanged,
  WebSocketToClientMessage,
  WebSocketToServerMessage,
} from "./WebSocketMessages";

const VERSION = "%VERSION%";
const TARGET_NAME = "%TARGET_NAME%";
const INITIAL_COMPILED_TIMESTAMP = Number("%INITIAL_COMPILED_TIMESTAMP%");
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
      tag: "WebSocketClosed";
      date: Date;
      reason: string;
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

type Model = {
  status: Status;
  compiledTimestamp: number;
};

type Cmd =
  | {
      tag: "Eval";
      code: string;
    }
  | {
      tag: "ReloadPage";
    }
  | {
      tag: "SendMessage";
      message: WebSocketToServerMessage;
      // This requires the “send key”. The idea is that this forces you to check
      // `Status` before sending.
      sendKey: SendKey;
    };

type Status =
  | {
      tag: "Busy";
      date: Date;
    }
  | {
      tag: "ClientError";
      message: string;
      date: Date;
    }
  | {
      tag: "CompileError";
      date: Date;
    }
  | {
      tag: "Connecting";
      date: Date;
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
      tag: "Reconnecting";
      date: Date;
      reason: string;
    }
  | {
      tag: "ServerError";
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
    throw new Error("TODO: No shadowRoot");
  }

  const existingTargetRoot = Array.from(shadowRoot.children).find(
    (element) => element.getAttribute("data-target") === TARGET_NAME
  );

  if (existingTargetRoot !== undefined) {
    return;
  }

  const targetRoot = document.createElement("div");
  targetRoot.setAttribute("data-target", TARGET_NAME);
  shadowRoot.append(targetRoot);

  const getNow: GetNow = () => new Date();

  void runTeaProgram<Mutable, Msg, Model, Cmd, never>({
    initMutable: initMutable(getNow),
    init: init(getNow()),
    update,
    runCmd: runCmd(getNow),
  });
}

function getOrCreateContainer(): HTMLElement {
  const existing = document.getElementById(CONTAINER_ID);

  if (existing !== null) {
    return existing;
  }

  const container = document.createElement("div");
  container.id = CONTAINER_ID;
  container.style.all = "unset";
  container.style.position = "fixed";
  container.style.zIndex = "2147483647"; // Maximum z-index supported by browsers.
  container.style.left = "0";
  container.style.bottom = "0";
  container.attachShadow({ mode: "open" });
  document.documentElement.append(container);
  return container;
}

const initMutable =
  (getNow: GetNow) =>
  (dispatch: (msg: Msg) => void): Mutable => ({
    webSocket: initWebSocket(getNow, INITIAL_COMPILED_TIMESTAMP, dispatch),
  });

function initWebSocket(
  getNow: GetNow,
  compiledTimestamp: number,
  dispatch: (msg: Msg) => void
): WebSocket {
  const url = new URL(`ws://${window.location.hostname}:${WEBSOCKET_PORT}/`);
  url.searchParams.set("elmWatchVersion", VERSION);
  url.searchParams.set("targetName", TARGET_NAME);
  url.searchParams.set("compiledTimestamp", compiledTimestamp.toString());

  const webSocket = new WebSocket(url);

  webSocket.addEventListener("open", () => {
    dispatch({ tag: "WebSocketConnected", date: getNow() });
  });

  webSocket.addEventListener("error", (event) => {
    // eslint-disable-next-line no-console
    console.warn("elm-watch: Got a WebSocket error event:", event);
  });

  webSocket.addEventListener("close", (event) => {
    dispatch({
      tag: "WebSocketClosed",
      date: getNow(),
      reason: event.reason,
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

const init = (date: Date): [Model, Array<Cmd>] => [
  {
    status: { tag: "Connecting", date },
    compiledTimestamp: INITIAL_COMPILED_TIMESTAMP,
  },
  [],
];

function update(msg: Msg, model: Model): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "EvalErrored":
      return [{ ...model, status: { tag: "EvalError", date: msg.date } }, []];

    case "WebSocketClosed":
      return [
        {
          ...model,
          status: { tag: "Reconnecting", date: msg.date, reason: msg.reason },
        },
        [],
      ];

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
                tag: "ServerError",
                date: msg.date,
                message: result.message,
              },
            },
            [],
          ];
      }
    }
  }
}

function onWebSocketToClientMessage(
  date: Date,
  msg: WebSocketToClientMessage,
  model: Model
): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "StatusChanged":
      return [{ ...model, status: statusChanged(date, msg) }, []];

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
              compiledTimestamp: msg.compiledTimestamp,
            },
            [{ tag: "Eval", code: msg.code }],
          ];
  }
}

function statusChanged(date: Date, { status }: StatusChanged): Status {
  switch (status.tag) {
    case "AlreadyUpToDate":
      return { tag: "Idle", date, sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME };

    case "Busy":
      return { tag: "Busy", date };

    case "ClientError":
      return { tag: "ClientError", date, message: status.message };

    case "CompileError":
      return { tag: "CompileError", date };
  }
}

const runCmd =
  (getNow: GetNow) =>
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

      case "ReloadPage":
        window.location.reload();
        return;

      case "SendMessage":
        mutable.webSocket.send(JSON.stringify(cmd.message));
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
      message:
        unknownError instanceof Decode.DecoderError
          ? unknownError.format()
          : unknownError instanceof Error
          ? unknownError.message
          : Decode.repr(unknownError),
    };
  }
}

run();
