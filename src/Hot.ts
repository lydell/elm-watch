import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as Decode from "tiny-decoders";
import { URLSearchParams } from "url";
import type WebSocket from "ws";

import * as Compile from "./Compile";
import { ElmWatchJsonWritable } from "./ElmWatchJson";
import * as Errors from "./Errors";
import { ErrorTemplate } from "./Errors";
import { HashSet } from "./HashSet";
import { bold, dim, Env, formatTime, join } from "./Helpers";
import type { Logger } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { absoluteDirname, AbsolutePath } from "./PathHelpers";
import { PortChoice } from "./Port";
import { getFlatOutputs, OutputState, Project } from "./Project";
import { runTeaProgram } from "./TeaProgram";
import {
  CompilationMode,
  ElmToolingJsonPath,
  equalsInputPath,
  GetNow,
  OnIdle,
  OutputPath,
  outputPathToOriginalString,
} from "./Types";
import { WebSocketServer, WebSocketServerMsg } from "./WebSocketServer";

type WatcherEventName = "added" | "changed" | "removed";

export type WatcherEvent = {
  date: Date;
  eventName: WatcherEventName;
  file: AbsolutePath;
};

type Mutable = {
  watcher: chokidar.FSWatcher;
  webSocketServer: WebSocketServer;
  webSocketConnections: Array<WebSocketConnection>;
  project: Project;
  lastInfoMessage: string | undefined;
  watcherTimeoutId: NodeJS.Timeout | undefined;
  elmWatchJsonWriteError: Error | undefined;
};

type WebSocketConnection = {
  webSocket: WebSocket;
  outputPath: OutputPath | { tag: "OutputPathError" };
};

type Msg =
  | WebSocketServerMsg
  | {
      tag: "CompilationPartDone";
      date: Date;
      dirty: boolean;
    }
  | {
      tag: "GotWatcherEvent";
      date: Date;
      eventName: WatcherEventName;
      absolutePathString: string;
    }
  | {
      tag: "InstallDependenciesDone";
      installResult: Compile.InstallDependenciesResult;
    }
  | {
      tag: "SleepAfterWatcherEventDone";
      date: Date;
    };

type Model = {
  nextAction: NextAction;
  hotState: HotState;
};

type NextAction =
  | {
      tag: "Compile";
      events: NonEmptyArray<WatcherEvent>;
    }
  | {
      tag: "NoAction";
    }
  | {
      tag: "PrintNonInterestingEvents";
      events: NonEmptyArray<WatcherEvent>;
    }
  | {
      tag: "Restart";
      eventsWithMessages: NonEmptyArray<{
        event: WatcherEvent;
        message: string;
      }>;
    };

type HotState =
  | {
      tag: "Compiling";
      start: Date;
      events: Array<WatcherEvent>;
      keepConsumingDirty: boolean;
    }
  | {
      tag: "Dependencies";
      start: Date;
      events: Array<WatcherEvent>;
    }
  | {
      tag: "Idle";
    }
  | {
      tag: "Restarting";
      events: NonEmptyArray<WatcherEvent>;
    };

type Cmd =
  | {
      tag: "ChangeCompilationMode";
      webSocket: WebSocket;
      compilationMode: CompilationMode;
    }
  | {
      tag: "ClearScreen";
    }
  | {
      tag: "CompileAllOutputs";
    }
  | {
      tag: "HandleElmWatchJsonWriteError";
    }
  | {
      tag: "InstallDependencies";
    }
  | {
      tag: "LogInfoMessageWithTimeline";
      message: string;
      events: Array<WatcherEvent>;
    }
  | {
      tag: "MarkAsDirty";
      outputs: Array<{
        outputPath: OutputPath;
        outputState: OutputState;
      }>;
    }
  | {
      tag: "NoCmd";
    }
  | {
      tag: "PrintCompileErrors";
      errors: NonEmptyArray<ErrorTemplate>;
    }
  | {
      tag: "PrintStatusLinesForElmJsonsErrors";
    }
  | {
      tag: "Restart";
      restartReasons: NonEmptyArray<WatcherEvent>;
    }
  | {
      tag: "RunOnIdle";
    }
  | {
      tag: "SleepAfterWatcherEvent";
    }
  | {
      tag: "Throw";
      error: Error;
    }
  | {
      tag: "WebSocketAdd";
      webSocketConnection: WebSocketConnection;
    }
  | {
      tag: "WebSocketRemove";
      webSocket: WebSocket;
    }
  | {
      tag: "WebSocketSend";
      webSocket: WebSocket;
      message: WebSocketToClientMessage;
    }
  | {
      tag: "WebSocketSendToOutput";
      outputPath: OutputPath;
      message: WebSocketToClientMessage;
    };

export type HotRunResult =
  | {
      tag: "ExitOnIdle";
    }
  | {
      tag: "Restart";
      restartReasons: NonEmptyArray<WatcherEvent>;
      webSocketState: WebSocketState | undefined;
    };

export type WebSocketState = {
  webSocketServer: WebSocketServer;
  webSocketConnections: Array<WebSocketConnection>;
};

type WebSocketToClientMessage = ReturnType<typeof WebSocketToClientMessage>;
const WebSocketToClientMessage = Decode.fieldsUnion("tag", {
  StatusChanged: Decode.fieldsAuto({
    tag: () => "StatusChanged" as const,
    status: Decode.fieldsUnion("tag", {
      SuccessfullyCompiled: Decode.fieldsAuto({
        tag: () => "SuccessfullyCompiled" as const,
      }),
      Compiling: Decode.fieldsAuto({
        tag: () => "Compiling" as const,
      }),
      CompileError: Decode.fieldsAuto({
        tag: () => "CompileError" as const,
      }),
      ClientError: Decode.fieldsAuto({
        tag: () => "ClientError" as const,
        message: Decode.string,
      }),
    }),
  }),
});

type WebSocketToServerMessage = ReturnType<typeof WebSocketToServerMessage>;
const WebSocketToServerMessage = Decode.fieldsUnion("tag", {
  ChangeCompilationMode: Decode.fieldsAuto({
    tag: () => "ChangeCompilationMode" as const,
    compilationMode: CompilationMode,
  }),
});

// This uses something inspired by The Elm Architecture, since it’s all about
// keeping state (model) and reacting to events (messages).
export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  restartReasons: Array<WatcherEvent>,
  webSocketState: WebSocketState | undefined,
  project: Project,
  portChoice: PortChoice
): Promise<HotRunResult> {
  return runTeaProgram<Mutable, Msg, Model, Cmd, HotRunResult>({
    initMutable: initMutable(getNow, webSocketState, project, portChoice),
    init: init(getNow(), restartReasons),
    update: update(project),
    runCmd: runCmd(env, logger, getNow, onIdle),
  });
}

export async function watchElmToolingJsonOnce(
  getNow: GetNow,
  elmToolingJsonPath: ElmToolingJsonPath
): Promise<WatcherEvent> {
  return new Promise((resolve, reject) => {
    const watcher = chokidar.watch(
      elmToolingJsonPath.theElmToolingJsonPath.absolutePath,
      {
        ignoreInitial: true,
        disableGlobbing: true,
      }
    );

    watcherOnAll(watcher, reject, (eventName, absolutePathString) => {
      const event: WatcherEvent = {
        date: getNow(),
        eventName,
        file: {
          tag: "AbsolutePath",
          absolutePath: absolutePathString,
        },
      };
      watcher.close().then(() => {
        resolve(event);
      }, reject);
    });
  });
}

const initMutable =
  (
    getNow: GetNow,
    webSocketState: WebSocketState | undefined,
    project: Project,
    portChoice: PortChoice
  ) =>
  (
    dispatch: (msg: Msg) => void,
    rejectPromise: (error: Error) => void
  ): Mutable => {
    const watcher = chokidar.watch(project.watchRoot.absolutePath, {
      ignoreInitial: true,
      ignored: ["**/elm-stuff/**", "**/node_modules/**"],
      disableGlobbing: true,
    });

    watcherOnAll(
      watcher,
      rejectPromise,
      (eventName: WatcherEventName, absolutePathString: string): void => {
        dispatch({
          tag: "GotWatcherEvent",
          date: getNow(),
          eventName,
          absolutePathString,
        });
      }
    );

    const {
      webSocketServer = new WebSocketServer({ portChoice, rejectPromise }),
      webSocketConnections = [],
    } = webSocketState ?? {};

    webSocketServer.setDispatch(dispatch);

    const mutable: Mutable = {
      watcher,
      webSocketServer,
      webSocketConnections,
      project,
      lastInfoMessage: undefined,
      watcherTimeoutId: undefined,
      elmWatchJsonWriteError: undefined,
    };

    writeElmWatchJson(mutable);

    return mutable;
  };

function writeElmWatchJson(mutable: Mutable): void {
  const json: ElmWatchJsonWritable = {
    port: mutable.webSocketServer.port.thePort,
    outputs: Object.fromEntries(
      getFlatOutputs(mutable.project).flatMap(({ outputPath, outputState }) =>
        outputState.compilationMode === "standard"
          ? []
          : [
              [
                outputPathToOriginalString(outputPath),
                { compilationMode: outputState.compilationMode },
              ],
            ]
      )
    ),
  };

  try {
    fs.mkdirSync(
      absoluteDirname(mutable.project.elmWatchJsonPath.theElmWatchJsonPath)
        .absolutePath,
      { recursive: true }
    );

    fs.writeFileSync(
      mutable.project.elmWatchJsonPath.theElmWatchJsonPath.absolutePath,
      `${JSON.stringify(json, null, 4)}\n`
    );
    mutable.elmWatchJsonWriteError = undefined;
  } catch (errorAny) {
    const error = errorAny as Error;
    mutable.elmWatchJsonWriteError = error;
  }
}

function watcherOnAll(
  watcher: chokidar.FSWatcher,
  rejectPromise: (error: Error) => void,
  callback: (eventName: WatcherEventName, absolutePathString: string) => void
): void {
  // We generally only care about files – not directories – but adding and
  // removing directories can cause/fix errors, if they are named
  // `elm-tooling.json`, `elm.json` or `*.elm`.
  watcher.on("all", (chokidarEventName, absolutePathString) => {
    switch (chokidarEventName) {
      case "add":
      case "addDir":
        callback("added", absolutePathString);
        return;

      case "unlink":
      case "unlinkDir":
        callback("removed", absolutePathString);
        return;

      case "change":
        callback("changed", absolutePathString);
        return;
    }
  });

  // As far as I can tell, the watcher is never supposed to emit error events
  // during normal operation.
  watcher.on("error", rejectPromise);
}

const init = (
  now: Date,
  restartReasons: Array<WatcherEvent>
): [Model, Array<Cmd>] => [
  {
    nextAction: { tag: "NoAction" },
    hotState: {
      tag: "Dependencies",
      start: now,
      events: restartReasons,
    },
  },
  [{ tag: "ClearScreen" }, { tag: "InstallDependencies" }],
];

const update =
  (project: Project) =>
  (msg: Msg, model: Model): [Model, Array<Cmd>] => {
    switch (msg.tag) {
      case "GotWatcherEvent": {
        const result = onWatcherEvent(
          msg.date,
          project,
          msg.eventName,
          msg.absolutePathString,
          model.nextAction
        );

        if (result === undefined) {
          return [model, []];
        }

        const [updatedNextAction, cmds] = result;

        return [
          {
            ...model,
            hotState:
              model.hotState.tag === "Compiling"
                ? { ...model.hotState, keepConsumingDirty: false }
                : model.hotState,
            nextAction: updatedNextAction,
          },
          [...cmds, { tag: "SleepAfterWatcherEvent" }],
        ];
      }

      case "SleepAfterWatcherEventDone": {
        const [nextModel, cmds] = runNextAction(msg.date, project, model);
        return [
          {
            ...nextModel,
            nextAction: { tag: "NoAction" },
          },
          cmds,
        ];
      }

      case "CompilationPartDone":
        switch (model.hotState.tag) {
          case "Dependencies":
          case "Idle":
            return [
              model,
              [
                {
                  tag: "Throw",
                  error: new Error(
                    `HotState became ${model.hotState.tag} while compiling!`
                  ),
                },
              ],
            ];

          case "Compiling": {
            if (msg.dirty) {
              return model.hotState.keepConsumingDirty
                ? [model, [{ tag: "CompileAllOutputs" }]]
                : [model, []];
            }

            const someOutputIsExecutingOrWasInterrupted = getFlatOutputs(
              project
            ).some(({ outputState }) => {
              switch (outputState.status.tag) {
                case "ElmMake":
                case "Postprocess":
                case "Interrupted":
                  return true;

                default:
                  return false;
              }
            });

            // Output executing -> wait for that.
            // Output interrupted -> it will be re-executed soon, so wait for that.
            if (someOutputIsExecutingOrWasInterrupted) {
              return [model, []];
            }

            const duration =
              msg.date.getTime() - model.hotState.start.getTime();
            const errors = Compile.extractErrors(project);
            return [
              { ...model, hotState: { tag: "Idle" } },
              [
                isNonEmptyArray(errors)
                  ? { tag: "PrintCompileErrors", errors }
                  : { tag: "NoCmd" },
                {
                  tag: "HandleElmWatchJsonWriteError",
                },
                {
                  tag: "LogInfoMessageWithTimeline",
                  message: compileFinishedMessage(duration),
                  events: model.hotState.events,
                },
                {
                  tag: "RunOnIdle",
                },
              ],
            ];
          }

          case "Restarting": {
            const someOutputIsExecuting = getFlatOutputs(project).some(
              ({ outputState }) => {
                switch (outputState.status.tag) {
                  case "ElmMake":
                  case "Postprocess":
                    return true;

                  default:
                    return false;
                }
              }
            );
            return someOutputIsExecuting
              ? [model, []]
              : [
                  model,
                  [{ tag: "Restart", restartReasons: model.hotState.events }],
                ];
          }
        }

      case "InstallDependenciesDone":
        switch (model.hotState.tag) {
          case "Dependencies": {
            switch (msg.installResult.tag) {
              case "Error":
                return [
                  { ...model, hotState: { tag: "Idle" } },
                  [{ tag: "RunOnIdle" }],
                ];

              case "Success": {
                return runCompile(
                  { ...model, hotState: { tag: "Idle" } },
                  model.hotState.events,
                  model.hotState.start,
                  { clearScreen: false }
                );
              }
            }
          }

          case "Restarting":
            return [
              model,
              [{ tag: "Restart", restartReasons: model.hotState.events }],
            ];

          case "Idle":
          case "Compiling":
            return [
              model,
              [
                {
                  tag: "Throw",
                  error: new Error(
                    `HotState became ${model.hotState.tag} while installing dependencies!`
                  ),
                },
              ],
            ];
        }

      case "WebSocketConnected": {
        const result = parseWebSocketConnectRequestUrl(project, msg.urlString);

        const onError = (errorMessage: string): [Model, Array<Cmd>] => [
          model,
          [
            {
              tag: "WebSocketAdd",
              webSocketConnection: {
                webSocket: msg.webSocket,
                outputPath: { tag: "OutputPathError" },
              },
            },
            {
              tag: "WebSocketSend",
              webSocket: msg.webSocket,
              message: {
                tag: "StatusChanged",
                status: {
                  tag: "ClientError",
                  message: errorMessage,
                },
              },
            },
          ],
        ];

        switch (result.tag) {
          case "Success":
            return [
              model,
              [
                {
                  tag: "WebSocketAdd",
                  webSocketConnection: {
                    webSocket: msg.webSocket,
                    outputPath: result.outputPath,
                  },
                },
                ...outputStateToCmdsOnConnect(
                  result.outputPath,
                  result.outputState,
                  result.compiledTimestamp
                ),
              ],
            ];

          case "BadUrl":
            return onError(
              Errors.webSocketBadUrl(
                result.expectedStart,
                result.actualUrlString
              )
            );

          case "ParamsDecodeError":
            return onError(
              Errors.webSocketParamsDecodeError(
                result.error,
                result.actualUrlString
              )
            );

          case "WrongVersion":
            return onError(
              Errors.webSocketWrongVersion(
                result.expectedVersion,
                result.actualVersion
              )
            );

          case "OutputNotFound":
            return onError(
              Errors.webSocketOutputNotFound(
                result.output,
                result.enabledOutputs,
                result.disabledOutputs
              )
            );

          case "OutputDisabled":
            return onError(
              Errors.webSocketOutputDisabled(
                result.output,
                result.enabledOutputs,
                result.disabledOutputs
              )
            );
        }
      }

      case "WebSocketMessageReceived": {
        const onError = (errorMessage: string): [Model, Array<Cmd>] => [
          model,
          [
            {
              tag: "WebSocketSend",
              webSocket: msg.webSocket,
              message: {
                tag: "StatusChanged",
                status: {
                  tag: "ClientError",
                  message: errorMessage,
                },
              },
            },
          ],
        ];

        const result = parseWebSocketToServerMessage(msg.data);

        switch (result.tag) {
          case "Success":
            return onWebSocketToServerMessage(
              model,
              msg.webSocket,
              result.message
            );

          case "UnsupportedDataType":
            return onError(Errors.webSocketUnsupportedDataType());

          case "DecodeError":
            return onError(Errors.webSocketDecodeError(result.error));
        }
      }

      case "WebSocketClosed":
        return [model, [{ tag: "WebSocketRemove", webSocket: msg.webSocket }]];
    }
  };

function onWatcherEvent(
  now: Date,
  project: Project,
  eventName: WatcherEventName,
  absolutePathString: string,
  nextAction: NextAction
): [NextAction, Array<Cmd>] | undefined {
  if (absolutePathString.endsWith(".elm")) {
    return onElmFileWatcherEvent(
      project,
      makeEvent(eventName, absolutePathString, now),
      nextAction
    );
  }

  const basename = path.basename(absolutePathString);

  switch (basename) {
    case "elm-tooling.json":
      switch (eventName) {
        case "added":
          return makeRestartNextAction(
            restartBecauseJsonFileChangedMessage(basename, eventName),
            makeEvent(eventName, absolutePathString, now),
            nextAction,
            project
          );

        case "changed":
        case "removed":
          if (
            absolutePathString ===
            project.elmToolingJsonPath.theElmToolingJsonPath.absolutePath
          ) {
            return makeRestartNextAction(
              restartBecauseJsonFileChangedMessage(basename, eventName),
              makeEvent(eventName, absolutePathString, now),
              nextAction,
              project
            );
          }
          return undefined;
      }

    case "elm.json":
      switch (eventName) {
        case "added":
          return makeRestartNextAction(
            restartBecauseJsonFileChangedMessage(basename, eventName),
            makeEvent(eventName, absolutePathString, now),
            nextAction,
            project
          );

        case "changed":
        case "removed":
          if (
            Array.from(project.elmJsons).some(
              ([elmJsonPath]) =>
                absolutePathString === elmJsonPath.theElmJsonPath.absolutePath
            )
          ) {
            return makeRestartNextAction(
              restartBecauseJsonFileChangedMessage(basename, eventName),
              makeEvent(eventName, absolutePathString, now),
              nextAction,
              project
            );
          }
          return undefined;
      }

    default:
      // Ignore other types of files.
      return undefined;
  }
}

function onElmFileWatcherEvent(
  project: Project,
  event: WatcherEvent,
  nextAction: NextAction
): [NextAction, Array<Cmd>] | undefined {
  const elmFile = event.file;

  if (isRelatedToElmJsonsErrors(elmFile, project.elmJsonsErrors)) {
    return makeRestartNextAction(
      restartBecauseRelatedToElmJsonsErrorsMessage(event.eventName),
      event,
      nextAction,
      project
    );
  }

  const dirtyOutputs: Array<{
    outputPath: OutputPath;
    outputState: OutputState;
  }> = [];

  for (const [, outputs] of project.elmJsons) {
    for (const [outputPath, outputState] of outputs) {
      if (event.eventName === "removed") {
        for (const inputPath of outputState.inputs) {
          if (equalsInputPath(elmFile, inputPath)) {
            return makeRestartNextAction(
              restartBecauseInputWasRemovedMessage(),
              event,
              nextAction,
              project
            );
          }
        }
      }
      if (outputState.allRelatedElmFilePaths.has(elmFile.absolutePath)) {
        dirtyOutputs.push({ outputPath, outputState });
      }
    }
  }

  if (isNonEmptyArray(dirtyOutputs)) {
    const cmd: Cmd = { tag: "MarkAsDirty", outputs: dirtyOutputs };
    switch (nextAction.tag) {
      case "Restart":
        return [nextAction, [cmd]];

      case "Compile":
        return [
          {
            tag: "Compile",
            events: [...nextAction.events, event],
          },
          [cmd],
        ];

      case "NoAction":
      case "PrintNonInterestingEvents":
        return [
          {
            tag: "Compile",
            events: [event],
          },
          [cmd],
        ];
    }
  } else {
    switch (nextAction.tag) {
      case "Restart":
      case "Compile":
        return [nextAction, []];

      case "NoAction":
        return [
          {
            tag: "PrintNonInterestingEvents",
            events: [event],
          },
          [],
        ];

      case "PrintNonInterestingEvents":
        return [
          {
            tag: "PrintNonInterestingEvents",
            events: [...nextAction.events, event],
          },
          [],
        ];
    }
  }
}

function runNextAction(
  start: Date,
  project: Project,
  model: Model
): [Model, Array<Cmd>] {
  switch (model.nextAction.tag) {
    case "NoAction":
      return [model, []];

    case "Restart": {
      const { eventsWithMessages } = model.nextAction;
      const events = mapNonEmptyArray(eventsWithMessages, ({ event }) => event);

      switch (model.hotState.tag) {
        case "Idle":
          return [
            { ...model, hotState: { tag: "Restarting", events } },
            [
              { tag: "ClearScreen" },
              { tag: "Restart", restartReasons: events },
            ],
          ];

        case "Dependencies":
        case "Compiling": {
          return [
            { ...model, hotState: { tag: "Restarting", events } },
            // The actual restart is triggered once the current compilation is over.
            [
              { tag: "ClearScreen" },
              {
                tag: "LogInfoMessageWithTimeline",
                message: restartingMessage(eventsWithMessages),
                events,
              },
            ],
          ];
        }

        case "Restarting":
          return [model, []];
      }
    }

    case "Compile":
      return runCompile(model, model.nextAction.events, start, {
        clearScreen: true,
      });

    case "PrintNonInterestingEvents":
      switch (model.hotState.tag) {
        case "Idle":
          return [
            model,
            [
              {
                tag: "LogInfoMessageWithTimeline",
                message: notInterestingElmFileChangedMessage(
                  model.nextAction.events,
                  project.disabledOutputs
                ),
                events: model.nextAction.events,
              },
              {
                tag: "RunOnIdle",
              },
            ],
          ];

        case "Compiling":
        case "Dependencies":
        case "Restarting":
          return [model, []];
      }
  }
}

function runCompile(
  model: Model,
  events: Array<WatcherEvent>,
  start: Date,
  { clearScreen = false }
): [Model, Array<Cmd>] {
  switch (model.hotState.tag) {
    case "Idle": {
      return [
        {
          ...model,
          hotState: {
            tag: "Compiling",
            start,
            events,
            keepConsumingDirty: false,
          },
        },
        [
          clearScreen ? { tag: "ClearScreen" } : { tag: "NoCmd" },
          { tag: "PrintStatusLinesForElmJsonsErrors" },
          { tag: "CompileAllOutputs" },
        ],
      ];
    }

    case "Compiling":
      return [
        {
          ...model,
          hotState: {
            ...model.hotState,
            keepConsumingDirty: true,
            events: [...model.hotState.events, ...events],
          },
        },
        [{ tag: "CompileAllOutputs" }],
      ];

    case "Dependencies":
      return [
        {
          ...model,
          hotState: {
            ...model.hotState,
            events: [...model.hotState.events, ...events],
          },
        },
        [],
      ];

    case "Restarting":
      return [model, []];
  }
}

const runCmd =
  (env: Env, logger: Logger, getNow: GetNow, onIdle: OnIdle | undefined) =>
  (
    cmd: Cmd,
    mutable: Mutable,
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: HotRunResult) => void,
    rejectPromise: (error: Error) => void
  ): void => {
    switch (cmd.tag) {
      case "ChangeCompilationMode": {
        const flatOutputs = getFlatOutputs(mutable.project);
        for (const webSocketConnection of mutable.webSocketConnections) {
          if (webSocketConnection.webSocket === cmd.webSocket) {
            for (const { outputPath, outputState } of flatOutputs) {
              if (
                webSocketConnectionIsForOutputPath(
                  webSocketConnection,
                  outputPath
                )
              ) {
                outputState.compilationMode = cmd.compilationMode;
                outputState.dirty = true;
                webSocketSend(webSocketConnection.webSocket, {
                  tag: "StatusChanged",
                  status: { tag: "Compiling" },
                });
              }
            }
          }
        }
        return;
      }

      case "ClearScreen":
        logger.clearScreen();
        mutable.lastInfoMessage = undefined;
        return;

      case "CompileAllOutputs": {
        const flatOutputs = getFlatOutputs(mutable.project);

        Compile.printSpaceForOutputs(logger, flatOutputs.length);

        let outputIndex = -1;
        for (const [elmJsonPath, outputs] of mutable.project.elmJsons) {
          const candidates = Array.from(outputs).flatMap(
            // eslint-disable-next-line @typescript-eslint/no-loop-func
            ([outputPath, outputState]) => {
              outputIndex++;
              switch (outputState.status.tag) {
                case "ElmMake":
                case "ElmMakeTypecheckOnly":
                case "Postprocess":
                  return [];

                default:
                  return outputState.dirty &&
                    mutable.webSocketConnections.some((webSocketConnection) =>
                      webSocketConnectionIsForOutputPath(
                        webSocketConnection,
                        outputPath
                      )
                    )
                    ? [{ index: outputIndex, outputPath, outputState }]
                    : [];
              }
            }
          );

          if (isNonEmptyArray(candidates)) {
            Compile.typecheck({
              env,
              logger,
              elmJsonPath,
              outputs: candidates,
              total: flatOutputs.length,
            }).then(() => {
              dispatch({
                tag: "CompilationPartDone",
                date: getNow(),
                dirty: candidates.some(({ outputState }) => outputState.dirty),
              });
            }, rejectPromise);
          }
        }

        for (const {
          index,
          elmJsonPath,
          outputPath,
          outputState,
        } of flatOutputs) {
          switch (outputState.status.tag) {
            case "ElmMake":
            case "ElmMakeTypecheckOnly":
            case "Postprocess":
              // Already executing – when done they will re-execute if dirty
              // (unless we’re restarting or something like that).
              continue;

            default:
              Compile.compileOneOutput({
                env,
                logger,
                getNow,
                runMode: "hot",
                elmToolingJsonPath: mutable.project.elmToolingJsonPath,
                elmJsonPath,
                outputPath,
                outputState,
                index,
                total: flatOutputs.length,
              }).then(() => {
                dispatch({
                  tag: "CompilationPartDone",
                  date: getNow(),
                  dirty: outputState.dirty,
                });
              }, rejectPromise);
          }
        }
        return;
      }

      case "HandleElmWatchJsonWriteError":
        if (mutable.elmWatchJsonWriteError !== undefined) {
          // Retry writing it.
          writeElmWatchJson(mutable);
          // If still an error, print it.
          if (mutable.elmWatchJsonWriteError !== undefined) {
            logger.error("");
            logger.errorTemplate(
              Errors.elmWatchJsonWriteError(
                mutable.project.elmWatchJsonPath,
                mutable.elmWatchJsonWriteError
              )
            );
          }
        }
        return;

      case "InstallDependencies":
        Compile.installDependencies(env, logger, mutable.project).then(
          (installResult) => {
            dispatch({ tag: "InstallDependenciesDone", installResult });
          },
          rejectPromise
        );
        return;

      case "LogInfoMessageWithTimeline": {
        if (mutable.lastInfoMessage !== undefined && logger.raw.stderr.isTTY) {
          readline.moveCursor(
            logger.raw.stderr,
            0,
            -mutable.lastInfoMessage.split("\n").length
          );
          readline.clearScreenDown(logger.raw.stderr);
        }
        const fullMessage = infoMessageWithTimeline(
          getNow(),
          cmd.message,
          cmd.events
        );
        logger.error(fullMessage);
        mutable.lastInfoMessage = fullMessage;
        return;
      }

      case "MarkAsDirty":
        for (const { outputPath, outputState } of cmd.outputs) {
          outputState.dirty = true;
          webSocketSendToOutput(
            outputPath,
            { tag: "StatusChanged", status: { tag: "Compiling" } },
            mutable.webSocketConnections
          );
        }
        return;

      case "NoCmd":
        return;

      case "PrintCompileErrors":
        Compile.printErrors(logger, cmd.errors);
        return;

      case "PrintStatusLinesForElmJsonsErrors":
        Compile.printStatusLinesForElmJsonsErrors(logger, mutable.project);
        return;

      case "Restart": {
        // Outputs and port may have changed if elm-tooling.json changes.
        const elmToolingJsonChanged = cmd.restartReasons.some(
          ({ file }) => path.basename(file.absolutePath) === "elm-tooling.json"
        );
        mutable.webSocketServer.unsetDispatch();
        Promise.all([
          mutable.watcher.close(),
          elmToolingJsonChanged ? mutable.webSocketServer.close() : undefined,
        ]).then(() => {
          resolvePromise({
            tag: "Restart",
            restartReasons: cmd.restartReasons,
            webSocketState: elmToolingJsonChanged
              ? undefined
              : {
                  webSocketServer: mutable.webSocketServer,
                  webSocketConnections: mutable.webSocketConnections,
                },
          });
        }, rejectPromise);
        return;
      }

      case "RunOnIdle":
        if (onIdle !== undefined) {
          const response = onIdle();
          switch (response) {
            case "KeepGoing":
              return;
            case "Stop":
              mutable.watcher.close().then(() => {
                resolvePromise({ tag: "ExitOnIdle" });
              }, rejectPromise);
              return;
          }
        }
        return;

      case "SleepAfterWatcherEvent":
        // Sleep for a little bit to avoid unnecessary recompilation when using
        // “save all” in an editor, or when running `git switch some-branch` or
        // `git restore .`. These operations results in many files being
        // added/changed/deleted, usually with 0-1 ms between each event.
        if (mutable.watcherTimeoutId !== undefined) {
          clearTimeout(mutable.watcherTimeoutId);
        }
        mutable.watcherTimeoutId = setTimeout(() => {
          mutable.watcherTimeoutId = undefined;
          dispatch({ tag: "SleepAfterWatcherEventDone", date: getNow() });
        }, 10);
        return;

      case "Throw":
        rejectPromise(cmd.error);
        return;

      case "WebSocketAdd":
        mutable.webSocketConnections.push(cmd.webSocketConnection);
        return;

      case "WebSocketRemove":
        mutable.webSocketConnections = mutable.webSocketConnections.filter(
          ({ webSocket }) => webSocket !== cmd.webSocket
        );
        return;

      case "WebSocketSend":
        webSocketSend(cmd.webSocket, cmd.message);
        return;

      case "WebSocketSendToOutput":
        webSocketSendToOutput(
          cmd.outputPath,
          cmd.message,
          mutable.webSocketConnections
        );
        return;
    }
  };

function makeEvent(
  eventName: WatcherEventName,
  absolutePathString: string,
  date: Date
): WatcherEvent {
  return {
    date,
    eventName,
    file: {
      tag: "AbsolutePath",
      absolutePath: absolutePathString,
    },
  };
}

function makeRestartNextAction(
  message: string,
  event: WatcherEvent,
  nextAction: NextAction,
  project: Project
): [NextAction, Array<Cmd>] {
  return [
    {
      tag: "Restart",
      eventsWithMessages:
        nextAction.tag === "Restart"
          ? [...nextAction.eventsWithMessages, { event, message }]
          : [{ event, message }],
    },
    [
      {
        // Interrupt all compilation.
        tag: "MarkAsDirty",
        outputs: getFlatOutputs(project),
      },
    ],
  ];
}

function isRelatedToElmJsonsErrors(
  elmFile: AbsolutePath,
  elmJsonsErrors: Project["elmJsonsErrors"]
): boolean {
  return elmJsonsErrors.some(({ error }) => {
    switch (error.tag) {
      case "DuplicateInputs":
        return error.duplicates.some(
          ({ inputs, resolved }) =>
            resolved.absolutePath === elmFile.absolutePath ||
            inputs.some((inputPath) => equalsInputPath(elmFile, inputPath))
        );

      case "ElmJsonNotFound":
        return (
          error.elmJsonNotFound.some((inputPath) =>
            equalsInputPath(elmFile, inputPath)
          ) ||
          error.foundElmJsonPaths.some(({ inputPath }) =>
            equalsInputPath(elmFile, inputPath)
          )
        );

      case "InputsFailedToResolve":
        return error.inputsFailedToResolve.some(
          ({ inputPath }) =>
            inputPath.theUncheckedInputPath.absolutePath ===
            elmFile.absolutePath
        );

      case "InputsNotFound":
        return error.inputsNotFound.some(
          (inputPath) =>
            inputPath.theUncheckedInputPath.absolutePath ===
            elmFile.absolutePath
        );

      case "NonUniqueElmJsonPaths":
        return error.nonUniqueElmJsonPaths.some(({ inputPath }) =>
          equalsInputPath(elmFile, inputPath)
        );
    }
  });
}

function webSocketConnectionIsForOutputPath(
  webSocketConnection: WebSocketConnection,
  outputPath: OutputPath
): boolean {
  switch (webSocketConnection.outputPath.tag) {
    case "OutputPathError":
      return false;

    case "OutputPath":
      switch (outputPath.tag) {
        case "OutputPath":
          return (
            webSocketConnection.outputPath.theOutputPath.absolutePath ===
            outputPath.theOutputPath.absolutePath
          );

        case "NullOutputPath":
          return false;
      }

    case "NullOutputPath":
      switch (outputPath.tag) {
        case "OutputPath":
          return false;

        case "NullOutputPath":
          return true;
      }
  }
}

const WebSocketConnectedParams = Decode.fieldsAuto(
  {
    elmWatchVersion: Decode.string,
    output: Decode.string,
    compiledTimestamp: Decode.number,
  },
  { exact: "throw" }
);

type ParseWebSocketConnectRequestUrlResult =
  | ParseWebSocketConnectRequestUrlError
  | {
      tag: "Success";
      outputPath: OutputPath;
      outputState: OutputState;
      compiledTimestamp: number;
    };

type ParseWebSocketConnectRequestUrlError =
  | {
      tag: "BadUrl";
      expectedStart: "/?";
      actualUrlString: string;
    }
  | {
      tag: "OutputDisabled";
      output: string;
      enabledOutputs: Array<OutputPath>;
      disabledOutputs: Array<OutputPath>;
    }
  | {
      tag: "OutputNotFound";
      output: string;
      enabledOutputs: Array<OutputPath>;
      disabledOutputs: Array<OutputPath>;
    }
  | {
      tag: "ParamsDecodeError";
      error: Decode.DecoderError;
      actualUrlString: string;
    }
  | {
      tag: "WrongVersion";
      expectedVersion: "%VERSION%";
      actualVersion: string;
    };

function parseWebSocketConnectRequestUrl(
  project: Project,
  urlString: string
): ParseWebSocketConnectRequestUrlResult {
  if (!urlString.startsWith("/?")) {
    return {
      tag: "BadUrl",
      expectedStart: "/?",
      actualUrlString: urlString,
    };
  }

  // This never throws as far as I can tell.
  const params = new URLSearchParams(urlString.slice(2));

  let webSocketConnectedParams;
  try {
    webSocketConnectedParams = WebSocketConnectedParams(
      Object.fromEntries(params)
    );
  } catch (errorAny) {
    const error = errorAny as Decode.DecoderError;
    return {
      tag: "ParamsDecodeError",
      error,
      actualUrlString: urlString,
    };
  }

  if (webSocketConnectedParams.elmWatchVersion !== "%VERSION%") {
    return {
      tag: "WrongVersion",
      expectedVersion: "%VERSION%",
      actualVersion: webSocketConnectedParams.elmWatchVersion,
    };
  }

  const flatOutputs = getFlatOutputs(project);

  const { output } = webSocketConnectedParams;
  const match = flatOutputs.find(
    ({ outputPath }) => outputPathToOriginalString(outputPath) === output
  );

  if (match === undefined) {
    const enabledOutputs = flatOutputs.map(({ outputPath }) => outputPath);
    const disabledOutputs = Array.from(project.disabledOutputs);
    const disabledMatch = disabledOutputs.find(
      (outputPath) => outputPathToOriginalString(outputPath) === output
    );
    return disabledMatch === undefined
      ? {
          tag: "OutputNotFound",
          output,
          enabledOutputs,
          disabledOutputs,
        }
      : {
          tag: "OutputDisabled",
          output,
          enabledOutputs,
          disabledOutputs,
        };
  }

  return {
    tag: "Success",
    outputPath: match.outputPath,
    outputState: match.outputState,
    compiledTimestamp: webSocketConnectedParams.compiledTimestamp,
  };
}

type ParseWebSocketToServerMessageResult =
  | ParseWebSocketToServerMessageError
  | {
      tag: "Success";
      message: WebSocketToServerMessage;
    };

type ParseWebSocketToServerMessageError =
  | {
      tag: "DecodeError";
      error: Decode.DecoderError | SyntaxError;
    }
  | {
      tag: "UnsupportedDataType";
    };

function parseWebSocketToServerMessage(
  data: WebSocket.Data
): ParseWebSocketToServerMessageResult {
  if (typeof data !== "string") {
    return {
      tag: "UnsupportedDataType",
    };
  }

  try {
    return {
      tag: "Success",
      message: WebSocketToServerMessage(JSON.parse(data)),
    };
  } catch (errorAny) {
    const error = errorAny as Decode.DecoderError | SyntaxError;
    return { tag: "DecodeError", error };
  }
}

function outputStateToCmdsOnConnect(
  outputPath: OutputPath,
  outputState: OutputState,
  compiledTimestamp: number
): Array<Cmd> {
  switch (outputState.status.tag) {
    case "Success":
      return outputState.status.compiledTimestamp === compiledTimestamp
        ? [
            {
              tag: "WebSocketSendToOutput",
              outputPath,
              message: {
                tag: "StatusChanged",
                status: { tag: "SuccessfullyCompiled" },
              },
            },
          ]
        : [
            { tag: "MarkAsDirty", outputs: [{ outputPath, outputState }] },
            { tag: "CompileAllOutputs" },
          ];

    case "NotWrittenToDisk":
      return [
        { tag: "MarkAsDirty", outputs: [{ outputPath, outputState }] },
        { tag: "CompileAllOutputs" },
      ];

    case "ElmMake":
    case "Postprocess":
    case "Interrupted":
      return [
        {
          tag: "WebSocketSendToOutput",
          outputPath,
          message: {
            tag: "StatusChanged",
            status: { tag: "Compiling" },
          },
        },
      ];

    case "ElmMakeTypecheckOnly":
      // This results in re-compilation once done. This time, there is a web
      // socket connection, so it will be compiled to JS.
      return [{ tag: "MarkAsDirty", outputs: [{ outputPath, outputState }] }];

    default:
      return [
        {
          tag: "WebSocketSendToOutput",
          outputPath,
          message: {
            tag: "StatusChanged",
            status: { tag: "CompileError" },
          },
        },
      ];
  }
}

function onWebSocketToServerMessage(
  model: Model,
  webSocket: WebSocket,
  message: WebSocketToServerMessage
): [Model, Array<Cmd>] {
  switch (message.tag) {
    case "ChangeCompilationMode":
      return [
        model,
        [
          {
            tag: "ChangeCompilationMode",
            webSocket,
            compilationMode: message.compilationMode,
          },
        ],
      ];
  }
}

function webSocketSend(
  webSocket: WebSocket,
  message: WebSocketToClientMessage
): void {
  webSocket.send(JSON.stringify(message));
}

function webSocketSendToOutput(
  outputPath: OutputPath,
  message: WebSocketToClientMessage,
  webSocketConnections: Array<WebSocketConnection>
): void {
  for (const webSocketConnection of webSocketConnections) {
    if (webSocketConnectionIsForOutputPath(webSocketConnection, outputPath)) {
      webSocketSend(webSocketConnection.webSocket, message);
    }
  }
}

function infoMessageWithTimeline(
  date: Date,
  message: string,
  events: Array<WatcherEvent>
): string {
  return join(
    [
      "", // Empty line separator.
      printTimeline(events),
      `${bold(formatTime(date))} ${message}`,
    ].flatMap((part) => (part === undefined ? [] : part)),
    "\n"
  );
}

function printTimeline(events: Array<WatcherEvent>): string | undefined {
  if (!isNonEmptyArray(events)) {
    return undefined;
  }

  const first = events[0];
  const last = events.length >= 2 ? events[events.length - 1] : undefined;
  const numMoreEvents = events.length - 2;

  return dim(
    join(
      [
        printWatcherEvent(first),
        printNumMoreEvents(numMoreEvents),
        last === undefined ? undefined : printWatcherEvent(last),
      ].flatMap((part) => (part === undefined ? [] : part)),
      "\n"
    )
  );
}

function printWatcherEvent(event: WatcherEvent): string {
  return `${formatTime(event.date)} ${event.eventName} ${
    event.file.absolutePath
  }`;
}

function printNumMoreEvents(numMoreEvents: number): string | undefined {
  return numMoreEvents <= 0
    ? undefined
    : numMoreEvents === 1
    ? "(1 more event)"
    : `(${numMoreEvents} more events)`;
}

function restartBecauseJsonFileChangedMessage(
  changedFile: "elm-tooling.json" | "elm.json",
  eventName: WatcherEventName
): string {
  return `An ${bold(changedFile)} file ${eventName}.`;
}

function restartBecauseRelatedToElmJsonsErrorsMessage(
  eventName: WatcherEventName
): string {
  return `A problematic input Elm file was ${eventName}.`;
}

function restartBecauseInputWasRemovedMessage(): string {
  return "An input Elm file was removed.";
}

function restartingMessage(
  events: NonEmptyArray<{ event: WatcherEvent; message: string }>
): string {
  return join(
    [
      ...new Set(mapNonEmptyArray(events, ({ message }) => message)),
      "Restarting!",
    ],
    "\n"
  );
}

function compileFinishedMessage(duration: number): string {
  return `Compilation finished in ${bold(duration.toString())} ms.`;
}

function notInterestingElmFileChangedMessage(
  events: NonEmptyArray<WatcherEvent>,
  disabledOutputs: HashSet<OutputPath>
): string {
  const what1 = events.length === 1 ? "file is" : "files are";
  const what2 =
    disabledOutputs.size > 0 ? "any of the enabled outputs" : "any output";
  return `FYI: The above Elm ${what1} not imported by ${what2}. Nothing to do!`;
}
