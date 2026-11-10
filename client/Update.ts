// The pure parts of the client: `init` and `update` (and their types). The
// side effects live in client.ts. Keeping these separate makes it possible to
// unit test them, since importing client.ts starts the client.

import * as Codec from "tiny-decoders";

import type { NonEmptyArray } from "../src/NonEmptyArray.ts";
import type { CompilationModeWithProxy } from "../src/Types.ts";
import {
  type FlashType,
  type OverlayError,
  SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
  type SendKey,
  type Status,
  type UiMsg,
} from "./Ui.ts";
import {
  decodeWebSocketToClientMessage,
  type StatusChange,
  type WebSocketToClientMessage,
  type WebSocketToServerMessage,
} from "./WebSocketMessages.ts";

// Comes from `ClientConfig` (see client.ts).
export type UpdateConfig = {
  originalCompilationMode: CompilationModeWithProxy;
  initialElmCompiledTimestamp: number;
};

export type ReloadReason =
  | {
      tag: "ElmHotUnavailable";
    }
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
      tag: "PortDirectionChanged";
      name: string;
      newDirection: "incoming" | "outgoing";
    }
  | {
      tag: "PortTypeChanged";
      name: string;
    }
  | {
      tag: "ProgramTypeChanged";
      previousProgramType: ProgramType;
      newProgramType: ProgramType;
    };

export type ReloadReasonWithModuleName = ReloadReason & { moduleName: string };

export type ProgramType =
  | "Platform.worker"
  | "Browser.sandbox"
  | "Browser.element"
  | "Browser.document"
  | "Browser.application"
  | "Html";

export type ReloadStatus =
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

export type Msg =
  | {
      tag: "AppInit";
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
      attemptNumber: number;
      sleepStartDate: Date;
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

export type Model = {
  status: Status;
  compilationMode: CompilationModeWithProxy;
  elmCompiledTimestamp: number;
  elmCompiledTimestampBeforeReload: number | undefined;
};

export type Cmd =
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
      tag: "OpenPanel";
    }
  | {
      tag: "Reconnect";
      elmCompiledTimestamp: number;
    }
  | {
      tag: "Render";
      model: Model;
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
      sleepStartDate: Date;
    }
  | {
      tag: "TriggerReachedIdleState";
      reason: ReachedIdleStateReason;
    }
  | {
      tag: "UpdateErrorOverlay";
      errors: Map<string, OverlayError>;
      sendKey: SendKey | undefined;
      open: boolean;
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

export type ReachedIdleStateReason =
  | "AlreadyUpToDate"
  | "ClientError"
  | "CompileError"
  | "ElmJsonError"
  | "EvalErrored"
  | "EvalSucceeded"
  | "OpenEditorFailed"
  | "ReloadTrouble";

export function getErrors(
  status: Status,
): Map<string, OverlayError> | undefined {
  return "errors" in status ? status.errors : undefined;
}

export const init = (
  config: UpdateConfig,
  date: Date,
  elmCompiledTimestampBeforeReload: number | undefined,
): [Model, Array<Cmd>] => {
  const model: Model = {
    status: { tag: "Connecting", date, attemptNumber: 1 },
    compilationMode: config.originalCompilationMode,
    elmCompiledTimestamp: config.initialElmCompiledTimestamp,
    elmCompiledTimestampBeforeReload,
  };
  return [model, [{ tag: "Render", model }]];
};

export function update(
  config: UpdateConfig,
  msg: Msg,
  model: Model,
): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "AppInit":
      // Force a re-render, so the status icon can update. Need to create a new
      // model to trump the `===` check used to avoid re-renders.
      return [{ ...model }, []];

    case "EvalErrored":
      return [
        {
          ...model,
          status: { tag: "EvalError", date: msg.date },
        },
        [
          { tag: "OpenPanel" },
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
          // Send these commands regardless of current status, as long as we have a connection:
          // We want to prioritize the target due to the focus no matter what, and after waking
          // up on iOS we need to check the WebSocket connection no matter what as well. For
          // example, it’s possible to lock the phone while Busy, and then we miss the “done”
          // message, which makes us still have the Busy status when unlocking the phone.
          // While connecting, sending throws an error, and we would then never get a reply,
          // closing the new connection on timeout. While sleeping, we’ll reconnect anyway.
          ...(model.status.tag === "Connecting" ||
          model.status.tag === "SleepingBeforeReconnect"
            ? []
            : [
                {
                  tag: "SendMessage",
                  message: { tag: "FocusedTab" },
                  sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
                } as const,
                {
                  tag: "WebSocketTimeoutBegin",
                } as const,
              ]),
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
      return reconnect(model, msg.date, {
        force: false,
        attemptNumber: msg.attemptNumber,
        sleepStartDate: msg.sleepStartDate,
      });

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
          [
            {
              tag: "SleepBeforeReconnect",
              attemptNumber,
              sleepStartDate: msg.date,
            },
          ],
        ];
      }

    case "WebSocketConnected":
      return [
        {
          ...model,
          status: { tag: "Busy", date: msg.date, errors: undefined },
        },
        [],
      ];

    case "WebSocketMessageReceived": {
      const result = parseWebSocketMessageData(msg.data);
      switch (result.tag) {
        case "Success":
          return onWebSocketToClientMessage(
            config,
            msg.date,
            result.message,
            model,
          );

        case "Error":
          return [
            {
              ...model,
              status: {
                tag: "UnexpectedError",
                date: msg.date,
                message: result.message,
              },
            },
            [{ tag: "OpenPanel" }],
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
          status: {
            tag: "Busy",
            date,
            errors: getErrors(model.status),
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
  config: UpdateConfig,
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
            }
          : model,
        [
          model.status.tag === "CompileError"
            ? { tag: "OpenPanel" }
            : { tag: "NoCmd" },
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

    case "SuccessfullyCompiled":
      return msg.compilationMode !== config.originalCompilationMode
        ? [
            {
              ...model,
              status: {
                tag: "WaitingForReload",
                date,
                reasons:
                  config.originalCompilationMode === "proxy"
                    ? []
                    : [
                        `compilation mode changed from ${config.originalCompilationMode} to ${msg.compilationMode}.`,
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
            },
            [{ tag: "Eval", code: msg.code }],
          ];

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
            errors: getErrors(model.status),
          },
          compilationMode: status.compilationMode,
        },
        [],
      ];

    case "ClientError":
      return [
        {
          ...model,
          status: { tag: "UnexpectedError", date, message: status.message },
        },
        [
          { tag: "OpenPanel" },
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
            errors: new Map(
              status.errors.map((error) => {
                const overlayError: OverlayError = {
                  title: error.title,
                  location: error.location,
                  htmlContent: error.htmlContent,
                  htmlContentCollapsed: error.htmlContentCollapsed,
                  foregroundColor: status.foregroundColor,
                  backgroundColor: status.backgroundColor,
                };
                const id = Codec.JSON.stringify(Codec.unknown, overlayError);
                return [id, overlayError];
              }),
            ),
            openEditorError: undefined,
          },
          compilationMode: status.compilationMode,
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
  options:
    | { force: true }
    | { force: false; attemptNumber: number; sleepStartDate: Date },
): [Model, Array<Cmd>] {
  // We never clear reconnect `setTimeout`s. Instead, check that the timeout
  // belongs to the current sleep. This is needed since we have the “Reconnect
  // now” button. Don’t check that enough time has passed using `Date`: Timers
  // can fire a millisecond “early” according to `Date`, and some browsers
  // reduce the precision of `Date`. Then we would never reconnect.
  return model.status.tag === "SleepingBeforeReconnect" &&
    (options.force ||
      (model.status.attemptNumber === options.attemptNumber &&
        model.status.date.getTime() === options.sleepStartDate.getTime()))
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

export function reloadReasonToString(
  reason: ReloadReasonWithModuleName,
): string {
  switch (reason.tag) {
    case "ElmHotUnavailable":
      return `\`${reason.moduleName}\` uses built-in hot reloading (\`Elm.hot\`), which isn't available. It only exists when not in optimize mode, and when elm/core, elm/browser and elm/virtual-dom all support it.`;
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
    case "PortDirectionChanged":
      return `the port '${reason.name}' changed from ${reason.newDirection === "incoming" ? "outgoing to incoming" : "incoming to outgoing"}. The idea is to give JavaScript code a chance to set it up!`;
    case "PortTypeChanged":
      return `the type of the port '${reason.name}' changed. The idea is to give JavaScript code a chance to set it up!`;
    case "ProgramTypeChanged":
      return `\`${reason.moduleName}.main\` changed from \`${reason.previousProgramType}\` to \`${reason.newProgramType}\`.`;
  }
}

// This is slightly different from `unknownErrorToString` in `Helpers.ts`, which only
// needs to support Node.js (V8). This one supports browsers having different `.stack`.
export function unknownErrorToString(error: unknown): string {
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
