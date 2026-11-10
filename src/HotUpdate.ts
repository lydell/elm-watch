import type WebSocket from "ws";

import type {
  WebSocketToClientMessage,
  WebSocketToServerMessage,
} from "../client/WebSocketMessages.ts";
import * as Compile from "./Compile.ts";
import type {
  WebSocketConnection,
  WebSocketConnectionRejectedReason,
} from "./DevServer.ts";
import * as Errors from "./Errors.ts";
import type { ErrorTemplate } from "./Errors.ts";
import type * as ErrorView from "./ErrorView.ts";
import { bold, printDurationMs } from "./Helpers.ts";
import {
  getLatestEventSleepMs,
  type LatestEvent,
  makeWatcherEvent,
  printEventsMessage,
  WATCHER_EVENT_SLEEP_MS,
  type WebSocketRelatedEvent,
} from "./LatestEvent.ts";
import type { LoggerConfig } from "./Logger.ts";
import { isNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray.ts";
import {
  type ApplicationTargetErrorWithMetadata,
  getFlatOutputs,
  getPackageStates,
  type OutputError,
  type OutputState,
  type PackageState,
  type Project,
} from "./Project.ts";
import type {
  AbsolutePath,
  CompilationMode,
  ElmJsonPath,
  OutputPath,
  TargetName,
} from "./Types.ts";
import {
  classifyWatcherEvent,
  type WatcherEventEffect,
} from "./WatcherEvents.ts";
import {
  type OutputPathError,
  type ParseWebSocketConnectRequestUrlResult,
  parseWebSocketToServerMessage,
  webSocketConnectRequestUrlErrorToString,
} from "./WebSocketConnect.ts";

// The pure part of `elm-watch hot`, inspired by The Elm Architecture: What to
// do (`Cmd`) when something happens (`Msg`), given the current state
// (`Model`). The commands are run in Hot.ts.

type WebSocketMessageReceivedOutput =
  | OutputPathError
  | {
      tag: "Output";
      elmJsonPath: ElmJsonPath;
      outputPath: OutputPath;
      outputState: OutputState;
    };

export type Msg =
  | {
      tag: "CompilationPartDone";
      date: Date;
      prioritizedOutputs: Map<TargetName, number>;
      handleOutputActionResult: Compile.HandleOutputActionResult;
    }
  | {
      tag: "ExitRequested";
      date: Date;
    }
  | {
      tag: "GotWatcherEvent";
      date: Date;
      absolutePath: AbsolutePath;
    }
  | {
      tag: "InstallDependenciesDone";
      date: Date;
      installResult: Compile.InstallDependenciesResult;
    }
  | {
      tag: "KeysPressed";
      date: Date;
      keys: NonEmptyArray<ErrorView.ErrorViewKey>;
    }
  | {
      tag: "OpenEditorFromTerminalFailed";
      date: Date;
      message: string;
    }
  | {
      tag: "OutputRequested";
      date: Date;
      outputPath: OutputPath;
      outputState: OutputState;
    }
  | {
      tag: "SleepBeforeNextActionDone";
      date: Date;
      // The `pendingWatcherEvents` paths that don’t exist.
      removedPaths: Set<AbsolutePath>;
      // Source directories that have been added or removed since start.
      changedSourceDirectories: Array<AbsolutePath>;
    }
  | {
      tag: "WebSocketConnected";
      date: Date;
      webSocket: WebSocket;
      parseWebSocketConnectRequestUrlResult: ParseWebSocketConnectRequestUrlResult;
    }
  | {
      tag: "WebSocketConnectionRejected";
      date: Date;
      origin: string | undefined;
      reason: WebSocketConnectionRejectedReason;
    }
  | {
      tag: "WebSocketMessageReceived";
      date: Date;
      output: WebSocketMessageReceivedOutput;
      connection: WebSocketConnection;
      data: WebSocket.Data;
    };

export type Model = {
  nextAction: NextAction;
  hotState: HotState;
  latestEvents: Array<LatestEvent>;
  // Watcher events are handled once the sleep before the next action is done.
  // Then we check if the paths exist. Atomic saves (write to a temporary
  // file, then rename it over the original) can briefly make a file look
  // removed, so we don’t want to check right away.
  pendingWatcherEvents: Array<AbsolutePath>;
};

type NextAction =
  | {
      tag: "Compile";
    }
  | {
      tag: "NoAction";
    }
  | {
      tag: "Restart";
    };

type HotState =
  | {
      tag: "Compiling";
      start: Date;
    }
  | {
      tag: "Dependencies";
      start: Date;
    }
  | {
      tag: "Idle";
    }
  | {
      tag: "Restarting";
    };

export type Cmd =
  | {
      tag: "ChangeCompilationMode";
      outputState: OutputState;
      compilationMode: CompilationMode;
    }
  | {
      tag: "ClearScreen";
    }
  | {
      tag: "CompileAllOutputsAsNeeded";
      mode: "AfterIdle" | "AfterInstallDependencies" | "ContinueCompilation";
      includeInterrupted: boolean;
    }
  | {
      tag: "ExitOnIdle";
    }
  | {
      tag: "HandleElmWatchStuffJsonWriteError";
    }
  | {
      tag: "HandleKeys";
      keys: NonEmptyArray<ErrorView.ErrorViewKey>;
    }
  | {
      tag: "InstallDependencies";
    }
  | {
      tag: "LogInfoMessage";
      // Printed on one line together with the latest event.
      message: string;
      events: Array<LatestEvent>;
    }
  | {
      tag: "MarkAsDirty";
      outputs: Array<{
        outputPath: OutputPath;
        outputState: OutputState;
      }>;
      packages: Array<PackageState>;
      killInstallDependencies: boolean;
    }
  | {
      tag: "NoCmd";
    }
  | {
      tag: "OpenEditor";
      file: AbsolutePath;
      line: number;
      column: number;
      webSocket: WebSocket;
    }
  | {
      tag: "PrintCompileErrors";
      errors: NonEmptyArray<ErrorTemplate>;
    }
  | {
      tag: "RenderErrorView";
      notice: string;
    }
  | {
      tag: "RespondToOutputRequests";
      // What to do with requests for outputs that aren’t done.
      // - KeepWaiting: They will be compiled soon.
      // - RespondIfNotDirty: Compilation is over. Respond with a proxy file
      //   rather than waiting forever if something unexpected happened. Dirty
      //   outputs will be compiled soon.
      // - RespondToAll: Nothing more will happen until some file changes.
      waiting: "KeepWaiting" | "RespondIfNotDirty" | "RespondToAll";
    }
  | {
      tag: "Restart";
      restartReasons: Array<LatestEvent>;
    }
  | {
      tag: "SleepBeforeNextAction";
      sleepMs: number;
      // Check which of these exist once the sleep is done.
      watcherPaths: Array<AbsolutePath>;
    }
  | {
      tag: "Throw";
      error: Error;
    }
  | {
      tag: "WebSocketSend";
      webSocket: WebSocket;
      message: WebSocketToClientMessage;
    }
  | {
      tag: "WebSocketSendAll";
      message: WebSocketToClientMessage;
    }
  | {
      tag: "WebSocketSendCompileErrorToOutput";
      outputPath: OutputPath;
      compilationMode: CompilationMode;
      errors: Array<Errors.ErrorTemplate>;
    }
  | {
      tag: "WebSocketSendToOutput";
      outputPath: OutputPath;
      message: WebSocketToClientMessage;
    }
  | {
      tag: "WebSocketUpdatePriority";
      connection: WebSocketConnection;
    };

export const init = (
  now: Date,
  restartReasons: Array<LatestEvent>,
  targetsErrors: Array<ApplicationTargetErrorWithMetadata>,
): [Model, Array<Cmd>] => [
  {
    nextAction: { tag: "NoAction" },
    hotState: {
      tag: "Dependencies",
      start: now,
    },
    latestEvents: restartReasons,
    pendingWatcherEvents: [],
  },
  [
    { tag: "ClearScreen" },
    { tag: "InstallDependencies" },
    ...targetsErrors.map((targetError): Cmd => ({
      tag: "WebSocketSendToOutput",
      outputPath: targetError.outputPath,
      message: {
        tag: "StatusChanged",
        status: {
          tag: "ElmJsonError",
          error: Errors.toPlainString(Compile.renderTargetError(targetError)),
        },
      },
    })),
  ],
];

export function update(
  loggerConfig: LoggerConfig,
  project: Project,
  exitOnError: boolean,
  msg: Msg,
  model: Model,
): [Model, Array<Cmd>] {
  switch (msg.tag) {
    // Keys are only handled while idle: While compiling, the screen is busy
    // showing progress.
    case "KeysPressed":
      return [
        model,
        model.hotState.tag === "Idle"
          ? [{ tag: "HandleKeys", keys: msg.keys }]
          : [],
      ];

    case "OpenEditorFromTerminalFailed":
      return [
        model,
        model.hotState.tag === "Idle"
          ? [{ tag: "RenderErrorView", notice: msg.message }]
          : [],
      ];

    case "GotWatcherEvent":
      return [
        {
          ...model,
          pendingWatcherEvents: [
            ...model.pendingWatcherEvents,
            msg.absolutePath,
          ],
        },
        [],
      ];

    case "ExitRequested":
      if (model.hotState.tag !== "Idle") {
        return [
          model,
          [
            {
              tag: "Throw",
              error: new Error(
                `Got ExitRequested. Expected hotState to be Idle but it is: ${model.hotState.tag}`,
              ),
            },
          ],
        ];
      }

      switch (model.nextAction.tag) {
        case "Restart":
        case "Compile":
          return [
            model,
            [
              {
                tag: "Throw",
                error: new Error(
                  `Got ExitRequested. Expected nextAction to be NoAction but it is: ${model.nextAction.tag}`,
                ),
              },
            ],
          ];

        case "NoAction":
          return runNextAction(msg.date, model);
      }

    case "SleepBeforeNextActionDone": {
      const [modelWithEvents, watcherCmds] = handlePendingWatcherEvents(
        project,
        msg.removedPaths,
        msg.changedSourceDirectories,
        model,
      );
      const staticFilesDirPaths = modelWithEvents.latestEvents.flatMap(
        (event) =>
          event.tag === "WatcherEvent" &&
          event.file.tag === "StaticFilesDirPath"
            ? [event.file.urlPath]
            : [],
      );
      const [newModel, cmds] = runNextAction(msg.date, modelWithEvents);
      return [
        {
          ...newModel,
          nextAction: { tag: "NoAction" },
        },
        [
          ...watcherCmds,
          ...(isNonEmptyArray(staticFilesDirPaths)
            ? [
                {
                  tag: "WebSocketSendAll",
                  message: {
                    tag: "StaticFilesChanged",
                    changedFileUrlPaths: staticFilesDirPaths,
                  },
                } as const,
              ]
            : []),
          ...cmds,
        ],
      ];
    }

    case "CompilationPartDone": {
      const includeInterrupted = model.nextAction.tag !== "Compile";
      const outputActions = Compile.getOutputActions({
        project,
        runMode: "hot",
        includeInterrupted,
        prioritizedOutputs: msg.prioritizedOutputs,
      });

      switch (model.hotState.tag) {
        case "Dependencies":
        case "Idle":
          return [
            model,
            [
              {
                tag: "Throw",
                error: new Error(
                  `HotState became ${model.hotState.tag} while compiling!`,
                ),
              },
            ],
          ];

        case "Compiling": {
          const duration = msg.date.getTime() - model.hotState.start.getTime();

          const cmd = handleOutputActionResultToCmd(
            msg.handleOutputActionResult,
          );

          const respondCmd: Cmd = {
            tag: "RespondToOutputRequests",
            waiting: "KeepWaiting",
          };

          if (isNonEmptyArray(outputActions.actions)) {
            return [
              model,
              [
                cmd,
                respondCmd,
                {
                  tag: "CompileAllOutputsAsNeeded",
                  mode: "ContinueCompilation",
                  includeInterrupted,
                },
              ],
            ];
          }

          if (
            outputActions.numExecuting > 0 ||
            outputActions.numInterrupted > 0
          ) {
            return [model, [cmd, respondCmd]];
          }

          const errors = Compile.extractErrors(project);

          return [
            { ...model, hotState: { tag: "Idle" }, latestEvents: [] },
            [
              cmd,
              { tag: "RespondToOutputRequests", waiting: "RespondIfNotDirty" },
              isNonEmptyArray(errors)
                ? { tag: "PrintCompileErrors", errors }
                : { tag: "NoCmd" },
              { tag: "HandleElmWatchStuffJsonWriteError" },
              {
                tag: "LogInfoMessage",
                message: compileFinishedMessage(loggerConfig, duration),
                events: model.latestEvents,
              },
              isNonEmptyArray(errors) && exitOnError
                ? { tag: "ExitOnIdle" }
                : { tag: "NoCmd" },
            ],
          ];
        }

        case "Restarting":
          return outputActions.numExecuting === 0
            ? [model, [{ tag: "Restart", restartReasons: model.latestEvents }]]
            : [model, []];
      }
    }

    case "InstallDependenciesDone":
      switch (model.hotState.tag) {
        case "Dependencies": {
          switch (msg.installResult.tag) {
            case "Error":
              return [
                { ...model, hotState: { tag: "Idle" } },
                [
                  { tag: "RespondToOutputRequests", waiting: "RespondToAll" },
                  exitOnError ? { tag: "ExitOnIdle" } : { tag: "NoCmd" },
                ],
              ];

            // We only kill installing dependencies when a restart is needed.
            // Wait for the restart to happen.
            case "Killed":
              return [{ ...model, hotState: { tag: "Idle" } }, []];

            case "Success": {
              return [
                {
                  ...model,
                  hotState: {
                    tag: "Compiling",
                    start: model.hotState.start,
                  },
                },
                [
                  {
                    tag: "CompileAllOutputsAsNeeded",
                    mode: "AfterInstallDependencies",
                    includeInterrupted: true,
                  },
                ],
              ];
            }
          }
        }

        case "Restarting":
          return [
            model,
            [{ tag: "Restart", restartReasons: model.latestEvents }],
          ];

        case "Idle":
        case "Compiling":
          return [
            model,
            [
              {
                tag: "Throw",
                error: new Error(
                  `HotState became ${model.hotState.tag} while installing dependencies!`,
                ),
              },
            ],
          ];
      }

    case "OutputRequested":
      return onOutputRequested(model, msg.outputPath, msg.outputState);

    case "WebSocketConnected": {
      const result = msg.parseWebSocketConnectRequestUrlResult;

      const cssCmd: Array<Cmd> =
        project.staticFilesDir === undefined
          ? []
          : [
              {
                tag: "WebSocketSend",
                webSocket: msg.webSocket,
                message: { tag: "StaticFilesMayHaveChangedWhileDisconnected" },
              },
            ];

      switch (result.tag) {
        case "Success": {
          const [newModel, latestEvent, cmds] = onWebSocketConnected(
            model,
            result.elmJsonPath,
            result.outputPath,
            result.outputState,
            result.elmCompiledTimestamp,
          );
          return [
            latestEvent === undefined
              ? newModel
              : {
                  ...newModel,
                  latestEvents: [...newModel.latestEvents, latestEvent],
                },
            [...cmds, ...cssCmd],
          ];
        }

        case "ElmJsonError": {
          const targetError = result.error;
          return [
            model,
            [
              {
                tag: "WebSocketSendToOutput",
                outputPath: targetError.outputPath,
                message: {
                  tag: "StatusChanged",
                  status: {
                    tag: "ElmJsonError",
                    error: Errors.toPlainString(
                      Compile.renderTargetError(targetError),
                    ),
                  },
                },
              },
              ...cssCmd,
            ],
          ];
        }

        // The browser shows the error.
        default:
          return [
            model,
            [
              {
                tag: "WebSocketSend",
                webSocket: msg.webSocket,
                message: {
                  tag: "StatusChanged",
                  status: {
                    tag: "ClientError",
                    message: webSocketConnectRequestUrlErrorToString(
                      project.configSource,
                      project.webSocketUrl,
                      result,
                    ),
                  },
                },
              },
              ...cssCmd,
            ],
          ];
      }
    }

    case "WebSocketConnectionRejected":
      return [
        {
          ...model,
          latestEvents: [
            ...model.latestEvents,
            {
              tag: "WebSocketConnectionRejected",
              origin: msg.origin,
              reason: msg.reason,
            },
          ],
        },
        [],
      ];

    case "WebSocketMessageReceived": {
      const result = parseWebSocketToServerMessage(msg.data);

      switch (result.tag) {
        case "Success":
          return onWebSocketToServerMessage(
            model,
            msg.output,
            msg.connection,
            result.message,
          );

        case "DecoderError":
          return [
            model,
            [
              {
                tag: "WebSocketSend",
                webSocket: msg.connection.webSocket,
                message: {
                  tag: "StatusChanged",
                  status: {
                    tag: "ClientError",
                    message: Errors.webSocketDecodeError(result.error),
                  },
                },
              },
            ],
          ];
      }
    }
  }
}

function handlePendingWatcherEvents(
  project: Project,
  removedPaths: Set<AbsolutePath>,
  changedSourceDirectories: Array<AbsolutePath>,
  model: Model,
): [Model, Array<Cmd>] {
  // Elm errors if a source directory is missing. Restart if a missing one
  // appears, or an existing one is removed. This is checked separately from
  // the events, since on macOS there can be events for a directory itself when
  // files inside it change, so we can’t restart on any such event. And if a
  // parent of a missing source directory is added, we only get an event for
  // the parent.
  const [changedSourceDirectory] = changedSourceDirectories;
  if (
    changedSourceDirectory !== undefined &&
    isNonEmptyArray(model.pendingWatcherEvents)
  ) {
    const [nextAction, cmds] = applyWatcherEventEffect(
      project,
      { tag: "Restart" },
      model.nextAction,
    );
    const latestEvent: LatestEvent = {
      ...makeWatcherEvent(
        project.missingSourceDirectories.has(changedSourceDirectory)
          ? "changed"
          : "removed",
        changedSourceDirectory,
      ),
      affectsAnyTarget: true,
    };
    return [
      {
        ...model,
        nextAction,
        latestEvents: [...model.latestEvents, latestEvent],
        pendingWatcherEvents: [],
      },
      cmds,
    ];
  }

  // Editors and file systems often emit several events for the same file.
  // Only handle the latest one for each path.
  const latestPaths = new Set<AbsolutePath>();
  for (const absolutePath of model.pendingWatcherEvents) {
    latestPaths.delete(absolutePath);
    latestPaths.add(absolutePath);
  }

  let { nextAction } = model;
  const latestEvents = [...model.latestEvents];
  const cmds: Array<Cmd> = [];

  for (const absolutePath of latestPaths) {
    const result = classifyWatcherEvent(
      project,
      removedPaths.has(absolutePath) ? "removed" : "changed",
      absolutePath,
    );
    if (result !== undefined) {
      const [updatedNextAction, newCmds] = applyWatcherEventEffect(
        project,
        result.effect,
        nextAction,
      );
      nextAction = updatedNextAction;
      latestEvents.push(result.event);
      cmds.push(...newCmds);
    }
  }

  return [
    { ...model, nextAction, latestEvents, pendingWatcherEvents: [] },
    cmds,
  ];
}

function runNextAction(start: Date, model: Model): [Model, Array<Cmd>] {
  switch (model.nextAction.tag) {
    case "Restart":
      switch (model.hotState.tag) {
        case "Idle":
          return [
            { ...model, hotState: { tag: "Restarting" } },
            [
              { tag: "ClearScreen" },
              { tag: "Restart", restartReasons: model.latestEvents },
            ],
          ];

        case "Dependencies":
        case "Compiling": {
          // The actual restart is triggered once the current compilation is over.
          return [{ ...model, hotState: { tag: "Restarting" } }, []];
        }

        case "Restarting":
          return [model, []];
      }

    case "Compile":
      switch (model.hotState.tag) {
        case "Idle": {
          return [
            {
              ...model,
              hotState: { tag: "Compiling", start },
            },
            [
              {
                tag: "CompileAllOutputsAsNeeded",
                mode: "AfterIdle",
                includeInterrupted: true,
              },
            ],
          ];
        }

        case "Compiling":
          return [
            model,
            [
              {
                tag: "CompileAllOutputsAsNeeded",
                mode: "ContinueCompilation",
                includeInterrupted: true,
              },
            ],
          ];

        case "Dependencies":
        case "Restarting":
          return [model, []];
      }

    case "NoAction":
      switch (model.hotState.tag) {
        case "Idle":
          return isNonEmptyArray(model.latestEvents)
            ? [
                { ...model, latestEvents: [] },
                [
                  {
                    tag: "LogInfoMessage",
                    message: printEventsMessage(model.latestEvents),
                    events: model.latestEvents,
                  },
                ],
              ]
            : [model, []];

        case "Compiling":
        case "Dependencies":
        case "Restarting":
          return [model, []];
      }
  }
}

function handleOutputActionResultToCmd(
  handleOutputActionResult: Compile.HandleOutputActionResult,
): Cmd {
  switch (handleOutputActionResult.tag) {
    case "CompileError":
      return {
        tag: "WebSocketSendCompileErrorToOutput",
        outputPath: handleOutputActionResult.outputPath,
        compilationMode: handleOutputActionResult.outputState.compilationMode,
        errors: Compile.renderOutputErrors(
          handleOutputActionResult.elmJsonPath,
          handleOutputActionResult.outputPath,
          handleOutputActionResult.outputState.status,
        ),
      };

    case "FullyCompiledJS":
      return {
        tag: "WebSocketSendToOutput",
        outputPath: handleOutputActionResult.outputPath,
        message: {
          tag: "SuccessfullyCompiled",
          code: handleOutputActionResult.code.toString("utf8"),
          elmCompiledTimestamp: handleOutputActionResult.elmCompiledTimestamp,
          compilationMode: handleOutputActionResult.outputState.compilationMode,
        },
      };

    case "FullyCompiledJSButRecordFieldsChanged":
      return {
        tag: "WebSocketSendToOutput",
        outputPath: handleOutputActionResult.outputPath,
        message: { tag: "SuccessfullyCompiledButRecordFieldsChanged" },
      };

    case "Nothing":
      return { tag: "NoCmd" };
  }
}

function applyWatcherEventEffect(
  project: Project,
  effect: WatcherEventEffect,
  nextAction: NextAction,
): [NextAction, Array<Cmd>] {
  switch (effect.tag) {
    case "Restart":
      return [
        { tag: "Restart" },
        [
          {
            // Interrupt all compilation.
            tag: "MarkAsDirty",
            outputs: getFlatOutputs(project),
            packages: getPackageStates(project),
            killInstallDependencies: true,
          },
        ],
      ];

    case "MarkAsDirty":
      return [
        compileNextAction(nextAction),
        [
          {
            tag: "MarkAsDirty",
            outputs: effect.outputs,
            packages: effect.packages,
            killInstallDependencies: false,
          },
        ],
      ];

    case "NoEffect":
      return [nextAction, []];
  }
}

function onWebSocketConnected(
  model: Model,
  elmJsonPath: ElmJsonPath,
  outputPath: OutputPath,
  outputState: OutputState,
  elmCompiledTimestamp: number,
): [Model, LatestEvent | undefined, Array<Cmd>] {
  const event: WebSocketRelatedEvent = {
    tag: "WebSocketConnectedNeedingCompilation",
    outputPath,
  };

  const recompileNeeded = (): [Model, LatestEvent, Array<Cmd>] => {
    const [newModel, cmds] = onWebSocketRecompileNeeded(
      model,
      outputPath,
      outputState,
    );
    return [newModel, event, cmds];
  };

  switch (model.hotState.tag) {
    case "Restarting":
    case "Dependencies":
      return [model, event, []];

    case "Idle":
    case "Compiling":
      switch (outputState.status.tag) {
        case "Success":
          return outputState.status.elmCompiledTimestamp ===
            elmCompiledTimestamp
            ? [
                model,
                // Nothing happened, so nothing to print.
                undefined,
                [
                  {
                    tag: "WebSocketSendToOutput",
                    outputPath,
                    message: {
                      tag: "StatusChanged",
                      status: {
                        tag: "AlreadyUpToDate",
                        compilationMode: outputState.compilationMode,
                      },
                    },
                  },
                ],
              ]
            : recompileNeeded();

        case "NotWrittenToDisk":
        case "ElmMakeTypecheckOnly":
          return recompileNeeded();

        case "ElmMake":
        case "Postprocess":
        case "Interrupted":
        case "QueuedForElmMake":
        case "QueuedForPostprocess":
          switch (model.hotState.tag) {
            case "Idle":
              return recompileNeeded();

            case "Compiling":
              return [model, event, []];
          }

        default: {
          // Make sure only error statuses are left.
          const _: OutputError = outputState.status;
          void _;
          return [
            model,
            event,
            [
              {
                tag: "WebSocketSendCompileErrorToOutput",
                outputPath,
                compilationMode: outputState.compilationMode,
                errors: Compile.renderOutputErrors(
                  elmJsonPath,
                  outputPath,
                  outputState.status,
                ),
              },
            ],
          ];
        }
      }
  }
}

function onOutputRequested(
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState,
): [Model, Array<Cmd>] {
  const withEvent = (newModel: Model): Model => ({
    ...newModel,
    latestEvents: [
      ...newModel.latestEvents,
      { tag: "OutputRequestedNeedingCompilation", outputPath },
    ],
  });

  switch (model.hotState.tag) {
    // The output is compiled once done, since it is prioritized.
    case "Restarting":
    case "Dependencies":
      return [withEvent(model), []];

    case "Idle":
    case "Compiling":
      switch (getOutputRequestResponse(outputState)) {
        case "ServeFile":
        case "ServeProxy":
          return [
            model,
            [{ tag: "RespondToOutputRequests", waiting: "KeepWaiting" }],
          ];

        case "Wait": {
          if (
            model.hotState.tag === "Compiling" &&
            isBeingCompiled(outputState)
          ) {
            return [withEvent(model), []];
          }
          const [newModel, cmds] = onWebSocketRecompileNeeded(
            model,
            outputPath,
            outputState,
          );
          return [withEvent(newModel), cmds];
        }
      }
  }
}

// Fully compiled, not just typechecked.
function isBeingCompiled(outputState: OutputState): boolean {
  switch (outputState.status.tag) {
    case "ElmMake":
    case "Postprocess":
    case "Interrupted":
    case "QueuedForElmMake":
    case "QueuedForPostprocess":
      return true;
    default:
      return false;
  }
}

type OutputRequestResponse = "ServeFile" | "ServeProxy" | "Wait";

export function getOutputRequestResponse(
  outputState: OutputState,
): OutputRequestResponse {
  if (outputState.dirty) {
    return "Wait";
  }
  switch (outputState.status.tag) {
    case "Success":
      return "ServeFile";

    // The file on disk is missing, a proxy file, or out of date.
    case "ElmMake":
    case "ElmMakeTypecheckOnly":
    case "Interrupted":
    case "NotWrittenToDisk":
    case "Postprocess":
    case "QueuedForElmMake":
    case "QueuedForPostprocess":
      return "Wait";

    default: {
      // Make sure only error statuses are left.
      const _: OutputError = outputState.status;
      void _;
      return "ServeProxy";
    }
  }
}

function onChangedCompilationMode(
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState,
): [Model, Array<Cmd>] {
  switch (model.hotState.tag) {
    case "Restarting":
    case "Dependencies":
      return [model, []];

    case "Idle":
    case "Compiling":
      return onWebSocketRecompileNeeded(model, outputPath, outputState);
  }
}

function onWebSocketRecompileNeeded(
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState,
): [Model, Array<Cmd>] {
  switch (model.nextAction.tag) {
    case "Restart":
      return [model, []];

    case "Compile":
    case "NoAction":
      return [
        {
          ...model,
          nextAction: { tag: "Compile" },
        },
        [
          {
            tag: "MarkAsDirty",
            outputs: [{ outputPath, outputState }],
            packages: [],
            killInstallDependencies: false,
          },
        ],
      ];
  }
}

function compileNextAction(nextAction: NextAction): NextAction {
  switch (nextAction.tag) {
    case "Restart":
    case "Compile":
      return nextAction;
    case "NoAction":
      return { tag: "Compile" };
  }
}

function onWebSocketToServerMessage(
  model: Model,
  output: WebSocketMessageReceivedOutput,
  connection: WebSocketConnection,
  message: WebSocketToServerMessage,
): [Model, Array<Cmd>] {
  const { webSocket } = connection;
  switch (message.tag) {
    case "ChangedCompilationMode":
      switch (output.tag) {
        case "OutputPathError":
          return [model, []];

        case "Output": {
          const [newModel, cmds] = onChangedCompilationMode(
            model,
            output.outputPath,
            output.outputState,
          );

          return [
            {
              ...newModel,
              latestEvents: [
                ...newModel.latestEvents,
                {
                  tag: "WebSocketChangedCompilationMode",
                  outputPath: output.outputPath,
                  compilationMode: message.compilationMode,
                },
              ],
            },
            [
              {
                tag: "ChangeCompilationMode",
                outputState: output.outputState,
                compilationMode: message.compilationMode,
              },
              ...cmds,
            ],
          ];
        }
      }

    case "FocusedTab":
      return [
        model,
        [
          { tag: "WebSocketUpdatePriority", connection },
          {
            tag: "WebSocketSend",
            webSocket,
            message: { tag: "FocusedTabAcknowledged" },
          },
        ],
      ];

    case "PressedOpenEditor":
      return [
        model,
        [
          {
            tag: "OpenEditor",
            file: message.file,
            line: message.line,
            column: message.column,
            webSocket,
          },
        ],
      ];
  }
}

export function getNextActionSleepMs(
  model: Model,
  webSocketEventSleepMs: number,
): number {
  return Math.max(
    0,
    ...model.latestEvents.map((event) =>
      getLatestEventSleepMs(event, webSocketEventSleepMs),
    ),
    ...(model.pendingWatcherEvents.length > 0 ? [WATCHER_EVENT_SLEEP_MS] : []),
  );
}

function compileFinishedMessage(
  loggerConfig: LoggerConfig,
  duration: number,
): string {
  return `Compiled in ${bold(
    printDurationMs(loggerConfig.mockedTimings ? 123 : duration).trim(),
  )}`;
}
