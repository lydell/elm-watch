import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
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
import {
  __ELM_WATCH_EXIT_ON_ERROR,
  __ELM_WATCH_EXIT_ON_WORKER_LIMIT,
  __ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS,
  Env,
} from "./Env";
import * as Errors from "./Errors";
import { ErrorTemplate } from "./Errors";
import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import {
  bold,
  capitalize,
  dim,
  formatTime,
  join,
  JsonError,
  printDurationMs,
  silentlyReadIntEnvValue,
  toError,
  toJsonError,
} from "./Helpers";
import type { Logger, LoggerConfig } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { absoluteDirname, absolutePathFromString } from "./PathHelpers";
import { PortChoice } from "./Port";
import { PostprocessWorkerPool } from "./Postprocess";
import { ELM_WATCH_NODE } from "./PostprocessShared";
import {
  ElmJsonErrorWithMetadata,
  getFlatOutputs,
  OutputError,
  OutputState,
  Project,
} from "./Project";
import { runTeaProgram } from "./TeaProgram";
import {
  AbsolutePath,
  CompilationMode,
  ElmWatchJsonPath,
  equalsInputPath,
  GetNow,
  OutputPath,
} from "./Types";
import { WebSocketServer, WebSocketServerMsg } from "./WebSocketServer";

type WatcherEventName = "added" | "changed" | "removed";

type WatcherEvent = {
  tag: "WatcherEvent";
  date: Date;
  eventName: WatcherEventName;
  file: AbsolutePath;
};

type WebSocketRelatedEvent =
  | {
      tag: "WebSocketChangedCompilationMode";
      date: Date;
      outputPath: OutputPath;
      compilationMode: CompilationMode;
    }
  | {
      tag: "WebSocketClosed";
      date: Date;
      outputPath: OutputPath | OutputPathError;
    }
  | {
      tag: "WebSocketConnectedNeedingCompilation";
      date: Date;
      outputPath: OutputPath;
    }
  | {
      tag: "WebSocketConnectedNeedingNoAction";
      date: Date;
      outputPath: OutputPath;
    }
  | {
      tag: "WebSocketConnectedWithErrors";
      date: Date;
    }
  | {
      tag: "WorkersLimitedAfterWebSocketClosed";
      date: Date;
      numTerminatedWorkers: number;
    };

export type LatestEvent =
  | WebSocketRelatedEvent
  | (WatcherEvent & { affectsAnyTarget: boolean });

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
};

type WebSocketConnection = {
  webSocket: WebSocket;
  outputPath: OutputPath | OutputPathError;
  priority: number;
};

type OutputPathError = { tag: "OutputPathError" };

type WebSocketMessageReceivedOutput =
  | OutputPathError
  | {
      tag: "Output";
      outputPath: OutputPath;
      outputState: OutputState;
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
      tag: "WebSocketClosed";
      date: Date;
      outputPath: OutputPath | OutputPathError;
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
      output: WebSocketMessageReceivedOutput;
      webSocket: WebSocket;
      data: WebSocket.Data;
    }
  | {
      tag: "WorkerLimitTimeoutPassed";
    }
  | {
      tag: "WorkersLimited";
      date: Date;
      numTerminatedWorkers: number;
    };

type Model = {
  nextAction: NextAction;
  hotState: HotState;
  latestEvents: Array<LatestEvent>;
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
      tag: "ExitOnIdle";
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
      events: Array<LatestEvent>;
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
      restartReasons: Array<LatestEvent>;
    }
  | {
      tag: "RestartWorkers";
    }
  | {
      tag: "SleepBeforeNextAction";
      sleepMs: number;
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

type HotRunResult =
  | {
      tag: "ExitOnHandledFatalError";
      errorTemplate: Errors.ErrorTemplate;
    }
  | {
      tag: "ExitOnIdle";
    }
  | {
      tag: "Restart";
      restartReasons: Array<LatestEvent>;
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
  restartReasons: Array<LatestEvent>,
  postprocessWorkerPool: PostprocessWorkerPool,
  webSocketState: WebSocketState | undefined,
  project: Project,
  portChoice: PortChoice
): Promise<HotRunResult> {
  const exitOnError = __ELM_WATCH_EXIT_ON_ERROR in env;

  return runTeaProgram<Mutable, Msg, Model, Cmd, HotRunResult>({
    initMutable: initMutable(
      env,
      getNow,
      postprocessWorkerPool,
      webSocketState,
      project,
      portChoice
    ),
    init: init(getNow(), restartReasons, project.elmJsonsErrors),
    update: (msg: Msg, model: Model): [Model, Array<Cmd>] => {
      const [newModel, cmds] = update(
        logger.config,
        project,
        exitOnError,
        msg,
        model
      );
      const allCmds: Array<Cmd> = [
        ...cmds,
        newModel.latestEvents.length > model.latestEvents.length
          ? {
              tag: "SleepBeforeNextAction",
              sleepMs: getNextActionSleepMs(newModel.latestEvents),
            }
          : { tag: "NoCmd" },
      ];
      logger.debug(msg.tag, msg, newModel, allCmds);
      return [newModel, allCmds];
    },
    runCmd: runCmd(env, logger, getNow, exitOnError),
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
      watcher
        .close()
        .then(() => {
          resolve(event);
        })
        .catch(reject);
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
    resolvePromise: (result: HotRunResult) => void,
    rejectPromise: (error: Error) => void
  ): Mutable => {
    // The more targets that are enabled by connecting websockets, the more
    // workers we might have. Terminate unnecessary idle workers as websockets
    // close. But wait a while first: We don’t want to terminate workers just
    // because the user refreshed the page (which results in a disconnect +
    // connect).
    const workerLimitTimeoutMs = silentlyReadIntEnvValue(
      env[__ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS],
      10000
    );

    const watcher = chokidar.watch(project.watchRoot.absolutePath, {
      ignoreInitial: true,
      ignored: ["**/elm-stuff/**", "**/node_modules/**"],
      disableGlobbing: true,
    });

    watcherOnAll(
      watcher,
      (error) => {
        closeAll(mutable)
          .then(() => {
            resolvePromise({
              tag: "ExitOnHandledFatalError",
              errorTemplate: Errors.watcherError(error),
            });
          })
          .catch(rejectPromise);
      },
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
      webSocketServer = new WebSocketServer(portChoice),
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
    };

    webSocketServer.setDispatch((msg) => {
      onWebSocketServerMsg(
        getNow(),
        mutable,
        dispatch,
        resolvePromise,
        rejectPromise,
        msg
      );
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

    // The port isn’t finalized until a few moments later (when the persisted
    // port is not available).
    webSocketServer.listening
      .then(() => {
        writeElmWatchStuffJson(mutable);
      })
      .catch(rejectPromise);

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
  onError: (error: Error) => void,
  onSuccess: (eventName: WatcherEventName, absolutePathString: string) => void
): void {
  // We generally only care about files – not directories – but adding and
  // removing directories can cause/fix errors, if they are named
  // `elm-watch.json`, `elm.json` or `*.elm`.
  watcher.on("all", (chokidarEventName, absolutePathString) => {
    switch (chokidarEventName) {
      case "add":
      case "addDir":
        onSuccess("added", absolutePathString);
        return;

      case "unlink":
      case "unlinkDir":
        onSuccess("removed", absolutePathString);
        return;

      case "change":
        onSuccess("changed", absolutePathString);
        return;
    }
  });

  // The only way I’ve managed to make this emit an error, is when I made an
  // infinite symlink loop (ELOOP). That basically makes the watcher unusable:
  // it will always choke on that cycle and emit an error here.
  watcher.on("error", onError);
}

const init = (
  now: Date,
  restartReasons: Array<LatestEvent>,
  elmJsonsErrors: Array<ElmJsonErrorWithMetadata>
): [Model, Array<Cmd>] => [
  {
    nextAction: { tag: "NoAction" },
    hotState: {
      tag: "Dependencies",
      start: now,
    },
    latestEvents: restartReasons,
  },
  [
    { tag: "ClearScreen" },
    { tag: "InstallDependencies" },
    ...elmJsonsErrors.map(
      ({ outputPath, compilationMode }): Cmd => ({
        tag: "WebSocketSendToOutput",
        outputPath,
        message: {
          tag: "StatusChanged",
          status: {
            tag: "CompileError",
            compilationMode,
          },
        },
      })
    ),
  ],
];

function update(
  loggerConfig: LoggerConfig,
  project: Project,
  exitOnError: boolean,
  msg: Msg,
  model: Model
): [Model, Array<Cmd>] {
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

      const [updatedNextAction, latestEvent, cmds] = result;

      return [
        {
          ...model,
          nextAction: updatedNextAction,
          latestEvents: [...model.latestEvents, latestEvent],
        },
        cmds,
      ];
    }

    case "SleepBeforeNextActionDone": {
      const [newModel, cmds] = runNextAction(msg.date, project, model);
      return [
        {
          ...newModel,
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
        // istanbul ignore next
        case "Dependencies":
        // istanbul ignore next
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
          const duration = msg.date.getTime() - model.hotState.start.getTime();

          const cmd = handleOutputActionResultToCmd(
            msg.handleOutputActionResult
          );

          if (isNonEmptyArray(outputActions.actions)) {
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
            { ...model, hotState: { tag: "Idle" }, latestEvents: [] },
            [
              cmd,
              isNonEmptyArray(errors)
                ? { tag: "PrintCompileErrors", errors }
                : { tag: "NoCmd" },
              { tag: "HandleElmWatchStuffJsonWriteError" },
              {
                tag: "LogInfoMessageWithTimeline",
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
            : /* istanbul ignore next */ [model, []];
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
                  exitOnError
                    ? { tag: "ExitOnIdle" }
                    : /* istanbul ignore next */ { tag: "NoCmd" },
                ],
              ];

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

        // istanbul ignore next
        case "Idle":
        // istanbul ignore next
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

    case "WebSocketClosed":
      return [
        {
          ...model,
          latestEvents: [
            ...model.latestEvents,
            {
              tag: "WebSocketClosed",
              date: msg.date,
              outputPath: msg.outputPath,
            },
          ],
        },
        [],
      ];

    case "WebSocketConnected": {
      const result = msg.parseWebSocketConnectRequestUrlResult;

      switch (result.tag) {
        case "Success": {
          const [newModel, latestEvent, cmds] = onWebSocketConnected(
            msg.date,
            model,
            result.outputPath,
            result.outputState,
            result.elmCompiledTimestamp
          );
          return [
            {
              ...newModel,
              latestEvents: [...newModel.latestEvents, latestEvent],
            },
            cmds,
          ];
        }

        default:
          return [
            {
              ...model,
              latestEvents: [
                ...model.latestEvents,
                {
                  tag: "WebSocketConnectedWithErrors",
                  date: msg.date,
                },
              ],
            },
            [
              {
                tag: "WebSocketSend",
                webSocket: msg.webSocket,
                message: {
                  tag: "StatusChanged",
                  status: {
                    tag: "ClientError",
                    message: webSocketConnectRequestUrlErrorToString(result),
                  },
                },
              },
            ],
          ];
      }
    }

    case "WebSocketMessageReceived": {
      const result = parseWebSocketToServerMessage(msg.data);

      switch (result.tag) {
        case "Success":
          return onWebSocketToServerMessage(
            project,
            model,
            msg.date,
            msg.output,
            msg.webSocket,
            result.message
          );

        case "DecodeError":
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
                    message: Errors.webSocketDecodeError(result.error),
                  },
                },
              },
            ],
          ];
      }
    }

    case "WorkerLimitTimeoutPassed":
      return [model, [{ tag: "LimitWorkers" }]];

    case "WorkersLimited":
      return [
        {
          ...model,
          latestEvents: [
            ...model.latestEvents,
            {
              tag: "WorkersLimitedAfterWebSocketClosed",
              date: msg.date,
              numTerminatedWorkers: msg.numTerminatedWorkers,
            },
          ],
        },
        [],
      ];
  }
}

function onWatcherEvent(
  now: Date,
  project: Project,
  eventName: WatcherEventName,
  absolutePathString: string,
  nextAction: NextAction
): [NextAction, LatestEvent, Array<Cmd>] | undefined {
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
            makeWatcherEvent(eventName, absolutePathString, now),
            project
          );

        case "changed":
        case "removed":
          if (
            absolutePathString ===
            project.elmWatchJsonPath.theElmWatchJsonPath.absolutePath
          ) {
            return makeRestartNextAction(
              makeWatcherEvent(eventName, absolutePathString, now),
              project
            );
          }
          return undefined;
      }

    case "elm.json":
      switch (eventName) {
        case "added":
          return makeRestartNextAction(
            makeWatcherEvent(eventName, absolutePathString, now),
            project
          );

        case "changed":
        case "removed":
          if (
            Array.from(project.elmJsons).some(
              ([elmJsonPath]) =>
                absolutePathString === elmJsonPath.theElmJsonPath.absolutePath
            ) ||
            isElmJsonFileRelatedToElmJsonsErrors(
              absolutePathString,
              project.elmJsonsErrors
            )
          ) {
            return makeRestartNextAction(
              makeWatcherEvent(eventName, absolutePathString, now),
              project
            );
          }
          return undefined;
      }

    default:
      switch (project.postprocess.tag) {
        case "Postprocess": {
          const [commandName, scriptPathString] =
            project.postprocess.postprocessArray;
          if (
            commandName === ELM_WATCH_NODE &&
            scriptPathString !== undefined
          ) {
            const scriptPath = absolutePathFromString(
              absoluteDirname(project.elmWatchJsonPath.theElmWatchJsonPath),
              scriptPathString
            );
            if (absolutePathString === scriptPath.absolutePath) {
              return [
                compileNextAction(nextAction),
                {
                  ...makeWatcherEvent(eventName, absolutePathString, now),
                  affectsAnyTarget: true,
                },
                [
                  {
                    tag: "MarkAsDirty",
                    outputs: getFlatOutputs(project),
                  },
                  { tag: "RestartWorkers" },
                ],
              ];
            }
          }
          return undefined;
        }

        case "NoPostprocess":
          // Ignore other types of files.
          return undefined;
      }
  }
}

function onElmFileWatcherEvent(
  project: Project,
  event: WatcherEvent,
  nextAction: NextAction
): [NextAction, LatestEvent, Array<Cmd>] | undefined {
  const elmFile = event.file;

  if (isElmFileRelatedToElmJsonsErrors(elmFile, project.elmJsonsErrors)) {
    return makeRestartNextAction(event, project);
  }

  const dirtyOutputs: Array<{
    outputPath: OutputPath;
    outputState: OutputState;
  }> = [];

  for (const [elmJsonPath, outputs] of project.elmJsons) {
    for (const [outputPath, outputState] of outputs) {
      if (event.eventName === "removed") {
        for (const inputPath of outputState.inputs) {
          if (equalsInputPath(elmFile, inputPath)) {
            return makeRestartNextAction(event, project);
          }
        }
      }
      Compile.ensureAllRelatedElmFilePaths(elmJsonPath, outputState);
      if (outputState.allRelatedElmFilePaths.has(elmFile.absolutePath)) {
        dirtyOutputs.push({ outputPath, outputState });
      }
    }
  }

  return isNonEmptyArray(dirtyOutputs)
    ? [
        compileNextAction(nextAction),
        { ...event, affectsAnyTarget: true },
        [{ tag: "MarkAsDirty", outputs: dirtyOutputs }],
      ]
    : [nextAction, { ...event, affectsAnyTarget: false }, []];
}

function runNextAction(
  start: Date,
  project: Project,
  model: Model
): [Model, Array<Cmd>] {
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

        // istanbul ignore next
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

        // istanbul ignore next
        case "Dependencies":
        // istanbul ignore next
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
                    tag: "LogInfoMessageWithTimeline",
                    message: printEventsMessage(
                      model.latestEvents,
                      project.disabledOutputs
                    ),
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

const runCmd =
  (env: Env, logger: Logger, getNow: GetNow, exitOnError: boolean) =>
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
            Compile.printSpaceForOutputs(logger, "hot", outputActions);
            break;

          case "AfterIdle":
            logger.clearScreen();
            mutable.lastInfoMessage = undefined;
            Compile.printStatusLinesForElmJsonsErrors(logger, mutable.project);
            Compile.printSpaceForOutputs(logger, "hot", outputActions);
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
                webSocketPort: mutable.webSocketServer.port,
              },
              elmWatchJsonPath: mutable.project.elmWatchJsonPath,
              total: outputActions.total,
              action,
              postprocess: mutable.project.postprocess,
              postprocessWorkerPool: mutable.postprocessWorkerPool,
            })
              .then((handleOutputActionResult) => {
                dispatch({
                  tag: "CompilationPartDone",
                  date: getNow(),
                  prioritizedOutputs: makePrioritizedOutputs(
                    mutable.webSocketConnections
                  ),
                  handleOutputActionResult,
                });
              })
              .catch(rejectPromise);
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
          // istanbul ignore else
          if (mutable.elmWatchStuffJsonWriteError !== undefined) {
            logger.write("");
            logger.errorTemplate(
              Errors.elmWatchStuffJsonWriteError(
                mutable.project.elmWatchStuffJsonPath,
                mutable.elmWatchStuffJsonWriteError
              )
            );
            // istanbul ignore else
            if (exitOnError) {
              closeAll(mutable)
                .then(() => {
                  resolvePromise({ tag: "ExitOnIdle" });
                })
                .catch(rejectPromise);
            }
          }
        }
        return;

      case "InstallDependencies":
        // If the web socket server fails to boot, don’t even bother with anything else.
        mutable.webSocketServer.listening
          .then(() => Compile.installDependencies(env, logger, mutable.project))
          .then((installResult) => {
            dispatch({ tag: "InstallDependenciesDone", installResult });
          })
          .catch(rejectPromise);
        return;

      case "LimitWorkers":
        mutable.postprocessWorkerPool
          .limit()
          .then((numTerminatedWorkers) => {
            if (numTerminatedWorkers > 0) {
              dispatch({
                tag: "WorkersLimited",
                date: getNow(),
                numTerminatedWorkers,
              });
            }
          })
          .catch(rejectPromise);
        return;

      case "LogInfoMessageWithTimeline": {
        if (mutable.lastInfoMessage !== undefined) {
          logger.moveCursor(0, -mutable.lastInfoMessage.split("\n").length);
          logger.clearScreenDown();
        }
        const fullMessage = infoMessageWithTimeline({
          loggerConfig: logger.config,
          date: getNow(),
          mutable,
          message: cmd.message,
          events: filterLatestEvents(cmd.events),
          hasErrors: isNonEmptyArray(Compile.extractErrors(mutable.project)),
        });
        logger.write(fullMessage);
        // For the `run-pty` tool: Let it know that it’s safe to render the
        // keyboard shortcuts below the cursor text again.
        logger.clearScreenDown();
        mutable.lastInfoMessage = fullMessage;
        if (
          __ELM_WATCH_EXIT_ON_WORKER_LIMIT in env &&
          cmd.events.some(
            (event) => event.tag === "WorkersLimitedAfterWebSocketClosed"
          )
        ) {
          closeAll(mutable)
            .then(() => {
              resolvePromise({ tag: "ExitOnIdle" });
            })
            .catch(rejectPromise);
        }
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
            // istanbul ignore next
            default:
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
        ])
          .then(() => {
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
          })
          .catch(rejectPromise);
        return;
      }

      case "RestartWorkers":
        mutable.postprocessWorkerPool
          .terminate()
          .then(() => {
            mutable.postprocessWorkerPool.getOrCreateAvailableWorker();
          })
          .catch(rejectPromise);
        return;

      case "ExitOnIdle":
        closeAll(mutable)
          .then(() => {
            resolvePromise({ tag: "ExitOnIdle" });
          })
          .catch(rejectPromise);
        return;

      case "SleepBeforeNextAction":
        if (mutable.watcherTimeoutId !== undefined) {
          clearTimeout(mutable.watcherTimeoutId);
        }
        mutable.watcherTimeoutId = setTimeout(() => {
          mutable.watcherTimeoutId = undefined;
          dispatch({ tag: "SleepBeforeNextActionDone", date: getNow() });
        }, cmd.sleepMs);
        return;

      // istanbul ignore next
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
  resolvePromise: (result: HotRunResult) => void,
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

    case "WebSocketClosed": {
      const removedConnection = mutable.webSocketConnections.find(
        (connection) => connection.webSocket === msg.webSocket
      );
      mutable.webSocketConnections = mutable.webSocketConnections.filter(
        (connection) => connection.webSocket !== msg.webSocket
      );
      mutable.lastWebSocketCloseTimestamp = now.getTime();
      setTimeout(() => {
        dispatch({ tag: "WorkerLimitTimeoutPassed" });
      }, mutable.workerLimitTimeoutMs);
      dispatch({
        tag: "WebSocketClosed",
        date: now,
        outputPath:
          removedConnection === undefined
            ? /* istanbul ignore next */ { tag: "OutputPathError" }
            : removedConnection.outputPath,
      });
      return;
    }

    case "WebSocketMessageReceived": {
      const webSocketConnection = mutable.webSocketConnections.find(
        ({ webSocket }) => webSocket === msg.webSocket
      );

      // istanbul ignore if
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

      dispatch({
        tag: "WebSocketMessageReceived",
        date: now,
        output:
          output === undefined
            ? { tag: "OutputPathError" }
            : { tag: "Output", ...output },
        webSocket: msg.webSocket,
        data: msg.data,
      });
      return;
    }

    case "WebSocketServerError":
      switch (msg.error.tag) {
        case "PortConflict": {
          const { portChoice } = msg.error;
          closeAll(mutable)
            .then(() => {
              resolvePromise({
                tag: "ExitOnHandledFatalError",
                errorTemplate: portChoiceError(
                  mutable.project,
                  portChoice,
                  msg.error.error
                ),
              });
            })
            .catch(rejectPromise);
          return;
        }

        // istanbul ignore next
        case "OtherError":
          rejectPromise(msg.error.error);
          return;
      }
  }
}

function portChoiceError(
  project: Project,
  portChoice: PortChoice,
  error: Error
): Errors.ErrorTemplate {
  switch (portChoice.tag) {
    // istanbul ignore next
    case "NoPort":
      return Errors.portConflictForNoPort(error);

    case "PersistedPort":
      return Errors.portConflictForPersistedPort(
        project.elmWatchStuffJsonPath,
        portChoice.port
      );

    case "PortFromConfig":
      return Errors.portConflictForPortFromConfig(
        project.elmWatchJsonPath,
        portChoice.port
      );
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
          status: {
            tag: "CompileError",
            compilationMode: handleOutputActionResult.compilationMode,
          },
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

async function closeAll(mutable: Mutable): Promise<void> {
  // istanbul ignore if
  if (mutable.watcherTimeoutId !== undefined) {
    clearTimeout(mutable.watcherTimeoutId);
  }
  await Promise.all([
    mutable.watcher.close(),
    mutable.webSocketServer.close(),
    mutable.postprocessWorkerPool.terminate(),
  ]);
}

function makePrioritizedOutputs(
  webSocketConnections: Array<WebSocketConnection>
): HashMap<OutputPath, number> {
  const map = new HashMap<OutputPath, number>();
  for (const { outputPath, priority } of webSocketConnections) {
    if (outputPath.tag !== "OutputPathError") {
      // istanbul ignore next
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
  event: WatcherEvent,
  project: Project
): [NextAction, LatestEvent, Array<Cmd>] {
  return [
    { tag: "Restart" },
    { ...event, affectsAnyTarget: true },
    [
      {
        // Interrupt all compilation.
        tag: "MarkAsDirty",
        outputs: getFlatOutputs(project),
      },
    ],
  ];
}

function isElmFileRelatedToElmJsonsErrors(
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

      // Note: Restarting because an .elm file changed here won’t change the
      // fact that elm.json is missing. But it might feel clearer if the watcher
      // still reacts to the inputs rather than saying that they don’t affect
      // anything.
      case "ElmJsonNotFound":
        return (
          error.elmJsonNotFound.some((inputPath) =>
            equalsInputPath(elmFile, inputPath)
          ) ||
          error.foundElmJsonPaths.some(({ inputPath }) =>
            equalsInputPath(elmFile, inputPath)
          )
        );

      // The only way I’ve found to trigger this is by a symlink loop.
      // However, that causes the watcher to error out and we have to exit so
      // this is never hit.
      // istanbul ignore next
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

      // Changes to the .elm files don’t make the elm.json:s more unique, but
      // see  "ElmJsonNotFound" above for why we restart anyway.
      case "NonUniqueElmJsonPaths":
        return error.nonUniqueElmJsonPaths.some(({ inputPath }) =>
          equalsInputPath(elmFile, inputPath)
        );
    }
  });
}

function isElmJsonFileRelatedToElmJsonsErrors(
  absoluteElmJsonFilePath: string,
  elmJsonsErrors: Project["elmJsonsErrors"]
): boolean {
  return elmJsonsErrors.some(({ error }) => {
    switch (error.tag) {
      case "DuplicateInputs":
      case "InputsFailedToResolve":
      case "InputsNotFound":
        return false;
      case "ElmJsonNotFound":
        return error.foundElmJsonPaths.some(
          ({ elmJsonPath }) =>
            elmJsonPath.theElmJsonPath.absolutePath === absoluteElmJsonFilePath
        );
      case "NonUniqueElmJsonPaths":
        return error.nonUniqueElmJsonPaths.some(
          ({ elmJsonPath }) =>
            elmJsonPath.theElmJsonPath.absolutePath === absoluteElmJsonFilePath
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
    elmCompiledTimestamp: Decode.chain(Decode.string, (string) => {
      const number = Number(string);
      if (Number.isFinite(number)) {
        return number;
      }
      throw new Decode.DecoderError({
        message: "Expected a number",
        value: string,
      });
    }),
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

function webSocketConnectRequestUrlErrorToString(
  error: ParseWebSocketConnectRequestUrlError
): string {
  switch (error.tag) {
    case "BadUrl":
      return Errors.webSocketBadUrl(error.expectedStart, error.actualUrlString);

    case "ParamsDecodeError":
      return Errors.webSocketParamsDecodeError(
        error.error,
        error.actualUrlString
      );

    case "WrongVersion":
      return Errors.webSocketWrongVersion(
        error.expectedVersion,
        error.actualVersion
      );

    case "TargetNotFound":
      return Errors.webSocketTargetNotFound(
        error.targetName,
        error.enabledOutputs,
        error.disabledOutputs
      );

    case "TargetDisabled":
      return Errors.webSocketTargetDisabled(
        error.targetName,
        error.enabledOutputs,
        error.disabledOutputs
      );
  }
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
  // istanbul ignore next
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
): [Model, LatestEvent, Array<Cmd>] {
  const event: WebSocketRelatedEvent = {
    tag: "WebSocketConnectedNeedingCompilation",
    date,
    outputPath,
  };

  const recompileNeeded = (): [Model, LatestEvent, Array<Cmd>] => {
    const [newModel, cmds] = onWebSocketRecompileNeeded(
      model,
      outputPath,
      outputState
    );
    return [newModel, event, cmds];
  };

  switch (model.hotState.tag) {
    // istanbul ignore next
    case "Restarting":
    // istanbul ignore next
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
                {
                  tag: "WebSocketConnectedNeedingNoAction",
                  date,
                  outputPath,
                },
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

        // istanbul ignore next
        case "ElmMake":
        case "Postprocess":
        case "Interrupted":
        case "QueuedForElmMake":
        case "QueuedForPostprocess":
          switch (model.hotState.tag) {
            // istanbul ignore next
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
                tag: "WebSocketSendToOutput",
                outputPath,
                message: {
                  tag: "StatusChanged",
                  status: {
                    tag: "CompileError",
                    compilationMode: outputState.compilationMode,
                  },
                },
              },
            ],
          ];
        }
      }
  }
}

function onChangedCompilationMode(
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState
): [Model, Array<Cmd>] {
  switch (model.hotState.tag) {
    // istanbul ignore next
    case "Restarting":
    // istanbul ignore next
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
  outputState: OutputState
): [Model, Array<Cmd>] {
  switch (model.nextAction.tag) {
    // istanbul ignore next
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
          },
        ],
      ];
  }
}

function compileNextAction(nextAction: NextAction): NextAction {
  switch (nextAction.tag) {
    // istanbul ignore next
    case "Restart":
    case "Compile":
      return nextAction;
    case "NoAction":
      return { tag: "Compile" };
  }
}

function onWebSocketToServerMessage(
  project: Project,
  model: Model,
  date: Date,
  output: WebSocketMessageReceivedOutput,
  webSocket: WebSocket,
  message: WebSocketToServerMessage
): [Model, Array<Cmd>] {
  switch (message.tag) {
    case "ChangedCompilationMode": {
      switch (output.tag) {
        case "OutputPathError":
          return [model, []];

        case "Output": {
          const [newModel, cmds] = onChangedCompilationMode(
            model,
            output.outputPath,
            output.outputState
          );

          return [
            {
              ...newModel,
              latestEvents: [
                ...newModel.latestEvents,
                {
                  tag: "WebSocketChangedCompilationMode",
                  date,
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
    }

    case "FocusedTab":
      return [model, [{ tag: "WebSocketUpdatePriority", webSocket }]];

    case "ExitRequested":
      // istanbul ignore if
      if (model.hotState.tag !== "Idle") {
        return [
          model,
          [
            {
              tag: "Throw",
              error: new Error(
                `Got ExitRequested. Expected hotState to be Idle but it is: ${model.hotState.tag}`
              ),
            },
          ],
        ];
      }

      switch (model.nextAction.tag) {
        // istanbul ignore next
        case "Restart":
        // istanbul ignore next
        case "Compile":
          return [
            model,
            [
              {
                tag: "Throw",
                error: new Error(
                  `Got ExitRequested. Expected nextAction to be NoAction or PrintEvents but it is: ${model.nextAction.tag}`
                ),
              },
            ],
          ];

        case "NoAction": {
          const [newModel, cmds] = runNextAction(date, project, model);
          return [newModel, [...cmds, { tag: "ExitOnIdle" }]];
        }
      }
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

function getNextActionSleepMs(events: Array<LatestEvent>): number {
  return Math.max(0, ...events.map(getLatestEventSleepMs));
}

function getLatestEventSleepMs(event: LatestEvent): number {
  switch (event.tag) {
    // Sleep for a little bit to avoid unnecessary recompilation when using
    // “save all” in an editor, or when running `git switch some-branch` or `git
    // restore .`. These operations results in many files being
    // added/changed/deleted, usually with 0-1 ms between each event.
    case "WatcherEvent":
      return 10;

    // Also sleep for a little bit when web sockets connect and disconnect.
    // That’s useful when there are burst connections because of multiple
    // scripts on the same page, or many tabs with elm-watch. This is slower
    // than file system events.
    case "WebSocketClosed":
    case "WebSocketConnectedNeedingCompilation":
    case "WebSocketConnectedNeedingNoAction":
    case "WebSocketConnectedWithErrors":
    case "WorkersLimitedAfterWebSocketClosed":
      return 100;

    // When switching compilation mode, sleep a short amount of time so that the
    // change feels more immediate.
    case "WebSocketChangedCompilationMode":
      return 10;
  }
}

function filterLatestEvents(events: Array<LatestEvent>): Array<LatestEvent> {
  // Changes to .elm files that don’t affect anything are only
  // interesting/non-confusing if they happen on their own.
  const filtered = events.filter(
    (event) => !(event.tag === "WatcherEvent" && !event.affectsAnyTarget)
  );
  return isNonEmptyArray(filtered) ? filtered : events;
}

function infoMessageWithTimeline({
  loggerConfig,
  date,
  mutable,
  message,
  events,
  hasErrors,
}: {
  loggerConfig: LoggerConfig;
  date: Date;
  mutable: Mutable;
  message: string;
  events: Array<LatestEvent>;
  hasErrors: boolean;
}): string {
  return join(
    [
      "", // Empty line separator.
      printStats(loggerConfig, mutable),
      "",
      printTimeline(loggerConfig, events),
      printMessageWithTimeAndEmoji({
        loggerConfig,
        emojiName: hasErrors ? "Error" : "Success",
        date,
        dateHighlight: bold,
        message,
      }),
    ].flatMap((part) => (part === undefined ? [] : part)),
    "\n"
  );
}

function printMessageWithTimeAndEmoji({
  loggerConfig,
  emojiName,
  date,
  dateHighlight: highlightTime,
  message,
}: {
  loggerConfig: LoggerConfig;
  emojiName: Compile.EmojiName;
  date: Date;
  dateHighlight: (string: string) => string;
  message: string;
}): string {
  const newDate = loggerConfig.mockedTimings
    ? new Date("2022-02-05T13:10:05Z")
    : date;
  return Compile.printStatusLine({
    maxWidth: Infinity,
    fancy: loggerConfig.fancy,
    isTTY: loggerConfig.isTTY,
    emojiName,
    string: `${highlightTime(formatTime(newDate))} ${message}`,
  });
}

function printStats(loggerConfig: LoggerConfig, mutable: Mutable): string {
  const numWorkers = mutable.postprocessWorkerPool.getSize();
  return join(
    [
      numWorkers > 0
        ? `${dim(`${ELM_WATCH_NODE} workers:`)} ${numWorkers}`
        : undefined,
      `${dim("web socket connections:")} ${
        mutable.webSocketConnections.length
      } ${dim(`(ws://0.0.0.0:${mutable.webSocketServer.port.thePort})`)}`,
    ].flatMap((part) =>
      part === undefined
        ? []
        : Compile.printStatusLine({
            maxWidth: Infinity,
            fancy: loggerConfig.fancy,
            isTTY: loggerConfig.isTTY,
            emojiName: "Stats",
            string: part,
          })
    ),
    "\n"
  );
}

export function printTimeline(
  loggerConfig: LoggerConfig,
  events: Array<LatestEvent>
): string | undefined {
  if (!isNonEmptyArray(events)) {
    return undefined;
  }

  const base = 2;

  if (events.length <= 2 * base + 1) {
    return dim(
      join(
        mapNonEmptyArray(events, (event) => printEvent(loggerConfig, event)),
        "\n"
      )
    );
  }

  const start = events.slice(0, base);
  const end = events.slice(-base);

  const numMoreEvents = events.length - 2 * base;

  return dim(
    join(
      [
        ...start.map((event) => printEvent(loggerConfig, event)),
        `${loggerConfig.fancy ? "   " : ""}(${numMoreEvents} more events)`,
        ...end.map((event) => printEvent(loggerConfig, event)),
      ],
      "\n"
    )
  );
}

function printEvent(loggerConfig: LoggerConfig, event: LatestEvent): string {
  return printMessageWithTimeAndEmoji({
    loggerConfig,
    emojiName: "Information",
    date: event.date,
    dateHighlight: (string) => string,
    message: printEventMessage(event),
  });
}

function printEventMessage(event: LatestEvent): string {
  switch (event.tag) {
    case "WatcherEvent":
      return `${capitalize(event.eventName)} ${event.file.absolutePath}`;

    case "WebSocketClosed":
      return `Web socket disconnected for: ${
        event.outputPath.tag === "OutputPath"
          ? event.outputPath.targetName
          : "(no matching target)"
      }`;

    case "WebSocketConnectedNeedingCompilation":
      return `Web socket connected needing compilation of: ${event.outputPath.targetName}`;

    case "WebSocketConnectedNeedingNoAction":
      return `Web socket connected for: ${event.outputPath.targetName}`;

    case "WebSocketConnectedWithErrors":
      return `Web socket connected with errors (see the browser for details)`;

    case "WebSocketChangedCompilationMode":
      return `Changed compilation mode to ${JSON.stringify(
        event.compilationMode
      )} of: ${event.outputPath.targetName}`;

    case "WorkersLimitedAfterWebSocketClosed":
      return `Terminated ${event.numTerminatedWorkers} superfluous ${
        event.numTerminatedWorkers === 1
          ? "worker"
          : /* istanbul ignore next */ "workers"
      }`;
  }
}

function compileFinishedMessage(
  loggerConfig: LoggerConfig,
  duration: number
): string {
  return `Compilation finished in ${bold(
    printDurationMs(
      loggerConfig.mockedTimings ? 123 : /* istanbul ignore next */ duration
    ).trim()
  )}.`;
}

function printEventsMessage(
  events: Array<LatestEvent>,
  disabledOutputs: HashSet<OutputPath>
): string {
  const what1 = events.length === 1 ? "file is" : "files are";
  const what2 =
    disabledOutputs.size > 0 ? "any of the enabled targets" : "any target";
  return events.every(
    (event) => event.tag === "WatcherEvent" && !event.affectsAnyTarget
  )
    ? `FYI: The above Elm ${what1} not imported by ${what2}. Nothing to do!`
    : "Everything up to date.";
}
