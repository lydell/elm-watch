// The pure parts of the client: `init` and `update` (and their types). The
// side effects live in client.ts. Keeping these separate makes it possible to
// unit test them, since importing client.ts starts the client.

import * as Codec from "tiny-decoders";

import type { NonEmptyArray } from "../src/NonEmptyArray.ts";
import type { CompilationModeWithProxy } from "../src/Types.ts";
import {
  type ExternalErrorsSource,
  type FlashType,
  type OpenEditorSetup,
  type TerminalColors,
  type OverlayError,
  SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
  type SendKey,
  type Status,
  type UiMsg,
} from "./Ui.ts";
import {
  type CompileError,
  decodeWebSocketToClientMessage,
  type StatusChange,
  type WebSocketToClientMessage,
  type WebSocketToServerMessage,
} from "./WebSocketMessages.ts";

// Comes from `ClientConfig` (see client.ts).
export type UpdateConfig = {
  originalCompilationMode: CompilationModeWithProxy;
  initialElmCompiledTimestamp: number;
  // Pages opened via file:// can never connect: Browsers send `Origin: null`
  // for them, which elm-watch rejects (see AllowedHosts.ts).
  isFileProtocol: boolean;
};

export type ReloadReason =
  | {
      tag: "ElmHotChanged";
      usesElmHot: boolean;
    }
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
      tag: "MainTypeChanged";
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
  // Received when connecting. `undefined` until then.
  openEditor: OpenEditorSetup | undefined;
  // Received when connecting (and later). `undefined` until then.
  terminalColors: TerminalColors | undefined;
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
      tag: "ShowOpenEditorError";
      message: string;
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
      tag: "UpdateExternalErrors";
      sources: Array<ExternalErrorsSource>;
      sendKey: SendKey;
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
  | "TargetError"
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
    status: config.isFileProtocol
      ? { tag: "FileProtocol", date }
      : { tag: "Connecting", date, attemptNumber: 1, errors: undefined },
    compilationMode: config.originalCompilationMode,
    elmCompiledTimestamp: config.initialElmCompiledTimestamp,
    elmCompiledTimestampBeforeReload,
    openEditor: undefined,
    terminalColors: undefined,
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
      // Evaluating is async. If the connection was lost meanwhile, keep the
      // reconnect status, or we would never reconnect. The error is logged to
      // the console.
      return isDisconnected(model.status)
        ? [model, []]
        : [
            {
              ...model,
              status: { tag: "EvalError", date: msg.date },
            },
            [
              { tag: "OpenPanel" },
              { tag: "Flash", flashType: "error" },
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
      // See `EvalErrored`. (`EvalNeedsReload` is fine: Reloading the page
      // connects anew anyway.)
      return isDisconnected(model.status)
        ? [model, []]
        : [
            {
              ...model,
              status: {
                tag: "Idle",
                date: msg.date,
                sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
              },
            },
            [
              // Only flash on actual hot reloads, not when (re)connecting to
              // find that we already have the latest code.
              { tag: "Flash", flashType: "success" },
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
          // On file:// there is no connection at all.
          ...(model.status.tag === "Connecting" ||
          model.status.tag === "SleepingBeforeReconnect" ||
          model.status.tag === "FileProtocol"
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
      switch (model.status.tag) {
        // This message is triggered from both the WebSocket "error" and "closed" events.
        // Sometimes, both events happen at the same time. We only want to start reconnecting once,
        // so check if we’re already sleeping before doing anything.
        case "SleepingBeforeReconnect":
          return [model, []];

        // A connection attempt failed: Sleep before trying again.
        case "Connecting": {
          const { attemptNumber, errors } = model.status;
          return [
            {
              ...model,
              status: {
                tag: "SleepingBeforeReconnect",
                date: msg.date,
                attemptNumber,
                errors,
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

        // We lost the connection: Try to connect again right away. (The
        // connection is never reported closed too soon after connecting, so
        // this can’t loop too fast. See `MIN_CLOSE_MS` in client.ts.)
        default:
          return [
            {
              ...model,
              status: {
                tag: "Connecting",
                date: msg.date,
                attemptNumber: 1,
                errors: getErrors(model.status),
              },
            },
            [
              {
                tag: "Reconnect",
                elmCompiledTimestamp: model.elmCompiledTimestamp,
              },
            ],
          ];
      }

    case "WebSocketConnected":
      return [
        {
          ...model,
          // Keep the errors from before losing the connection (if any) until
          // the server tells us the current status, to avoid the error overlay
          // blinking.
          status: {
            tag: "Busy",
            date: msg.date,
            errors: getErrors(model.status),
          },
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
            [{ tag: "OpenPanel" }, { tag: "Flash", flashType: "error" }],
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

    case "ChoseEditor":
      return [
        // Optimistic update. The server sends `OpenEditorSetupChanged` to all
        // browsers.
        model.openEditor === undefined
          ? model
          : {
              ...model,
              openEditor: {
                ...model.openEditor,
                preset: msg.editor,
              },
            },
        [
          {
            tag: "SendMessage",
            message: { tag: "ChoseEditor", editor: msg.editor },
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

    case "PressedConnectNow":
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
    case "ExternalErrors":
      return [
        model,
        [
          {
            tag: "UpdateExternalErrors",
            sources: msg.sources.map(({ source, errors }) => ({
              source,
              errors: toOverlayErrors(errors),
            })),
            // We just got a message, so we are connected.
            sendKey: SEND_KEY_DO_NOT_USE_ALL_THE_TIME,
          },
        ],
      ];

    case "FocusedTabAcknowledged":
      return [model, [{ tag: "WebSocketTimeoutClear" }]];

    case "OpenEditorFailed":
      return [
        model,
        [
          { tag: "ShowOpenEditorError", message: msg.error.message },
          {
            tag: "TriggerReachedIdleState",
            reason: "OpenEditorFailed",
          },
        ],
      ];

    case "OpenEditorSetupChanged":
      return [
        {
          ...model,
          openEditor: {
            preset: msg.preset,
            env: msg.env,
          },
        },
        [],
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

    case "TerminalColors":
      return [
        {
          ...model,
          terminalColors: {
            foregroundColor: msg.foregroundColor,
            backgroundColor: msg.backgroundColor,
          },
        },
        [],
      ];

    case "SuccessfullyCompiled":
      return msg.compilationMode !== config.originalCompilationMode
        ? compilationModeChanged(
            date,
            config.originalCompilationMode,
            msg.compilationMode,
            model,
          )
        : [
            {
              ...model,
              compilationMode: msg.compilationMode,
              elmCompiledTimestamp: msg.elmCompiledTimestamp,
            },
            [{ tag: "Eval", code: msg.code }],
          ];

    case "SuccessfullyCompiledInOptimizeMode":
      return config.originalCompilationMode !== "optimize"
        ? compilationModeChanged(
            date,
            config.originalCompilationMode,
            "optimize",
            model,
          )
        : [
            {
              ...model,
              status: {
                tag: "WaitingForReload",
                date,
                reasons: [`hot reloading isn't supported in optimize mode.`],
              },
            },
            [],
          ];
  }
}

function compilationModeChanged(
  date: Date,
  originalCompilationMode: CompilationModeWithProxy,
  compilationMode: CompilationModeWithProxy,
  model: Model,
): [Model, Array<Cmd>] {
  return [
    {
      ...model,
      status: {
        tag: "WaitingForReload",
        date,
        reasons:
          originalCompilationMode === "proxy"
            ? []
            : [
                `compilation mode changed from ${originalCompilationMode} to ${compilationMode}.`,
              ],
      },
      compilationMode,
    },
    [],
  ];
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
          { tag: "Flash", flashType: "error" },
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
            errors: toOverlayErrors(status.errors),
          },
          compilationMode: status.compilationMode,
        },
        [
          { tag: "Flash", flashType: "error" },
          {
            tag: "TriggerReachedIdleState",
            reason: "CompileError",
          },
        ],
      ];

    case "TargetError":
      return [
        {
          ...model,
          status: { tag: "TargetError", date, error: status.error },
        },
        [
          { tag: "Flash", flashType: "error" },
          {
            tag: "TriggerReachedIdleState",
            reason: "TargetError",
          },
        ],
      ];
  }
}

function toOverlayErrors(
  errors: Array<CompileError>,
): Map<string, OverlayError> {
  return new Map(
    errors.map((error) => {
      const overlayError: OverlayError = {
        title: error.title,
        location: error.location,
        htmlContent: error.htmlContent,
        htmlContentCollapsed: error.htmlContentCollapsed,
      };
      const id = Codec.JSON.stringify(Codec.unknown, overlayError);
      return [id, overlayError];
    }),
  );
}

function isDisconnected(status: Status): boolean {
  return (
    status.tag === "SleepingBeforeReconnect" || status.tag === "Connecting"
  );
}

function reconnect(
  model: Model,
  date: Date,
  options:
    | { force: true }
    | { force: false; attemptNumber: number; sleepStartDate: Date },
): [Model, Array<Cmd>] {
  // We never clear reconnect `setTimeout`s. Instead, check that the timeout
  // belongs to the current sleep. This is needed since we have the “Connect
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
            attemptNumber: model.status.attemptNumber + 1,
            errors: model.status.errors,
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

function reloadReasonToString(reason: ReloadReasonWithModuleName): string {
  switch (reason.tag) {
    case "ElmHotChanged":
      return reason.usesElmHot
        ? `\`${reason.moduleName}\` now uses built-in hot reloading (\`Elm.hot\`), for example because the compiler changed.`
        : `\`${reason.moduleName}\` no longer uses built-in hot reloading (\`Elm.hot\`), for example because the compiler changed.`;
    case "ElmHotUnavailable":
      return `\`${reason.moduleName}\` uses built-in hot reloading (\`Elm.hot\`), which isn't available. It only exists when elm/core, elm/browser and elm/virtual-dom all support it.`;
    case "FlagsTypeChanged":
      return `the flags type in \`${reason.moduleName}\` changed and now the passed flags aren't correct anymore. The idea is to try to run with new flags!\nThis is the error:\n${reason.jsonErrorMessage}`;
    case "HotReloadCaughtError":
      return `hot reload for \`${reason.moduleName}\` failed, probably because of incompatible model changes.\nThis is the error:\n${unknownErrorToString(reason.caughtError)}`;
    case "InitReturnValueChanged":
      return `\`${reason.moduleName}.init\` returned something different than last time. Let's start fresh!`;
    case "MainTypeChanged":
      return `the type of \`${reason.moduleName}.main\` changed, so the running app can't take the new code.`;
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
