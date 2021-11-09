import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import * as Decode from "tiny-decoders";
import { URLSearchParams } from "url";
import type WebSocket from "ws";

import {
  encodeWebSocketToClientMessage,
  WebSocketToClientMessage,
  WebSocketToServerMessage,
} from "../client/WebSocketMessages";
import * as Compile from "./Compile";
import { ElmWatchStuffJsonWritable } from "./ElmWatchStuffJson";
import * as Errors from "./Errors";
import { ErrorTemplate } from "./Errors";
import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import {
  bold,
  capitalize,
  dim,
  Env,
  formatTime,
  join,
  JsonError,
  silentlyReadIntEnvValue,
  toError,
  toJsonError,
} from "./Helpers";
import type { Logger } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { absoluteDirname } from "./PathHelpers";
import { PortChoice } from "./Port";
import { PostprocessWorkerPool } from "./Postprocess";
import { getFlatOutputs, OutputError, OutputState, Project } from "./Project";
import { runTeaProgram } from "./TeaProgram";
import {
  AbsolutePath,
  CompilationMode,
  ElmWatchJsonPath,
  equalsInputPath,
  GetNow,
  OnIdle,
  OutputPath,
} from "./Types";
import { WebSocketServer, WebSocketServerMsg } from "./WebSocketServer";

type WatcherEventName = "added" | "changed" | "removed";

export type WatcherEvent = {
  tag: "WatcherEvent";
  date: Date;
  eventName: WatcherEventName;
  file: AbsolutePath;
};

export type WebSocketRelatedEvent =
  | {
      tag: "WebSocketChangedCompilationModeEvent";
      date: Date;
      outputPath: OutputPath;
      compilationMode: CompilationMode;
    }
  | {
      tag: "WebSocketConnectedEvent";
      date: Date;
      outputPath: OutputPath;
    };

type Mutable = {
  watcher: chokidar.FSWatcher;
  postprocessWorkerPool: PostprocessWorkerPool;
  webSocketServer: WebSocketServer;
  webSocketConnections: Array<WebSocketConnection>;
  lastWebSocketCloseTimestamp: number | undefined;
  workerLimitTimeoutMs: number;
  project: Project;
  lastInfoMessage: string | undefined;
  watcherTimeoutId: NodeJS.Timeout | undefined;
  elmWatchStuffJsonWriteError: Error | undefined;
  versionedIdentifier: Buffer;
};

type WebSocketConnection = {
  webSocket: WebSocket;
  outputPath: OutputPath | { tag: "OutputPathError" };
  priority: number;
};

type Msg =
  | {
      tag: "CompilationPartDone";
      date: Date;
      prioritizedOutputs: HashMap<OutputPath, number>;
      handleOutputActionResult: Compile.HandleOutputActionResult;
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
      tag: "SleepBeforeNextActionDone";
      date: Date;
    }
  | {
      tag: "WebSocketConnected";
      date: Date;
      webSocket: WebSocket;
      parseWebSocketConnectRequestUrlResult: ParseWebSocketConnectRequestUrlResult;
    }
  | {
      tag: "WebSocketMessageReceived";
      date: Date;
      outputPath: OutputPath;
      outputState: OutputState;
      webSocket: WebSocket;
      data: WebSocket.Data;
    }
  | {
      tag: "WorkerLimitTimeoutPassed";
    };

type Model = {
  nextAction: NextAction;
  hotState: HotState;
};

type NextAction =
  | {
      tag: "Compile";
      events: NonEmptyArray<WatcherEvent | WebSocketRelatedEvent>;
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
      events: Array<WatcherEvent | WebSocketRelatedEvent>;
    }
  | {
      tag: "Dependencies";
      start: Date;
      events: Array<WatcherEvent | WebSocketRelatedEvent>;
    }
  | {
      tag: "Idle";
    }
  | {
      tag: "Restarting";
      events: NonEmptyArray<WatcherEvent | WebSocketRelatedEvent>;
    };

type Cmd =
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
      tag: "HandleElmWatchStuffJsonWriteError";
    }
  | {
      tag: "InstallDependencies";
    }
  | {
      tag: "LimitWorkers";
    }
  | {
      tag: "LogInfoMessageWithTimeline";
      message: string;
      events: Array<WatcherEvent | WebSocketRelatedEvent>;
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
      tag: "Restart";
      restartReasons: NonEmptyArray<WatcherEvent | WebSocketRelatedEvent>;
    }
  | {
      tag: "RunOnIdle";
    }
  | {
      tag: "SleepBeforeNextAction";
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
      tag: "WebSocketSendToOutput";
      outputPath: OutputPath;
      message: WebSocketToClientMessage;
    }
  | {
      tag: "WebSocketUpdatePriority";
      webSocket: WebSocket;
    };

export type HotRunResult =
  | {
      tag: "ExitOnIdle";
    }
  | {
      tag: "Restart";
      restartReasons: NonEmptyArray<WatcherEvent | WebSocketRelatedEvent>;
      postprocessWorkerPool: PostprocessWorkerPool;
      webSocketState: WebSocketState | undefined;
    };

export type WebSocketState = {
  webSocketServer: WebSocketServer;
  webSocketConnections: Array<WebSocketConnection>;
};

// This uses something inspired by The Elm Architecture, since it’s all about
// keeping state (model) and reacting to events (messages).
export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  restartReasons: Array<WatcherEvent | WebSocketRelatedEvent>,
  postprocessWorkerPool: PostprocessWorkerPool,
  webSocketState: WebSocketState | undefined,
  project: Project,
  portChoice: PortChoice
): Promise<HotRunResult> {
  return runTeaProgram<Mutable, Msg, Model, Cmd, HotRunResult>({
    initMutable: initMutable(
      env,
      getNow,
      postprocessWorkerPool,
      webSocketState,
      project,
      portChoice
    ),
    init: init(getNow(), restartReasons),
    update: update(project),
    runCmd: runCmd(env, logger, getNow, onIdle),
  });
}

export async function watchElmWatchJsonOnce(
  getNow: GetNow,
  elmWatchJsonPath: ElmWatchJsonPath
): Promise<WatcherEvent> {
  return new Promise((resolve, reject) => {
    const watcher = chokidar.watch(
      elmWatchJsonPath.theElmWatchJsonPath.absolutePath,
      {
        ignoreInitial: true,
        disableGlobbing: true,
      }
    );

    watcherOnAll(watcher, reject, (eventName, absolutePathString) => {
      const event: WatcherEvent = {
        tag: "WatcherEvent",
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
    env: Env,
    getNow: GetNow,
    postprocessWorkerPool: PostprocessWorkerPool,
    webSocketState: WebSocketState | undefined,
    project: Project,
    portChoice: PortChoice
  ) =>
  (
    dispatch: (msg: Msg) => void,
    rejectPromise: (error: Error) => void
  ): Mutable => {
    // The more targets that are enabled by connecting websockets, the more
    // workers we might have. Terminate unnecessary idle workers as websockets
    // close. But wait a while first: We don’t want to terminate workers just
    // because the user refreshed the page (which results in a disconnect +
    // connect).
    const workerLimitTimeoutMs = silentlyReadIntEnvValue(
      env.__ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS,
      10000
    );

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

    const mutable: Mutable = {
      watcher,
      postprocessWorkerPool,
      webSocketServer,
      webSocketConnections,
      lastWebSocketCloseTimestamp: undefined,
      workerLimitTimeoutMs,
      project,
      lastInfoMessage: undefined,
      watcherTimeoutId: undefined,
      elmWatchStuffJsonWriteError: undefined,
      // When only typechecking, don’t write a proxy file if:
      // - The output exists.
      // - And it was created by `elm-watch hot`. (`elm-watch make` output does not contain WebSocket stuff).
      // - And it was created by the same version of `elm-watch`. (Older versions could have bugs.)
      // - And it used the same WebSocket port. (Otherwise it will never connect to us.)
      versionedIdentifier: Buffer.from(
        `// elm-watch hot ${JSON.stringify({
          version: "%VERSION%",
          webSocketPort: webSocketServer.port.thePort,
        })}\n`
      ),
    };

    webSocketServer.setDispatch((msg) => {
      onWebSocketServerMsg(getNow(), mutable, dispatch, rejectPromise, msg);
    });

    postprocessWorkerPool.setCalculateMax(() =>
      mutable.lastWebSocketCloseTimestamp !== undefined &&
      getNow().getTime() >=
        mutable.lastWebSocketCloseTimestamp + workerLimitTimeoutMs
        ? // Save one worker, so we always have one “warmed up” worker ready to go
          // when needed.
          Math.max(1, makePrioritizedOutputs(mutable.webSocketConnections).size)
        : Infinity
    );

    writeElmWatchStuffJson(mutable);

    return mutable;
  };

function writeElmWatchStuffJson(mutable: Mutable): void {
  const json: ElmWatchStuffJsonWritable = {
    port: mutable.webSocketServer.port.thePort,
    targets: Object.fromEntries(
      getFlatOutputs(mutable.project).flatMap(({ outputPath, outputState }) =>
        outputState.compilationMode === "standard"
          ? []
          : [
              [
                outputPath.targetName,
                { compilationMode: outputState.compilationMode },
              ],
            ]
      )
    ),
  };

  try {
    fs.mkdirSync(
      absoluteDirname(
        mutable.project.elmWatchStuffJsonPath.theElmWatchStuffJsonPath
      ).absolutePath,
      { recursive: true }
    );

    fs.writeFileSync(
      mutable.project.elmWatchStuffJsonPath.theElmWatchStuffJsonPath
        .absolutePath,
      `${JSON.stringify(json, null, 4)}\n`
    );
    mutable.elmWatchStuffJsonWriteError = undefined;
  } catch (unknownError) {
    const error = toError(unknownError);
    mutable.elmWatchStuffJsonWriteError = error;
  }
}

function watcherOnAll(
  watcher: chokidar.FSWatcher,
  rejectPromise: (error: Error) => void,
  callback: (eventName: WatcherEventName, absolutePathString: string) => void
): void {
  // We generally only care about files – not directories – but adding and
  // removing directories can cause/fix errors, if they are named
  // `elm-watch.json`, `elm.json` or `*.elm`.
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
  restartReasons: Array<WatcherEvent | WebSocketRelatedEvent>
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
            nextAction: updatedNextAction,
          },
          [...cmds, { tag: "SleepBeforeNextAction" }],
        ];
      }

      case "SleepBeforeNextActionDone": {
        const [nextModel, cmds] = runNextAction(msg.date, project, model);
        return [
          {
            ...nextModel,
            nextAction: { tag: "NoAction" },
          },
          cmds,
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
                    `HotState became ${model.hotState.tag} while compiling!`
                  ),
                },
              ],
            ];

          case "Compiling": {
            const duration =
              msg.date.getTime() - model.hotState.start.getTime();

            const cmd = handleOutputActionResultToCmd(
              msg.handleOutputActionResult
            );

            if (outputActions.actions.length > 0) {
              return [
                model,
                [
                  cmd,
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
              return [model, [cmd]];
            }

            const errors = Compile.extractErrors(project);

            return [
              { ...model, hotState: { tag: "Idle" } },
              [
                cmd,
                isNonEmptyArray(errors)
                  ? { tag: "PrintCompileErrors", errors }
                  : { tag: "NoCmd" },
                {
                  tag: "HandleElmWatchStuffJsonWriteError",
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

          case "Restarting":
            return outputActions.numExecuting === 0
              ? [
                  model,
                  [{ tag: "Restart", restartReasons: model.hotState.events }],
                ]
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
                  [{ tag: "RunOnIdle" }],
                ];

              case "Success": {
                return [
                  {
                    ...model,
                    hotState: {
                      tag: "Compiling",
                      start: model.hotState.start,
                      events: model.hotState.events,
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
        const result = msg.parseWebSocketConnectRequestUrlResult;

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

        switch (result.tag) {
          case "Success": {
            const [nextModel, cmds] = onWebSocketConnected(
              msg.date,
              model,
              result.outputPath,
              result.outputState,
              result.elmCompiledTimestamp
            );

            return [nextModel, [...cmds, { tag: "SleepBeforeNextAction" }]];
          }

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

          case "TargetNotFound":
            return onError(
              Errors.webSocketTargetNotFound(
                result.targetName,
                result.enabledOutputs,
                result.disabledOutputs
              )
            );

          case "TargetDisabled":
            return onError(
              Errors.webSocketTargetDisabled(
                result.targetName,
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
              msg.date,
              msg.outputPath,
              msg.outputState,
              msg.webSocket,
              result.message
            );

          case "DecodeError":
            return onError(Errors.webSocketDecodeError(result.error));
        }
      }

      case "WorkerLimitTimeoutPassed":
        return [model, [{ tag: "LimitWorkers" }]];
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
      makeWatcherEvent(eventName, absolutePathString, now),
      nextAction
    );
  }

  const basename = path.basename(absolutePathString);

  switch (basename) {
    case "elm-watch.json":
      switch (eventName) {
        case "added":
          return makeRestartNextAction(
            restartBecauseJsonFileChangedMessage(basename, eventName),
            makeWatcherEvent(eventName, absolutePathString, now),
            nextAction,
            project
          );

        case "changed":
        case "removed":
          if (
            absolutePathString ===
            project.elmWatchJsonPath.theElmWatchJsonPath.absolutePath
          ) {
            return makeRestartNextAction(
              restartBecauseJsonFileChangedMessage(basename, eventName),
              makeWatcherEvent(eventName, absolutePathString, now),
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
            makeWatcherEvent(eventName, absolutePathString, now),
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
              makeWatcherEvent(eventName, absolutePathString, now),
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
      return runCompile(model, model.nextAction.events, start);

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
  events: Array<WatcherEvent | WebSocketRelatedEvent>,
  start: Date
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
          },
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
        {
          ...model,
          hotState: {
            ...model.hotState,
            events: [...model.hotState.events, ...events],
          },
        },
        [
          {
            tag: "CompileAllOutputsAsNeeded",
            mode: "ContinueCompilation",
            includeInterrupted: true,
          },
        ],
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
      case "ChangeCompilationMode":
        cmd.outputState.compilationMode = cmd.compilationMode;
        writeElmWatchStuffJson(mutable);
        return;

      case "ClearScreen":
        logger.clearScreen();
        mutable.lastInfoMessage = undefined;
        return;

      case "CompileAllOutputsAsNeeded": {
        const outputActions = Compile.getOutputActions({
          project: mutable.project,
          runMode: "hot",
          includeInterrupted: cmd.includeInterrupted,
          prioritizedOutputs: makePrioritizedOutputs(
            mutable.webSocketConnections
          ),
        });

        switch (cmd.mode) {
          case "AfterInstallDependencies":
            Compile.printStatusLinesForElmJsonsErrors(logger, mutable.project);
            Compile.printSpaceForOutputs(logger, outputActions);
            break;

          case "AfterIdle":
            logger.clearScreen();
            mutable.lastInfoMessage = undefined;
            Compile.printStatusLinesForElmJsonsErrors(logger, mutable.project);
            Compile.printSpaceForOutputs(logger, outputActions);
            break;

          case "ContinueCompilation":
            break;
        }

        if (isNonEmptyArray(outputActions.actions)) {
          for (const action of outputActions.actions) {
            Compile.handleOutputAction({
              env,
              logger,
              getNow,
              runMode: {
                tag: "hot",
                versionedIdentifier: mutable.versionedIdentifier,
                webSocketPort: mutable.webSocketServer.port,
              },
              elmWatchJsonPath: mutable.project.elmWatchJsonPath,
              total: outputActions.total,
              action,
              postprocess: mutable.project.postprocess,
              postprocessWorkerPool: mutable.postprocessWorkerPool,
            }).then((handleOutputActionResult) => {
              dispatch({
                tag: "CompilationPartDone",
                date: getNow(),
                prioritizedOutputs: makePrioritizedOutputs(
                  mutable.webSocketConnections
                ),
                handleOutputActionResult,
              });
            }, rejectPromise);
          }
        } else if (outputActions.numExecuting === 0) {
          dispatch({
            tag: "CompilationPartDone",
            date: getNow(),
            prioritizedOutputs: makePrioritizedOutputs(
              mutable.webSocketConnections
            ),
            handleOutputActionResult: { tag: "Nothing" },
          });
        }
        return;
      }

      case "HandleElmWatchStuffJsonWriteError":
        if (mutable.elmWatchStuffJsonWriteError !== undefined) {
          // Retry writing it.
          writeElmWatchStuffJson(mutable);
          // If still an error, print it.
          if (mutable.elmWatchStuffJsonWriteError !== undefined) {
            logger.error("");
            logger.errorTemplate(
              Errors.elmWatchStuffJsonWriteError(
                mutable.project.elmWatchStuffJsonPath,
                mutable.elmWatchStuffJsonWriteError
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

      case "LimitWorkers":
        mutable.postprocessWorkerPool.limit().catch(rejectPromise);
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
          if (outputState.status.tag === "Postprocess") {
            outputState.status.kill().catch(rejectPromise);
          }
          webSocketSendToOutput(
            outputPath,
            {
              tag: "StatusChanged",
              status: {
                tag: "Busy",
                compilationMode: outputState.compilationMode,
              },
            },
            mutable.webSocketConnections
          );
        }
        return;

      case "NoCmd":
        return;

      case "PrintCompileErrors":
        Compile.printErrors(logger, cmd.errors);
        return;

      case "Restart": {
        // Outputs and port may have changed if elm-watch.json changes.
        const elmWatchJsonChanged = cmd.restartReasons.some((event) => {
          switch (event.tag) {
            case "WatcherEvent":
              return (
                path.basename(event.file.absolutePath) === "elm-watch.json"
              );
            case "WebSocketConnectedEvent":
            case "WebSocketChangedCompilationModeEvent":
              return false;
          }
        });
        mutable.webSocketServer.unsetDispatch();
        Promise.all([
          mutable.watcher.close(),
          elmWatchJsonChanged ? mutable.webSocketServer.close() : undefined,
          elmWatchJsonChanged
            ? mutable.postprocessWorkerPool.terminate()
            : undefined,
        ]).then(() => {
          resolvePromise({
            tag: "Restart",
            restartReasons: cmd.restartReasons,
            postprocessWorkerPool: mutable.postprocessWorkerPool,
            webSocketState: elmWatchJsonChanged
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
              Promise.all([
                mutable.watcher.close(),
                mutable.webSocketServer.close(),
                mutable.postprocessWorkerPool.terminate(),
              ]).then(() => {
                resolvePromise({ tag: "ExitOnIdle" });
              }, rejectPromise);
              return;
          }
        }
        return;

      case "SleepBeforeNextAction":
        // Sleep for a little bit to avoid unnecessary recompilation when using
        // “save all” in an editor, or when running `git switch some-branch` or
        // `git restore .`. These operations results in many files being
        // added/changed/deleted, usually with 0-1 ms between each event.
        if (mutable.watcherTimeoutId !== undefined) {
          clearTimeout(mutable.watcherTimeoutId);
        }
        mutable.watcherTimeoutId = setTimeout(() => {
          mutable.watcherTimeoutId = undefined;
          dispatch({ tag: "SleepBeforeNextActionDone", date: getNow() });
        }, 10);
        return;

      case "Throw":
        rejectPromise(cmd.error);
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

      case "WebSocketUpdatePriority":
        for (const webSocketConnection of mutable.webSocketConnections) {
          if (webSocketConnection.webSocket === cmd.webSocket) {
            webSocketConnection.priority = getNow().getTime();
          }
        }
        return;
    }
  };

function onWebSocketServerMsg(
  now: Date,
  mutable: Mutable,
  dispatch: (msg: Msg) => void,
  rejectPromise: (error: Error) => void,
  msg: WebSocketServerMsg
): void {
  switch (msg.tag) {
    case "WebSocketConnected": {
      const result = parseWebSocketConnectRequestUrl(
        mutable.project,
        msg.urlString
      );
      const webSocketConnection: WebSocketConnection = {
        webSocket: msg.webSocket,
        outputPath:
          result.tag === "Success"
            ? result.outputPath
            : { tag: "OutputPathError" },
        priority: now.getTime(),
      };
      mutable.webSocketConnections.push(webSocketConnection);
      dispatch({
        tag: "WebSocketConnected",
        date: now,
        parseWebSocketConnectRequestUrlResult: result,
        webSocket: msg.webSocket,
      });
      return;
    }

    case "WebSocketClosed":
      mutable.webSocketConnections = mutable.webSocketConnections.filter(
        ({ webSocket }) => webSocket !== msg.webSocket
      );
      mutable.lastWebSocketCloseTimestamp = now.getTime();
      setTimeout(() => {
        dispatch({ tag: "WorkerLimitTimeoutPassed" });
      }, mutable.workerLimitTimeoutMs);
      break;

    case "WebSocketMessageReceived": {
      const webSocketConnection = mutable.webSocketConnections.find(
        ({ webSocket }) => webSocket === msg.webSocket
      );

      if (webSocketConnection === undefined) {
        rejectPromise(
          new Error(
            `No web socket connection found for web socket message ${JSON.stringify(
              msg.tag
            )}`
          )
        );
        return;
      }

      const flatOutputs = getFlatOutputs(mutable.project);
      const output = flatOutputs.find(({ outputPath }) =>
        webSocketConnectionIsForOutputPath(webSocketConnection, outputPath)
      );

      if (output === undefined) {
        rejectPromise(
          new Error(
            `No output found for web socket message ${JSON.stringify(
              msg.tag
            )} and output path: ${JSON.stringify(
              webSocketConnection.outputPath
            )}`
          )
        );
        return;
      }

      dispatch({
        tag: "WebSocketMessageReceived",
        date: now,
        outputPath: output.outputPath,
        outputState: output.outputState,
        webSocket: msg.webSocket,
        data: msg.data,
      });
    }
  }
}

function handleOutputActionResultToCmd(
  handleOutputActionResult: Compile.HandleOutputActionResult
): Cmd {
  switch (handleOutputActionResult.tag) {
    case "CompileError":
      return {
        tag: "WebSocketSendToOutput",
        outputPath: handleOutputActionResult.outputPath,
        message: {
          tag: "StatusChanged",
          status: { tag: "CompileError" },
        },
      };

    case "FullyCompiledJS":
      return {
        tag: "WebSocketSendToOutput",
        outputPath: handleOutputActionResult.outputPath,
        message: {
          tag: "SuccessfullyCompiled",
          code: handleOutputActionResult.code.toString("utf8"),
          elmCompiledTimestamp: handleOutputActionResult.elmCompiledTimestamp,
          compilationMode: handleOutputActionResult.compilationMode,
        },
      };

    case "Nothing":
      return { tag: "NoCmd" };
  }
}

function makePrioritizedOutputs(
  webSocketConnections: Array<WebSocketConnection>
): HashMap<OutputPath, number> {
  const map = new HashMap<OutputPath, number>();
  for (const { outputPath, priority } of webSocketConnections) {
    if (outputPath.tag !== "OutputPathError") {
      const previous = map.get(outputPath) ?? 0;
      map.set(outputPath, Math.max(priority, previous));
    }
  }
  return map;
}

function makeWatcherEvent(
  eventName: WatcherEventName,
  absolutePathString: string,
  date: Date
): WatcherEvent {
  return {
    tag: "WatcherEvent",
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
      return (
        webSocketConnection.outputPath.theOutputPath.absolutePath ===
        outputPath.theOutputPath.absolutePath
      );
  }
}

const WebSocketConnectedParams = Decode.fieldsAuto(
  {
    elmWatchVersion: Decode.string,
    targetName: Decode.string,
    elmCompiledTimestamp: Decode.chain(Decode.string, Number),
  },
  { exact: "throw" }
);

type ParseWebSocketConnectRequestUrlResult =
  | ParseWebSocketConnectRequestUrlError
  | {
      tag: "Success";
      outputPath: OutputPath;
      outputState: OutputState;
      elmCompiledTimestamp: number;
    };

type ParseWebSocketConnectRequestUrlError =
  | {
      tag: "BadUrl";
      expectedStart: "/?";
      actualUrlString: string;
    }
  | {
      tag: "ParamsDecodeError";
      error: JsonError;
      actualUrlString: string;
    }
  | {
      tag: "TargetDisabled";
      targetName: string;
      enabledOutputs: Array<OutputPath>;
      disabledOutputs: Array<OutputPath>;
    }
  | {
      tag: "TargetNotFound";
      targetName: string;
      enabledOutputs: Array<OutputPath>;
      disabledOutputs: Array<OutputPath>;
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
  } catch (unknownError) {
    const error = toJsonError(unknownError);
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

  const { targetName } = webSocketConnectedParams;
  const match = flatOutputs.find(
    ({ outputPath }) => outputPath.targetName === targetName
  );

  if (match === undefined) {
    const enabledOutputs = flatOutputs.map(({ outputPath }) => outputPath);
    const disabledOutputs = Array.from(project.disabledOutputs);
    const disabledMatch = disabledOutputs.find(
      (outputPath) => outputPath.targetName === targetName
    );
    return disabledMatch === undefined
      ? {
          tag: "TargetNotFound",
          targetName,
          enabledOutputs,
          disabledOutputs,
        }
      : {
          tag: "TargetDisabled",
          targetName,
          enabledOutputs,
          disabledOutputs,
        };
  }

  return {
    tag: "Success",
    outputPath: match.outputPath,
    outputState: match.outputState,
    elmCompiledTimestamp: webSocketConnectedParams.elmCompiledTimestamp,
  };
}

type ParseWebSocketToServerMessageResult =
  | {
      tag: "DecodeError";
      error: JsonError;
    }
  | {
      tag: "Success";
      message: WebSocketToServerMessage;
    };

function parseWebSocketToServerMessage(
  data: WebSocket.Data
): ParseWebSocketToServerMessageResult {
  const stringData =
    typeof data === "string"
      ? data
      : Array.isArray(data)
      ? Buffer.concat(data).toString("utf8")
      : data instanceof ArrayBuffer
      ? new TextDecoder("utf8").decode(data)
      : data.toString("utf8");

  try {
    return {
      tag: "Success",
      message: WebSocketToServerMessage(JSON.parse(stringData)),
    };
  } catch (unknownError) {
    const error = toJsonError(unknownError);
    return { tag: "DecodeError", error };
  }
}

function onWebSocketConnected(
  date: Date,
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState,
  elmCompiledTimestamp: number
): [Model, Array<Cmd>] {
  const event: WebSocketRelatedEvent = {
    tag: "WebSocketConnectedEvent",
    date,
    outputPath,
  };

  switch (model.hotState.tag) {
    case "Restarting":
      return [
        model,
        [
          {
            tag: "WebSocketSendToOutput",
            outputPath,
            message: {
              tag: "StatusChanged",
              status: {
                tag: "Busy",
                compilationMode: outputState.compilationMode,
              },
            },
          },
        ],
      ];

    case "Dependencies":
      return [
        {
          ...model,
          hotState: {
            ...model.hotState,
            events: [...model.hotState.events, event],
          },
        },
        [
          {
            tag: "WebSocketSendToOutput",
            outputPath,
            message: {
              tag: "StatusChanged",
              status: {
                tag: "Busy",
                compilationMode: outputState.compilationMode,
              },
            },
          },
        ],
      ];

    case "Idle":
    case "Compiling":
      switch (outputState.status.tag) {
        case "Success":
          return outputState.status.elmCompiledTimestamp ===
            elmCompiledTimestamp
            ? [
                model,
                [
                  {
                    tag: "WebSocketSendToOutput",
                    outputPath,
                    message: {
                      tag: "StatusChanged",
                      status: { tag: "AlreadyUpToDate" },
                    },
                  },
                ],
              ]
            : onWebSocketRecompileNeeded(event, model, outputPath, outputState);

        case "NotWrittenToDisk":
        case "ElmMakeTypecheckOnly":
          return onWebSocketRecompileNeeded(
            event,
            model,
            outputPath,
            outputState
          );

        case "ElmMake":
        case "Postprocess":
        case "Interrupted":
        case "QueuedForElmMake":
        case "QueuedForPostprocess":
          switch (model.hotState.tag) {
            case "Idle":
              return onWebSocketRecompileNeeded(
                event,
                model,
                outputPath,
                outputState
              );

            case "Compiling":
              return [
                {
                  ...model,
                  hotState: {
                    ...model.hotState,
                    events: [...model.hotState.events, event],
                  },
                },
                [
                  {
                    tag: "WebSocketSendToOutput",
                    outputPath,
                    message: {
                      tag: "StatusChanged",
                      status: {
                        tag: "Busy",
                        compilationMode: outputState.compilationMode,
                      },
                    },
                  },
                ],
              ];
          }

        default: {
          // Make sure only error statuses are left.
          const _: OutputError = outputState.status;
          void _;
          return [
            model,
            [
              {
                tag: "WebSocketSendToOutput",
                outputPath,
                message: {
                  tag: "StatusChanged",
                  status: { tag: "CompileError" },
                },
              },
            ],
          ];
        }
      }
  }
}

function onChangedCompilationMode(
  date: Date,
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState,
  newCompilationMode: CompilationMode
): [Model, Array<Cmd>] {
  const event: WebSocketRelatedEvent = {
    tag: "WebSocketChangedCompilationModeEvent",
    date,
    outputPath,
    compilationMode: newCompilationMode,
  };

  switch (model.hotState.tag) {
    case "Restarting":
      return [
        model,
        [
          {
            tag: "WebSocketSendToOutput",
            outputPath,
            message: {
              tag: "StatusChanged",
              status: {
                tag: "Busy",
                compilationMode: newCompilationMode,
              },
            },
          },
        ],
      ];

    case "Dependencies":
      return [
        {
          ...model,
          hotState: {
            ...model.hotState,
            events: [...model.hotState.events, event],
          },
        },
        [
          {
            tag: "WebSocketSendToOutput",
            outputPath,
            message: {
              tag: "StatusChanged",
              status: {
                tag: "Busy",
                compilationMode: newCompilationMode,
              },
            },
          },
        ],
      ];

    case "Idle":
    case "Compiling":
      return onWebSocketRecompileNeeded(event, model, outputPath, outputState);
  }
}

function onWebSocketRecompileNeeded(
  event: WebSocketRelatedEvent,
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState
): [Model, Array<Cmd>] {
  switch (model.nextAction.tag) {
    case "Restart":
      return [
        model,
        [
          {
            tag: "WebSocketSendToOutput",
            outputPath,
            message: {
              tag: "StatusChanged",
              status: {
                tag: "Busy",
                compilationMode: outputState.compilationMode,
              },
            },
          },
        ],
      ];

    case "Compile":
      return [
        {
          ...model,
          nextAction: {
            tag: "Compile",
            events: [...model.nextAction.events, event],
          },
        },
        [
          {
            tag: "MarkAsDirty",
            outputs: [{ outputPath, outputState }],
          },
        ],
      ];

    case "NoAction":
    case "PrintNonInterestingEvents":
      return [
        {
          ...model,
          nextAction: {
            tag: "Compile",
            events: [event],
          },
        },
        [
          {
            tag: "MarkAsDirty",
            outputs: [{ outputPath, outputState }],
          },
        ],
      ];
  }
}

function onWebSocketToServerMessage(
  model: Model,
  date: Date,
  outputPath: OutputPath,
  outputState: OutputState,
  webSocket: WebSocket,
  message: WebSocketToServerMessage
): [Model, Array<Cmd>] {
  switch (message.tag) {
    case "ChangedCompilationMode": {
      const [nextModel, cmds] = onChangedCompilationMode(
        date,
        model,
        outputPath,
        outputState,
        message.compilationMode
      );

      return [
        nextModel,
        [
          {
            tag: "ChangeCompilationMode",
            outputState,
            compilationMode: message.compilationMode,
          },
          ...cmds,
          { tag: "SleepBeforeNextAction" },
        ],
      ];
    }

    case "FocusedTab":
      return [model, [{ tag: "WebSocketUpdatePriority", webSocket }]];
  }
}

function webSocketSend(
  webSocket: WebSocket,
  message: WebSocketToClientMessage
): void {
  webSocket.send(encodeWebSocketToClientMessage(message));
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
  events: Array<WatcherEvent | WebSocketRelatedEvent>
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

function printTimeline(
  events: Array<WatcherEvent | WebSocketRelatedEvent>
): string | undefined {
  if (!isNonEmptyArray(events)) {
    return undefined;
  }

  const first = events[0];
  const last = events.length >= 2 ? events[events.length - 1] : undefined;
  const numMoreEvents = events.length - 2;

  return dim(
    join(
      [
        printEvent(first),
        printNumMoreEvents(numMoreEvents),
        last === undefined ? undefined : printEvent(last),
      ].flatMap((part) => (part === undefined ? [] : part)),
      "\n"
    )
  );
}

function printEvent(event: WatcherEvent | WebSocketRelatedEvent): string {
  switch (event.tag) {
    case "WatcherEvent":
      return `${formatTime(event.date)} ${capitalize(event.eventName)} ${
        event.file.absolutePath
      }`;

    case "WebSocketConnectedEvent":
      return `${formatTime(
        event.date
      )} Web socket connected needing compilation of: ${
        event.outputPath.targetName
      }`;

    case "WebSocketChangedCompilationModeEvent":
      return `${formatTime(
        event.date
      )} Changed compilation mode to ${JSON.stringify(
        event.compilationMode
      )} of: ${event.outputPath.targetName}`;
  }
}

function printNumMoreEvents(numMoreEvents: number): string | undefined {
  return numMoreEvents <= 0
    ? undefined
    : numMoreEvents === 1
    ? "(1 more event)"
    : `(${numMoreEvents} more events)`;
}

function restartBecauseJsonFileChangedMessage(
  changedFile: "elm-watch.json" | "elm.json",
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
