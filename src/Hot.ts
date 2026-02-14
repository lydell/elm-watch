import * as childProcess from "child_process";
import * as chokidar from "chokidar";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as Codec from "tiny-decoders";
import * as url from "url";
import { URLSearchParams } from "url";
import type WebSocket from "ws";

import {
  encodeWebSocketToClientMessage,
  WebSocketToClientMessage,
  WebSocketToServerMessage,
} from "../client/WebSocketMessages";
import * as Compile from "./Compile";
import { ElmWatchStuffJson, Target } from "./ElmWatchStuffJson";
import {
  __ELM_WATCH_EXIT_ON_ERROR,
  __ELM_WATCH_EXIT_ON_WORKER_LIMIT,
  __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS,
  __ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS,
  ELM_WATCH_OPEN_EDITOR,
  Env,
} from "./Env";
import * as Errors from "./Errors";
import { ErrorTemplate } from "./Errors";
import {
  bold,
  capitalize,
  dim,
  formatTime,
  printDurationMs,
  quote,
  silentlyReadIntEnvValue,
  toError,
} from "./Helpers";
import { getHost, Host } from "./Host";
import type { Logger, LoggerConfig } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { absoluteDirname } from "./PathHelpers";
import { PortChoice } from "./Port";
import { PostprocessWorkerPool } from "./Postprocess";
import { ELM_WATCH_NODE } from "./PostprocessShared";
import {
  ElmJsonErrorWithMetadata,
  getFlatOutputs,
  getPostprocessElmWatchNodeScriptPath,
  OutputError,
  OutputState,
  Project,
  projectHasFilePathThatCanBeOpenedInEditor,
} from "./Project";
import { runTeaProgram } from "./TeaProgram";
import * as Theme from "./Theme";
import {
  AbsolutePath,
  BrowserUiPosition,
  CompilationMode,
  CreateServer,
  ElmJsonPath,
  ElmWatchJsonPath,
  equalsInputPath,
  GetNow,
  markAsAbsolutePath,
  OutputPath,
  TargetName,
  WebSocketToken,
} from "./Types";
import {
  WebSocketConnectionRejectedReason,
  WebSocketServer,
  WebSocketServerMsg,
} from "./WebSocketServer";
import { WebSocketUrl } from "./WebSocketUrl";

type WatcherEventName = "added" | "changed" | "removed";

type WatcherEvent<File = TaggedAbsolutePath | StaticFilesDirPath> = {
  tag: "WatcherEvent";
  date: Date;
  eventName: WatcherEventName;
  file: File;
};

type TaggedAbsolutePath = {
  tag: "AbsolutePath";
  absolutePath: AbsolutePath;
};

type StaticFilesDirPath = {
  tag: "StaticFilesDirPath";
  urlPath: string;
};

type WebSocketRelatedEvent =
  | {
      tag: "WebSocketChangedBrowserUiPosition";
      date: Date;
      outputPath: OutputPath;
      browserUiPosition: BrowserUiPosition;
    }
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
      tag: "WebSocketConnectionRejected";
      date: Date;
      origin: string | undefined;
      reason: WebSocketConnectionRejectedReason;
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
  workerLimitTimeoutId: NodeJS.Timeout | undefined;
  project: Project;
  lastInfoMessage: string | undefined;
  watcherTimeoutId: NodeJS.Timeout | undefined;
  elmWatchStuffJsonWriteError: Error | undefined;
  killInstallDependencies: ((options: { force: boolean }) => void) | undefined;
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
      elmJsonPath: ElmJsonPath;
      outputPath: OutputPath;
      outputState: OutputState;
    };

type Msg =
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
      eventName: WatcherEventName;
      absolutePath: AbsolutePath;
    }
  | {
      tag: "InstallDependenciesDone";
      date: Date;
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
      tag: "WebSocketConnectionRejected";
      date: Date;
      origin: string | undefined;
      reason: WebSocketConnectionRejectedReason;
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
      tag: "ChangeBrowserUiPosition";
      outputState: OutputState;
      browserUiPosition: BrowserUiPosition;
    }
  | {
      tag: "ChangeCompilationMode";
      outputState: OutputState;
      compilationMode: CompilationMode;
    }
  | {
      tag: "ChangeOpenErrorOverlay";
      outputState: OutputState;
      openErrorOverlay: boolean;
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
      tag: "WebSocketSendAll";
      message: WebSocketToClientMessage;
    }
  | {
      tag: "WebSocketSendCompileErrorToOutput";
      outputPath: OutputPath;
      compilationMode: CompilationMode;
      browserUiPosition: BrowserUiPosition;
      openErrorOverlay: boolean;
      errors: Array<Errors.ErrorTemplate>;
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
      reason: "CtrlCPressedOrStdinEnd" | "Other";
    }
  | {
      tag: "Restart";
      restartReasons: Array<LatestEvent>;
      postprocessWorkerPool: PostprocessWorkerPool;
      webSocketState: WebSocketState | undefined;
      webSocketToken: WebSocketToken;
    };

export type WebSocketState = {
  webSocketServer: WebSocketServer;
  webSocketConnections: Array<WebSocketConnection>;
};

export type HotKillManager = {
  // You are supposed to pass `undefined` initially. While running, this is
  // mutated to the function. Once successfully run, it is set back to
  // `undefined` again.
  // This is only used in tests, to clean up between each test.
  kill: (() => Promise<void>) | undefined;
};

// This uses something inspired by The Elm Architecture, since it’s all about
// keeping state (model) and reacting to events (messages).
export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  createServer: CreateServer,
  restartReasons: Array<LatestEvent>,
  postprocessWorkerPool: PostprocessWorkerPool,
  webSocketState: WebSocketState | undefined,
  webSocketToken: WebSocketToken,
  project: Project,
  portChoice: PortChoice,
  hotKillManager: HotKillManager,
): Promise<HotRunResult> {
  const exitOnError = __ELM_WATCH_EXIT_ON_ERROR in env;

  const result = await runTeaProgram<Mutable, Msg, Model, Cmd, HotRunResult>({
    initMutable: initMutable(
      env,
      logger,
      getNow,
      createServer,
      postprocessWorkerPool,
      webSocketState,
      webSocketToken,
      project,
      portChoice,
      hotKillManager,
    ),
    init: init(getNow(), restartReasons, project.elmJsonsErrors),
    update: (msg: Msg, model: Model): [Model, Array<Cmd>] => {
      const [newModel, cmds] = update(
        logger.config,
        project,
        exitOnError,
        msg,
        model,
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
    runCmd: runCmd(env, logger, getNow, exitOnError, webSocketToken),
  });

  hotKillManager.kill = undefined;

  return result;
}

export async function watchElmWatchJsonOnce(
  getNow: GetNow,
  elmWatchJsonPath: ElmWatchJsonPath,
): Promise<WatcherEvent> {
  return new Promise((resolve, reject) => {
    const watcher = chokidar.watch(elmWatchJsonPath, {
      ignoreInitial: true,
      disableGlobbing: true,
    });

    watcherOnAll(watcher, reject, (eventName, absolutePathString) => {
      const event: WatcherEvent = {
        tag: "WatcherEvent",
        date: getNow(),
        eventName,
        file: {
          tag: "AbsolutePath",
          absolutePath: markAsAbsolutePath(absolutePathString),
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
    logger: Logger,
    getNow: GetNow,
    createServer: CreateServer,
    postprocessWorkerPool: PostprocessWorkerPool,
    webSocketState: WebSocketState | undefined,
    webSocketToken: WebSocketToken,
    project: Project,
    portChoice: PortChoice,
    hotKillManager: HotKillManager,
  ) =>
  (
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: HotRunResult) => void,
    rejectPromise: (error: Error) => void,
  ): Mutable => {
    // The more targets that are enabled by connecting WebSockets, the more
    // workers we might have. Terminate unnecessary idle workers as WebSockets
    // close. But wait a while first: We don’t want to terminate workers just
    // because the user refreshed the page (which results in a disconnect +
    // connect).
    const workerLimitTimeoutMs = silentlyReadIntEnvValue(
      env[__ELM_WATCH_WORKER_LIMIT_TIMEOUT_MS],
      10000,
    );

    const watcher = chokidar.watch(Array.from(project.watchRoots), {
      ignoreInitial: true,
      // Note: Forward slashes must be used here even on Windows. (Using
      // backslashes on Windows never matches.) The trailing slash is important:
      // It makes it possible to get notifications of a removed elm-stuff
      // folder, while ignoring everything that happens _inside_ that folder.
      // For `.stack-work/`, see https://docs.haskellstack.org/en/stable/topics/stack_work/ and
      // https://github.com/lydell/elm-watch/issues/106.
      ignored: /\/(elm-stuff|node_modules|\.stack-work)\//,
      disableGlobbing: true,
    });

    watcherOnAll(
      watcher,
      (error) => {
        closeAll(logger, mutable)
          .then(() => {
            resolvePromise({
              tag: "ExitOnHandledFatalError",
              errorTemplate: Errors.watcherError(error),
            });
          })
          .catch(rejectPromise);
      },
      (eventName: WatcherEventName, absolutePath: AbsolutePath): void => {
        dispatch({
          tag: "GotWatcherEvent",
          date: getNow(),
          eventName,
          absolutePath,
        });
      },
    );

    const {
      webSocketServer = new WebSocketServer(
        createServer,
        portChoice,
        getHost(env),
        project.staticFilesDir,
        webSocketToken,
      ),
      webSocketConnections = [],
    } = webSocketState ?? {};

    const mutable: Mutable = {
      watcher,
      postprocessWorkerPool,
      webSocketServer,
      webSocketConnections,
      lastWebSocketCloseTimestamp: undefined,
      workerLimitTimeoutMs,
      workerLimitTimeoutId: undefined,
      project,
      lastInfoMessage: undefined,
      watcherTimeoutId: undefined,
      elmWatchStuffJsonWriteError: undefined,
      killInstallDependencies: undefined,
    };

    webSocketServer.setDispatch((msg) => {
      onWebSocketServerMsg(
        getNow(),
        logger,
        mutable,
        dispatch,
        resolvePromise,
        rejectPromise,
        msg,
      );
    });

    postprocessWorkerPool.setCalculateMax(() =>
      mutable.lastWebSocketCloseTimestamp !== undefined &&
      getNow().getTime() >=
        mutable.lastWebSocketCloseTimestamp + workerLimitTimeoutMs
        ? // Save one worker, so we always have one “warmed up” worker ready to go
          // when needed.
          Math.max(1, makePrioritizedOutputs(mutable.webSocketConnections).size)
        : Infinity,
    );

    // The port isn’t finalized until a few moments later (when the persisted
    // port is not available).
    webSocketServer.listening
      .then(() => {
        writeElmWatchStuffJson(mutable, webSocketToken);
        // When not running as a TTY the output is a simple log, and it gets
        // a bit tedious if the stats are printed after each event. Instead,
        // we print it once at startup, and only the server links (connections
        // and workers are always 0 at that time).
        // This has to be done once the server is ready – we don’t know the
        // final port number to print until then.
        const isRestart = webSocketState !== undefined;
        if (!logger.config.isTTY && !isRestart) {
          logger.write(
            printStats(logger.config, [
              printServerLinks(mutable.webSocketServer, getHost(env)),
            ]),
          );
        }
      })
      .catch(rejectPromise);

    const kill = async (): Promise<void> => {
      /* v8 ignore start */
      try {
        if (mutable.killInstallDependencies !== undefined) {
          mutable.killInstallDependencies({ force: true });
        }
        await Promise.all(
          getFlatOutputs(project).map(({ outputState }) =>
            "kill" in outputState.status
              ? outputState.status.kill({ force: true })
              : Promise.resolve(),
          ),
        );
        await closeAll(logger, mutable);
      } catch (unknownError) {
        const error = toError(unknownError);
        rejectPromise(toError(error));
      }
      /* v8 ignore stop */

      hotKillManager.kill = undefined;
    };

    hotKillManager.kill = async () => {
      dispatch({ tag: "ExitRequested", date: getNow() });
      await kill();
      resolvePromise({ tag: "ExitOnIdle", reason: "Other" });
    };

    logger.setRawMode(() => {
      kill()
        .then(() => {
          resolvePromise({
            tag: "ExitOnIdle",
            reason: "CtrlCPressedOrStdinEnd",
          });
        })
        .catch(rejectPromise);
    });

    return mutable;
  };

function writeElmWatchStuffJson(
  mutable: Mutable,
  webSocketToken: WebSocketToken,
): void {
  const targets: Record<string, Required<Target>> = Object.fromEntries([
    ...mutable.project.elmJsonsErrors.map(
      (error) =>
        [
          error.outputPath.targetName,
          {
            compilationMode: error.compilationMode,
            browserUiPosition: error.browserUiPosition,
            openErrorOverlay: error.openErrorOverlay,
          },
        ] as const,
    ),
    ...getFlatOutputs(mutable.project).map(
      ({ outputPath, outputState }) =>
        [
          outputPath.targetName,
          {
            compilationMode: outputState.compilationMode,
            browserUiPosition: outputState.browserUiPosition,
            openErrorOverlay: outputState.openErrorOverlay,
          },
        ] as const,
    ),
  ]);

  const json: ElmWatchStuffJson = {
    port: mutable.webSocketServer.port,
    webSocketToken,
    targets,
  };

  try {
    fs.mkdirSync(absoluteDirname(mutable.project.elmWatchStuffJsonPath), {
      recursive: true,
    });

    fs.writeFileSync(
      mutable.project.elmWatchStuffJsonPath,
      `${Codec.JSON.stringify(ElmWatchStuffJson, json, 4)}\n`,
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
  onSuccess: (eventName: WatcherEventName, absolutePath: AbsolutePath) => void,
): void {
  // We generally only care about files – not directories – but adding and
  // removing directories can cause/fix errors, if they are named
  // `elm-watch.json`, `elm.json` or `*.elm`.
  watcher.on("all", (chokidarEventName, absolutePathString) => {
    const absolutePath = markAsAbsolutePath(absolutePathString);
    switch (chokidarEventName) {
      case "add":
      case "addDir":
        onSuccess("added", absolutePath);
        return;

      case "unlink":
      case "unlinkDir":
        onSuccess("removed", absolutePath);
        return;

      case "change":
        onSuccess("changed", absolutePath);
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
  elmJsonsErrors: Array<ElmJsonErrorWithMetadata>,
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
      (elmJsonError): Cmd => ({
        tag: "WebSocketSendToOutput",
        outputPath: elmJsonError.outputPath,
        message: {
          tag: "StatusChanged",
          status: {
            tag: "ElmJsonError",
            error: Errors.toPlainString(
              Compile.renderElmJsonError(elmJsonError),
            ),
          },
        },
      }),
    ),
  ],
];

function update(
  loggerConfig: LoggerConfig,
  project: Project,
  exitOnError: boolean,
  msg: Msg,
  model: Model,
): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "GotWatcherEvent": {
      const result = onWatcherEvent(
        msg.date,
        project,
        msg.eventName,
        msg.absolutePath,
        model.nextAction,
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

    case "ExitRequested":
      /* v8 ignore start */
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
      /* v8 ignore stop */

      switch (model.nextAction.tag) {
        /* v8 ignore start */
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
        /* v8 ignore end */

        case "NoAction":
          return runNextAction(msg.date, project, model);
      }

    case "SleepBeforeNextActionDone": {
      const staticFilesDirPaths = model.latestEvents.flatMap((event) =>
        event.tag === "WatcherEvent" && event.file.tag === "StaticFilesDirPath"
          ? [event.file.urlPath]
          : [],
      );
      const [newModel, cmds] = runNextAction(msg.date, project, model);
      return [
        {
          ...newModel,
          nextAction: { tag: "NoAction" },
        },
        [
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
        /* v8 ignore start */
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
        /* v8 ignore stop */

        case "Compiling": {
          const duration = msg.date.getTime() - model.hotState.start.getTime();

          const cmd = handleOutputActionResultToCmd(
            project.elmWatchJsonPath,
            msg.handleOutputActionResult,
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
          /* v8 ignore start */
          return outputActions.numExecuting === 0
            ? [model, [{ tag: "Restart", restartReasons: model.latestEvents }]]
            : [model, []];
        /* v8 ignore stop */
      }
    }

    case "InstallDependenciesDone":
      switch (model.hotState.tag) {
        case "Dependencies": {
          switch (msg.installResult.tag) {
            case "Error":
              return [
                { ...model, hotState: { tag: "Idle" } },
                /* v8 ignore next */
                [exitOnError ? { tag: "ExitOnIdle" } : { tag: "NoCmd" }],
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

        /* v8 ignore start */
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
        /* v8 ignore stop */
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
            msg.date,
            model,
            project.elmWatchJsonPath,
            result.elmJsonPath,
            result.outputPath,
            result.outputState,
            result.elmCompiledTimestamp,
          );
          return [
            {
              ...newModel,
              latestEvents: [...newModel.latestEvents, latestEvent],
            },
            [...cmds, ...cssCmd],
          ];
        }

        case "ElmJsonError": {
          const elmJsonError = result.error;
          const event: WebSocketRelatedEvent = {
            tag: "WebSocketConnectedNeedingNoAction",
            date: msg.date,
            outputPath: elmJsonError.outputPath,
          };

          return [
            {
              ...model,
              latestEvents: [...model.latestEvents, event],
            },
            [
              {
                tag: "WebSocketSendToOutput",
                outputPath: elmJsonError.outputPath,
                message: {
                  tag: "StatusChanged",
                  status: {
                    tag: "ElmJsonError",
                    error: Errors.toPlainString(
                      Compile.renderElmJsonError(elmJsonError),
                    ),
                  },
                },
              },
              ...cssCmd,
            ],
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
                    message: webSocketConnectRequestUrlErrorToString(
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
              date: msg.date,
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
            project.elmWatchJsonPath,
            model,
            msg.date,
            msg.output,
            msg.webSocket,
            result.message,
          );

        case "DecoderError":
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
  absolutePath: AbsolutePath,
  nextAction: NextAction,
): [NextAction, LatestEvent, Array<Cmd>] | undefined {
  if (absolutePath.endsWith(".elm")) {
    return onElmFileWatcherEvent(
      project,
      makeWatcherEvent(eventName, absolutePath, now),
      nextAction,
    );
  }

  const basename = path.basename(absolutePath);

  switch (basename) {
    case "elm-watch.json":
      switch (eventName) {
        case "added":
          return makeRestartNextAction(
            makeWatcherEvent(eventName, absolutePath, now),
            project,
          );

        case "changed":
        case "removed":
          if (absolutePath === project.elmWatchJsonPath) {
            return makeRestartNextAction(
              makeWatcherEvent(eventName, absolutePath, now),
              project,
            );
          }
          return undefined;
      }

    case "elm.json":
      switch (eventName) {
        case "added":
          return makeRestartNextAction(
            makeWatcherEvent(eventName, absolutePath, now),
            project,
          );

        case "changed":
        case "removed":
          if (
            Array.from(project.elmJsons).some(
              ([elmJsonPath]) => absolutePath === elmJsonPath,
            ) ||
            isElmJsonFileRelatedToElmJsonsErrors(
              absolutePath,
              project.elmJsonsErrors,
            )
          ) {
            return makeRestartNextAction(
              makeWatcherEvent(eventName, absolutePath, now),
              project,
            );
          }
          return undefined;
      }

    // Some compiler error messages suggest removing elm-stuff to fix the error.
    // Restart when that happens. Note: This could be a totally unrelated
    // elm-stuff directory, but I don’t think it’s worth the trouble trying to
    // check if it affects the project, and possibly logging if it isn’t.
    case "elm-stuff":
      switch (eventName) {
        case "removed":
          return makeRestartNextAction(
            makeWatcherEvent(eventName, absolutePath, now),
            project,
          );

        default:
          return undefined;
      }

    default:
      if (absolutePath === getPostprocessElmWatchNodeScriptPath(project)) {
        return [
          compileNextAction(nextAction),
          {
            ...makeWatcherEvent(eventName, absolutePath, now),
            affectsAnyTarget: true,
          },
          [
            {
              tag: "MarkAsDirty",
              outputs: getFlatOutputs(project),
              killInstallDependencies: false,
            },
            { tag: "RestartWorkers" },
          ],
        ];
      }

      if (project.staticFilesDir !== undefined) {
        const prefix = project.staticFilesDir + path.sep;
        if (
          absolutePath.startsWith(prefix) &&
          !getFlatOutputs(project).some(
            ({ outputPath }) => absolutePath === outputPath.theOutputPath,
          )
        ) {
          return [
            nextAction,
            {
              ...makeWatcherEvent(eventName, absolutePath, now),
              affectsAnyTarget: true,
              file: {
                tag: "StaticFilesDirPath",
                urlPath: url.pathToFileURL(
                  path.sep + absolutePath.slice(prefix.length),
                ).pathname,
              },
            },
            [],
          ];
        }
      }

      // Ignore other types of files.
      return undefined;
  }
}

function onElmFileWatcherEvent(
  project: Project,
  event: WatcherEvent<TaggedAbsolutePath>,
  nextAction: NextAction,
): [NextAction, LatestEvent, Array<Cmd>] | undefined {
  const elmFile = event.file;

  if (
    isElmFileRelatedToElmJsonsErrors(
      elmFile.absolutePath,
      project.elmJsonsErrors,
    )
  ) {
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
          if (equalsInputPath(elmFile.absolutePath, inputPath)) {
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
        [
          {
            tag: "MarkAsDirty",
            outputs: dirtyOutputs,
            killInstallDependencies: false,
          },
        ],
      ]
    : [nextAction, { ...event, affectsAnyTarget: false }, []];
}

function runNextAction(
  start: Date,
  project: Project,
  model: Model,
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

        /* v8 ignore start */
        case "Restarting":
          return [model, []];
        /* v8 ignore stop */
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

        /* v8 ignore start */
        case "Dependencies":
        case "Restarting":
          return [model, []];
        /* v8 ignore stop */
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
                      project.disabledOutputs,
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
  (
    env: Env,
    logger: Logger,
    getNow: GetNow,
    exitOnError: boolean,
    webSocketToken: WebSocketToken,
  ) =>
  (
    cmd: Cmd,
    mutable: Mutable,
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: HotRunResult) => void,
    rejectPromise: (error: Error) => void,
  ): void => {
    switch (cmd.tag) {
      case "ChangeBrowserUiPosition":
        cmd.outputState.browserUiPosition = cmd.browserUiPosition;
        writeElmWatchStuffJson(mutable, webSocketToken);
        return;

      case "ChangeCompilationMode":
        cmd.outputState.compilationMode = cmd.compilationMode;
        writeElmWatchStuffJson(mutable, webSocketToken);
        return;

      case "ChangeOpenErrorOverlay":
        cmd.outputState.openErrorOverlay = cmd.openErrorOverlay;
        writeElmWatchStuffJson(mutable, webSocketToken);
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
            mutable.webSocketConnections,
          ),
        });

        switch (cmd.mode) {
          case "AfterInstallDependencies":
            logger.withSynchronizedOutput(() => {
              Compile.printStatusLinesForElmJsonsErrors(
                logger,
                mutable.project,
              );
              Compile.printSpaceForOutputs(logger, "hot", outputActions);
            });
            break;

          case "AfterIdle":
            logger.withSynchronizedOutput(() => {
              logger.clearScreen();
              mutable.lastInfoMessage = undefined;
              Compile.printStatusLinesForElmJsonsErrors(
                logger,
                mutable.project,
              );
              Compile.printSpaceForOutputs(logger, "hot", outputActions);
            });
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
                webSocketConnection: mutable.project.webSocketUrl ?? {
                  tag: "AutomaticUrl",
                  port: mutable.webSocketServer.port,
                },
                webSocketToken,
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
                    mutable.webSocketConnections,
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
              mutable.webSocketConnections,
            ),
            handleOutputActionResult: { tag: "Nothing" },
          });
        }
        return;
      }

      case "HandleElmWatchStuffJsonWriteError":
        if (mutable.elmWatchStuffJsonWriteError !== undefined) {
          // Retry writing it.
          writeElmWatchStuffJson(mutable, webSocketToken);
          // If still an error, print it.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (mutable.elmWatchStuffJsonWriteError !== undefined) {
            logger.write("");
            logger.errorTemplate(
              Errors.elmWatchStuffJsonWriteError(
                mutable.project.elmWatchStuffJsonPath,
                mutable.elmWatchStuffJsonWriteError,
              ),
            );
            if (exitOnError) {
              closeAll(logger, mutable)
                .then(() => {
                  resolvePromise({ tag: "ExitOnIdle", reason: "Other" });
                })
                .catch(rejectPromise);
            }
          }
        }
        return;

      case "InstallDependencies": {
        // If the web socket server fails to boot, don’t even bother with anything else.
        mutable.webSocketServer.listening
          .then(() => {
            const { promise, kill } = Compile.installDependencies(
              env,
              logger,
              getNow,
              mutable.project,
            );
            mutable.killInstallDependencies = ({ force }) => {
              kill({ force });
              mutable.killInstallDependencies = undefined;
            };
            return promise;
          })
          .finally(() => {
            mutable.killInstallDependencies = undefined;
          })
          .then((installResult) => {
            dispatch({
              tag: "InstallDependenciesDone",
              date: getNow(),
              installResult,
            });
          })
          .catch(rejectPromise);
        return;
      }

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
        const fullMessage = infoMessageWithTimeline({
          loggerConfig: logger.config,
          date: getNow(),
          mutable,
          host: getHost(env),
          message: cmd.message,
          events: filterLatestEvents(cmd.events),
          hasErrors: isNonEmptyArray(Compile.extractErrors(mutable.project)),
        });
        logger.withSynchronizedOutput(() => {
          if (mutable.lastInfoMessage !== undefined) {
            logger.moveCursor(0, -mutable.lastInfoMessage.split("\n").length);
            logger.clearScreenDown();
          }
          logger.write(fullMessage);
          // For the `run-pty` tool: Let it know that it’s safe to render the
          // keyboard shortcuts below the cursor text again.
          logger.clearScreenDown();
        });
        mutable.lastInfoMessage = fullMessage;
        if (
          __ELM_WATCH_EXIT_ON_WORKER_LIMIT in env &&
          cmd.events.some(
            (event) => event.tag === "WorkersLimitedAfterWebSocketClosed",
          )
        ) {
          closeAll(logger, mutable)
            .then(() => {
              resolvePromise({ tag: "ExitOnIdle", reason: "Other" });
            })
            .catch(rejectPromise);
        }
        return;
      }

      case "MarkAsDirty":
        if (
          cmd.killInstallDependencies &&
          mutable.killInstallDependencies !== undefined
        ) {
          mutable.killInstallDependencies({ force: false });
        }
        for (const { outputPath, outputState } of cmd.outputs) {
          outputState.dirty = true;
          if ("kill" in outputState.status) {
            Promise.resolve(outputState.status.kill({ force: false })).catch(
              rejectPromise,
            );
          }
          webSocketSendToOutput(
            outputPath,
            {
              tag: "StatusChanged",
              status: {
                tag: "Busy",
                compilationMode: outputState.compilationMode,
                browserUiPosition: outputState.browserUiPosition,
              },
            },
            mutable.webSocketConnections,
          );
        }
        return;

      case "NoCmd":
        return;

      case "OpenEditor": {
        const command = env[ELM_WATCH_OPEN_EDITOR];
        if (command === undefined) {
          webSocketSend(cmd.webSocket, {
            tag: "OpenEditorFailed",
            error: { tag: "EnvNotSet" },
          });
        } else if (
          !projectHasFilePathThatCanBeOpenedInEditor(mutable.project, cmd.file)
        ) {
          webSocketSend(cmd.webSocket, {
            tag: "OpenEditorFailed",
            error: {
              tag: "InvalidFilePath",
              message: Errors.openEditorInvalidFilePath(cmd.file),
            },
          });
        } else {
          const cwd = absoluteDirname(mutable.project.elmWatchJsonPath);
          const timeout = silentlyReadIntEnvValue(
            env[__ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS],
            5000,
          );
          const extraEnv = {
            file: cmd.file,
            line: cmd.line.toString(),
            column: cmd.column.toString(),
          };
          childProcess.exec(
            command,
            {
              cwd,
              env: { ...env, ...extraEnv },
              encoding: "utf8",
              timeout,
            },
            (error, stdout, stderr) => {
              if (error !== null) {
                webSocketSend(cmd.webSocket, {
                  tag: "OpenEditorFailed",
                  error: {
                    tag: "CommandFailed",
                    message: Errors.openEditorCommandFailed({
                      error,
                      command,
                      cwd,
                      timeout,
                      env: extraEnv,
                      stdout,
                      stderr,
                    }),
                  },
                });
              }
            },
          );
        }
        return;
      }

      case "PrintCompileErrors":
        logger.withSynchronizedOutput(() => {
          Compile.printErrors(logger, cmd.errors);
        });
        return;

      case "Restart": {
        // Outputs and port may have changed if elm-watch.json changes.
        const elmWatchJsonChanged = cmd.restartReasons.some((event) => {
          switch (event.tag) {
            case "WatcherEvent":
              return (
                event.file.tag === "AbsolutePath" &&
                path.basename(event.file.absolutePath) === "elm-watch.json"
              );
            /* v8 ignore start */
            default:
              return false;
            /* v8 ignore stop */
          }
        });
        closeAll(logger, mutable, {
          killWebSocketServer: elmWatchJsonChanged,
          killPostprocessWorkerPool: elmWatchJsonChanged,
        })
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
              webSocketToken,
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
        closeAll(logger, mutable)
          .then(() => {
            resolvePromise({ tag: "ExitOnIdle", reason: "Other" });
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

      /* v8 ignore start */
      case "Throw":
        rejectPromise(cmd.error);
        return;
      /* v8 ignore stop */

      case "WebSocketSend":
        webSocketSend(cmd.webSocket, cmd.message);
        return;

      case "WebSocketSendAll":
        for (const webSocketConnection of mutable.webSocketConnections) {
          webSocketSend(webSocketConnection.webSocket, cmd.message);
        }
        return;

      case "WebSocketSendCompileErrorToOutput":
        Theme.getThemeFromTerminal(logger)
          .then((theme) => {
            const message: WebSocketToClientMessage = {
              tag: "StatusChanged",
              status: {
                tag: "CompileError",
                compilationMode: cmd.compilationMode,
                browserUiPosition: cmd.browserUiPosition,
                openErrorOverlay: cmd.openErrorOverlay,
                errors: cmd.errors.map((errorTemplate) =>
                  Errors.toHtml(errorTemplate, theme, logger.config.noColor),
                ),
                foregroundColor: theme.foreground,
                backgroundColor: theme.background,
              },
            };
            webSocketSendToOutput(
              cmd.outputPath,
              message,
              mutable.webSocketConnections,
            );
          })
          .catch(rejectPromise);
        return;

      case "WebSocketSendToOutput":
        webSocketSendToOutput(
          cmd.outputPath,
          cmd.message,
          mutable.webSocketConnections,
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
  logger: Logger,
  mutable: Mutable,
  dispatch: (msg: Msg) => void,
  resolvePromise: (result: HotRunResult) => void,
  rejectPromise: (error: Error) => void,
  msg: WebSocketServerMsg,
): void {
  switch (msg.tag) {
    case "WebSocketConnected": {
      const result = parseWebSocketConnectRequestUrl(
        mutable.project,
        msg.urlParams,
      );
      const webSocketConnection: WebSocketConnection = {
        webSocket: msg.webSocket,
        outputPath: webSocketConnectRequestUrlResultToOutputPath(result),
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

    case "WebSocketConnectionRejected":
      dispatch({
        tag: "WebSocketConnectionRejected",
        date: now,
        origin: msg.origin,
        reason: msg.reason,
      });
      return;

    case "WebSocketClosed": {
      const removedConnection = mutable.webSocketConnections.find(
        (connection) => connection.webSocket === msg.webSocket,
      );
      mutable.webSocketConnections = mutable.webSocketConnections.filter(
        (connection) => connection.webSocket !== msg.webSocket,
      );
      mutable.lastWebSocketCloseTimestamp = now.getTime();
      if (mutable.workerLimitTimeoutId !== undefined) {
        clearTimeout(mutable.workerLimitTimeoutId);
      }
      mutable.workerLimitTimeoutId = setTimeout(() => {
        mutable.workerLimitTimeoutId = undefined;
        dispatch({ tag: "WorkerLimitTimeoutPassed" });
      }, mutable.workerLimitTimeoutMs);
      dispatch({
        tag: "WebSocketClosed",
        date: now,
        outputPath:
          /* v8 ignore start */
          removedConnection === undefined
            ? { tag: "OutputPathError" }
            : removedConnection.outputPath,
        /* v8 ignore stop */
      });
      return;
    }

    case "WebSocketMessageReceived": {
      const webSocketConnection = mutable.webSocketConnections.find(
        ({ webSocket }) => webSocket === msg.webSocket,
      );

      /* v8 ignore start */
      if (webSocketConnection === undefined) {
        rejectPromise(
          new Error(
            `No web socket connection found for web socket message ${quote(
              msg.tag,
            )}`,
          ),
        );
        return;
      }
      /* v8 ignore stop */

      const flatOutputs = getFlatOutputs(mutable.project);
      const output = flatOutputs.find(({ outputPath }) =>
        webSocketConnectionIsForOutputPath(webSocketConnection, outputPath),
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
          closeAll(logger, mutable)
            .then(() => {
              resolvePromise({
                tag: "ExitOnHandledFatalError",
                errorTemplate: portChoiceError(
                  mutable.project,
                  portChoice,
                  msg.error.error,
                ),
              });
            })
            .catch(rejectPromise);
          return;
        }

        case "HostNotFound": {
          const { host } = msg.error;
          closeAll(logger, mutable)
            .then(() => {
              resolvePromise({
                tag: "ExitOnHandledFatalError",
                errorTemplate: Errors.hostNotFound(host, msg.error.error),
              });
            })
            .catch(rejectPromise);
          return;
        }

        /* v8 ignore start */
        case "OtherError":
          rejectPromise(msg.error.error);
          return;
        /* v8 ignore stop */
      }
  }
}

function portChoiceError(
  project: Project,
  portChoice: PortChoice,
  error: Error,
): Errors.ErrorTemplate {
  switch (portChoice.tag) {
    /* v8 ignore start */
    case "NoPort":
      return Errors.portConflictForNoPort(error);
    /* v8 ignore stop */

    case "PersistedPort":
      return Errors.portConflictForPersistedPort(
        project.elmWatchStuffJsonPath,
        portChoice.port,
      );

    case "PortFromConfig":
      return Errors.portConflictForPortFromConfig(
        project.elmWatchJsonPath,
        portChoice.port,
      );
  }
}

function handleOutputActionResultToCmd(
  elmWatchJsonPath: ElmWatchJsonPath,
  handleOutputActionResult: Compile.HandleOutputActionResult,
): Cmd {
  switch (handleOutputActionResult.tag) {
    case "CompileError":
      return {
        tag: "WebSocketSendCompileErrorToOutput",
        outputPath: handleOutputActionResult.outputPath,
        compilationMode: handleOutputActionResult.outputState.compilationMode,
        browserUiPosition:
          handleOutputActionResult.outputState.browserUiPosition,
        openErrorOverlay: handleOutputActionResult.outputState.openErrorOverlay,
        errors: Compile.renderOutputErrors(
          elmWatchJsonPath,
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
          browserUiPosition:
            handleOutputActionResult.outputState.browserUiPosition,
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

async function closeAll(
  logger: Logger,
  mutable: Mutable,
  { killWebSocketServer = true, killPostprocessWorkerPool = true } = {},
): Promise<void> {
  logger.reset();

  /* v8 ignore start */
  if (mutable.workerLimitTimeoutId !== undefined) {
    clearTimeout(mutable.workerLimitTimeoutId);
  }
  /* v8 ignore stop */

  /* v8 ignore start */
  if (mutable.watcherTimeoutId !== undefined) {
    clearTimeout(mutable.watcherTimeoutId);
  }
  /* v8 ignore stop */

  mutable.webSocketServer.unsetDispatch();
  await Promise.all([
    mutable.watcher.close(),
    killWebSocketServer ? mutable.webSocketServer.close() : undefined,
    killPostprocessWorkerPool
      ? mutable.postprocessWorkerPool.terminate()
      : undefined,
  ]);
}

function makePrioritizedOutputs(
  webSocketConnections: Array<WebSocketConnection>,
): Map<TargetName, number> {
  const map = new Map<TargetName, number>();
  for (const { outputPath, priority } of webSocketConnections) {
    if (outputPath.tag !== "OutputPathError") {
      /* v8 ignore next */
      const previous = map.get(outputPath.targetName) ?? 0;
      map.set(outputPath.targetName, Math.max(priority, previous));
    }
  }
  return map;
}

function makeWatcherEvent(
  eventName: WatcherEventName,
  absolutePath: AbsolutePath,
  date: Date,
): WatcherEvent<TaggedAbsolutePath> {
  return {
    tag: "WatcherEvent",
    date,
    eventName,
    file: { tag: "AbsolutePath", absolutePath },
  };
}

function makeRestartNextAction(
  event: WatcherEvent,
  project: Project,
): [NextAction, LatestEvent, Array<Cmd>] {
  return [
    { tag: "Restart" },
    { ...event, affectsAnyTarget: true },
    [
      {
        // Interrupt all compilation.
        tag: "MarkAsDirty",
        outputs: getFlatOutputs(project),
        killInstallDependencies: true,
      },
    ],
  ];
}

function isElmFileRelatedToElmJsonsErrors(
  elmFile: AbsolutePath,
  elmJsonsErrors: Project["elmJsonsErrors"],
): boolean {
  return elmJsonsErrors.some(({ error }) => {
    switch (error.tag) {
      case "DuplicateInputs":
        return error.duplicates.some(
          ({ inputs, resolved }) =>
            resolved === elmFile ||
            inputs.some((inputPath) => equalsInputPath(elmFile, inputPath)),
        );

      // Note: Restarting because an .elm file changed here won’t change the
      // fact that elm.json is missing. But it might feel clearer if the watcher
      // still reacts to the inputs rather than saying that they don’t affect
      // anything.
      case "ElmJsonNotFound":
        return (
          error.elmJsonNotFound.some((inputPath) =>
            equalsInputPath(elmFile, inputPath),
          ) ||
          error.foundElmJsonPaths.some(({ inputPath }) =>
            equalsInputPath(elmFile, inputPath),
          )
        );

      // The only way I’ve found to trigger this is by a symlink loop.
      // However, that causes the watcher to error out and we have to exit so
      // this is never hit.
      /* v8 ignore start */
      case "InputsFailedToResolve":
        return error.inputsFailedToResolve.some(
          ({ inputPath }) => inputPath.theUncheckedInputPath === elmFile,
        );
      /* v8 ignore stop */

      case "InputsNotFound":
        return error.inputsNotFound.some(
          (inputPath) => inputPath.theUncheckedInputPath === elmFile,
        );

      // Changes to the .elm files don’t make the elm.json:s more unique, but
      // see  "ElmJsonNotFound" above for why we restart anyway.
      case "NonUniqueElmJsonPaths":
        return error.nonUniqueElmJsonPaths.some(({ inputPath }) =>
          equalsInputPath(elmFile, inputPath),
        );
    }
  });
}

function isElmJsonFileRelatedToElmJsonsErrors(
  absoluteElmJsonFilePath: string,
  elmJsonsErrors: Project["elmJsonsErrors"],
): boolean {
  return elmJsonsErrors.some(({ error }) => {
    switch (error.tag) {
      case "DuplicateInputs":
      case "InputsFailedToResolve":
      case "InputsNotFound":
        return false;
      case "ElmJsonNotFound":
        return error.foundElmJsonPaths.some(
          ({ elmJsonPath }) => elmJsonPath === absoluteElmJsonFilePath,
        );
      case "NonUniqueElmJsonPaths":
        return error.nonUniqueElmJsonPaths.some(
          ({ elmJsonPath }) => elmJsonPath === absoluteElmJsonFilePath,
        );
    }
  });
}

function webSocketConnectionIsForOutputPath(
  webSocketConnection: WebSocketConnection,
  outputPath: OutputPath,
): boolean {
  switch (webSocketConnection.outputPath.tag) {
    case "OutputPathError":
      return false;

    case "OutputPath":
      return (
        webSocketConnection.outputPath.theOutputPath ===
        outputPath.theOutputPath
      );
  }
}

const WebSocketConnectedParams = Codec.fields(
  {
    elmWatchVersion: Codec.string,
    webSocketToken: Codec.string,
    targetName: TargetName,
    elmCompiledTimestamp: Codec.flatMap(Codec.string, {
      decoder: (string) => {
        const number = Number(string);
        return Number.isFinite(number)
          ? { tag: "Valid", value: number }
          : {
              tag: "DecoderError",
              error: {
                tag: "custom",
                message: "Expected a number",
                got: string,
                path: [],
              },
            };
      },
      encoder:
        /* v8 ignore next */
        (value) => value.toString(),
    }),
  },
  { allowExtraFields: false },
);

type ParseWebSocketConnectRequestUrlResult =
  | ParseWebSocketConnectRequestUrlError
  | {
      tag: "ElmJsonError";
      error: ElmJsonErrorWithMetadata;
    }
  | {
      tag: "Success";
      elmJsonPath: ElmJsonPath;
      outputPath: OutputPath;
      outputState: OutputState;
      elmCompiledTimestamp: number;
    };

type ParseWebSocketConnectRequestUrlError =
  | {
      tag: "ParamsDecodeError";
      error: Codec.DecoderError;
      urlParams: URLSearchParams;
    }
  | {
      tag: "TargetDisabled";
      targetName: TargetName;
      enabledOutputs: Array<OutputPath>;
      disabledOutputs: Array<OutputPath>;
    }
  | {
      tag: "TargetNotFound";
      targetName: TargetName;
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
  urlParams: URLSearchParams,
): ParseWebSocketConnectRequestUrlResult {
  const webSocketConnectedParamsResult = WebSocketConnectedParams.decoder(
    Object.fromEntries(urlParams),
  );
  if (webSocketConnectedParamsResult.tag === "DecoderError") {
    return {
      tag: "ParamsDecodeError",
      error: webSocketConnectedParamsResult.error,
      urlParams,
    };
  }
  const webSocketConnectedParams = webSocketConnectedParamsResult.value;

  if (webSocketConnectedParams.elmWatchVersion !== "%VERSION%") {
    return {
      tag: "WrongVersion",
      expectedVersion: "%VERSION%",
      actualVersion: webSocketConnectedParams.elmWatchVersion,
    };
  }

  const flatOutputs = getFlatOutputs(project);

  const { targetName } = webSocketConnectedParams;
  const matchElmJsonError = project.elmJsonsErrors.find(
    ({ outputPath }) => outputPath.targetName === targetName,
  );
  const matchOutput = flatOutputs.find(
    ({ outputPath }) => outputPath.targetName === targetName,
  );

  if (matchElmJsonError !== undefined) {
    return {
      tag: "ElmJsonError",
      error: matchElmJsonError,
    };
  } else if (matchOutput !== undefined) {
    return {
      tag: "Success",
      elmJsonPath: matchOutput.elmJsonPath,
      outputPath: matchOutput.outputPath,
      outputState: matchOutput.outputState,
      elmCompiledTimestamp: webSocketConnectedParams.elmCompiledTimestamp,
    };
  } else {
    const enabledOutputs = [
      ...project.elmJsonsErrors.map(({ outputPath }) => outputPath),
      ...flatOutputs.map(({ outputPath }) => outputPath),
    ];
    const disabledOutputs = Array.from(project.disabledOutputs);
    const disabledMatch = disabledOutputs.find(
      (outputPath) => outputPath.targetName === targetName,
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
}

function webSocketConnectRequestUrlResultToOutputPath(
  result: ParseWebSocketConnectRequestUrlResult,
): OutputPath | OutputPathError {
  switch (result.tag) {
    case "Success":
      return result.outputPath;
    case "ElmJsonError":
      return result.error.outputPath;
    default: {
      // Make sure only error results are left.
      const _: ParseWebSocketConnectRequestUrlError = result;
      void _;
      return { tag: "OutputPathError" };
    }
  }
}

function webSocketConnectRequestUrlErrorToString(
  webSocketUrl: WebSocketUrl | undefined,
  error: ParseWebSocketConnectRequestUrlError,
): string {
  switch (error.tag) {
    case "ParamsDecodeError":
      return Errors.webSocketParamsDecodeError(
        webSocketUrl,
        error.error,
        error.urlParams,
      );

    case "WrongVersion":
      return Errors.webSocketWrongVersion(
        error.expectedVersion,
        error.actualVersion,
      );

    case "TargetNotFound":
      return Errors.webSocketTargetNotFound(
        error.targetName,
        error.enabledOutputs,
        error.disabledOutputs,
      );

    case "TargetDisabled":
      return Errors.webSocketTargetDisabled(
        error.targetName,
        error.enabledOutputs,
        error.disabledOutputs,
      );
  }
}

type ParseWebSocketToServerMessageResult =
  | {
      tag: "DecoderError";
      error: Codec.DecoderError;
    }
  | {
      tag: "Success";
      message: WebSocketToServerMessage;
    };

function parseWebSocketToServerMessage(
  data: WebSocket.Data,
): ParseWebSocketToServerMessageResult {
  /* v8 ignore start */
  const stringData =
    typeof data === "string"
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : data instanceof ArrayBuffer
          ? new TextDecoder("utf8").decode(data)
          : data.toString("utf8");
  /* v8 ignore stop */

  const parsed = Codec.JSON.parse(WebSocketToServerMessage, stringData);
  switch (parsed.tag) {
    case "DecoderError":
      return { tag: "DecoderError", error: parsed.error };
    case "Valid":
      return { tag: "Success", message: parsed.value };
  }
}

function onWebSocketConnected(
  date: Date,
  model: Model,
  elmWatchJsonPath: ElmWatchJsonPath,
  elmJsonPath: ElmJsonPath,
  outputPath: OutputPath,
  outputState: OutputState,
  elmCompiledTimestamp: number,
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
      outputState,
    );
    return [newModel, event, cmds];
  };

  switch (model.hotState.tag) {
    /* v8 ignore start */
    case "Restarting":
    case "Dependencies":
      return [model, event, []];
    /* v8 ignore stop */

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
                        browserUiPosition: outputState.browserUiPosition,
                      },
                    },
                  },
                ],
              ]
            : recompileNeeded();

        case "NotWrittenToDisk":
        case "ElmMakeTypecheckOnly":
          return recompileNeeded();

        /* v8 ignore next */
        case "ElmMake":
        case "Postprocess":
        case "Interrupted":
        case "QueuedForElmMake":
        case "QueuedForPostprocess":
          switch (model.hotState.tag) {
            /* v8 ignore start */
            case "Idle":
              return recompileNeeded();
            /* v8 ignore stop */

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
                browserUiPosition: outputState.browserUiPosition,
                openErrorOverlay: outputState.openErrorOverlay,
                errors: Compile.renderOutputErrors(
                  elmWatchJsonPath,
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

function onChangedCompilationModeOrBrowserUiPosition(
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState,
): [Model, Array<Cmd>] {
  switch (model.hotState.tag) {
    /* v8 ignore start */
    case "Restarting":
    case "Dependencies":
      return [model, []];
    /* v8 ignore stop */

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
    /* v8 ignore start */
    case "Restart":
      return [model, []];
    /* v8 ignore stop */

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
            killInstallDependencies: false,
          },
        ],
      ];
  }
}

function compileNextAction(nextAction: NextAction): NextAction {
  switch (nextAction.tag) {
    /* v8 ignore next */
    case "Restart":
    case "Compile":
      return nextAction;
    case "NoAction":
      return { tag: "Compile" };
  }
}

function onWebSocketToServerMessage(
  elmWatchJsonPath: ElmWatchJsonPath,
  model: Model,
  date: Date,
  output: WebSocketMessageReceivedOutput,
  webSocket: WebSocket,
  message: WebSocketToServerMessage,
): [Model, Array<Cmd>] {
  switch (message.tag) {
    case "ChangedCompilationMode":
      switch (output.tag) {
        case "OutputPathError":
          return [model, []];

        case "Output": {
          const [newModel, cmds] = onChangedCompilationModeOrBrowserUiPosition(
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

    case "ChangedBrowserUiPosition":
      switch (output.tag) {
        case "OutputPathError":
          return [model, []];

        case "Output": {
          const [newModel, cmds] = onChangedCompilationModeOrBrowserUiPosition(
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
                  tag: "WebSocketChangedBrowserUiPosition",
                  date,
                  outputPath: output.outputPath,
                  browserUiPosition: message.browserUiPosition,
                },
              ],
            },
            [
              {
                tag: "ChangeBrowserUiPosition",
                outputState: output.outputState,
                browserUiPosition: message.browserUiPosition,
              },
              ...cmds,
            ],
          ];
        }
      }

    case "ChangedOpenErrorOverlay":
      switch (output.tag) {
        case "OutputPathError":
          return [model, []];

        case "Output": {
          const errors = Compile.renderOutputErrors(
            elmWatchJsonPath,
            output.elmJsonPath,
            output.outputPath,
            output.outputState.status,
          );
          return [
            model,
            [
              {
                tag: "ChangeOpenErrorOverlay",
                outputState: output.outputState,
                openErrorOverlay: message.openErrorOverlay,
              },
              /* v8 ignore start */
              isNonEmptyArray(errors)
                ? {
                    tag: "WebSocketSendCompileErrorToOutput",
                    outputPath: output.outputPath,
                    compilationMode: output.outputState.compilationMode,
                    browserUiPosition: output.outputState.browserUiPosition,
                    openErrorOverlay: message.openErrorOverlay,
                    errors,
                  }
                : { tag: "NoCmd" },
              /* v8 ignore stop */
            ],
          ];
        }
      }

    case "FocusedTab":
      return [
        model,
        [
          { tag: "WebSocketUpdatePriority", webSocket },
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

function webSocketSend(
  webSocket: WebSocket,
  message: WebSocketToClientMessage,
): void {
  webSocket.send(encodeWebSocketToClientMessage(message));
}

function webSocketSendToOutput(
  outputPath: OutputPath,
  message: WebSocketToClientMessage,
  webSocketConnections: Array<WebSocketConnection>,
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
    case "WebSocketConnectionRejected":
    case "WorkersLimitedAfterWebSocketClosed":
      return 100;

    // When switching compilation mode or browser UI position, sleep a short
    // amount of time so that the change feels more immediate.
    case "WebSocketChangedBrowserUiPosition":
    case "WebSocketChangedCompilationMode":
      return 10;
  }
}

function filterLatestEvents(events: Array<LatestEvent>): Array<LatestEvent> {
  // Changes to .elm files that don’t affect anything are only
  // interesting/non-confusing if they happen on their own.
  const filtered = events.filter(
    (event) => !(event.tag === "WatcherEvent" && !event.affectsAnyTarget),
  );
  return isNonEmptyArray(filtered) ? filtered : events;
}

function infoMessageWithTimeline({
  loggerConfig,
  date,
  mutable,
  host,
  message,
  events,
  hasErrors,
}: {
  loggerConfig: LoggerConfig;
  date: Date;
  mutable: Mutable;
  host: Host;
  message: string;
  events: Array<LatestEvent>;
  hasErrors: boolean;
}): string {
  return [
    loggerConfig.isTTY ? "" : undefined, // Empty line separator.
    loggerConfig.isTTY ? printAllStats(loggerConfig, mutable, host) : undefined,
    "",
    printTimeline(loggerConfig, events),
    printMessageWithTimeAndEmoji({
      loggerConfig,
      emojiName: hasErrors ? "Error" : "Success",
      date,
      dateHighlight: bold,
      message,
    }),
  ]
    .flatMap((part) => part ?? [])
    .join("\n");
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

function printAllStats(
  loggerConfig: LoggerConfig,
  mutable: Mutable,
  host: Host,
): string {
  const numWorkers = mutable.postprocessWorkerPool.getSize();
  return printStats(loggerConfig, [
    printServerLinks(mutable.webSocketServer, host),
    `${dim("web socket connections:")} ${mutable.webSocketConnections.length}${
      numWorkers > 0
        ? `${dim(`, ${ELM_WATCH_NODE} workers:`)} ${numWorkers}`
        : ""
    }`,
  ]);
}

function printStats(
  loggerConfig: LoggerConfig,
  stats: NonEmptyArray<string>,
): string {
  return stats
    .map((part) =>
      Compile.printStatusLine({
        maxWidth: Infinity,
        fancy: loggerConfig.fancy,
        isTTY: loggerConfig.isTTY,
        emojiName: "Stats",
        string: part,
      }),
    )
    .join("\n");
}

function printServerLinks(
  webSocketServer: WebSocketServer,
  host: Host,
): string {
  const protocol = webSocketServer.isHTTPS ? "https" : "http";
  const { port } = webSocketServer;

  if (host !== "0.0.0.0") {
    return `${dim("server:")} ${protocol}://${host}:${port}`;
  }

  const networkIps = Object.values(os.networkInterfaces())
    .flatMap((addresses = []) =>
      addresses.filter(
        (address) => address.family === "IPv4" && !address.internal,
      ),
    )
    .map(({ address }) => address);

  return `${dim("server:")} ${protocol}://localhost:${port}${networkIps
    .map((ip) => `${dim(", network:")} ${protocol}://${ip}:${port}`)
    .join("")}`;
}

export function printTimeline(
  loggerConfig: LoggerConfig,
  events: Array<LatestEvent>,
): string | undefined {
  if (!isNonEmptyArray(events)) {
    return undefined;
  }

  const base = 2;

  if (events.length <= 2 * base + 1) {
    return mapNonEmptyArray(events, (event) =>
      printEvent(loggerConfig, event),
    ).join("\n");
  }

  const start = events.slice(0, base);
  const end = events.slice(-base);

  const numMoreEvents = events.length - 2 * base;

  return [
    ...start.map((event) => printEvent(loggerConfig, event)),
    `${loggerConfig.fancy ? "   " : ""}(${numMoreEvents} more events)`,
    ...end.map((event) => printEvent(loggerConfig, event)),
  ].join("\n");
}

function printEvent(loggerConfig: LoggerConfig, event: LatestEvent): string {
  return printMessageWithTimeAndEmoji({
    loggerConfig,
    emojiName: "Information",
    date: event.date,
    dateHighlight: dim,
    message: dim(printEventMessage(event)),
  });
}

function printEventMessage(event: LatestEvent): string {
  switch (event.tag) {
    case "WatcherEvent":
      // TODO: Don’t really want to print changes to files in static dir?
      return `${capitalize(event.eventName)} ${
        event.file.tag === "AbsolutePath"
          ? event.file.absolutePath
          : event.file.urlPath
      }`;

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

    case "WebSocketConnectionRejected": {
      const origin =
        event.origin === undefined ? "unknown origin" : quote(event.origin);
      return `Web socket connection from ${origin} rejected due to: ${printWebSocketConnectionRejectedReason(event.reason)}`;
    }

    case "WebSocketChangedBrowserUiPosition":
      return `Changed browser UI position to ${quote(
        event.browserUiPosition,
      )} of: ${event.outputPath.targetName}`;

    case "WebSocketChangedCompilationMode":
      return `Changed compilation mode to ${quote(event.compilationMode)} of: ${
        event.outputPath.targetName
      }`;

    case "WorkersLimitedAfterWebSocketClosed":
      return `Terminated ${event.numTerminatedWorkers} superfluous ${
        /* v8 ignore next */
        event.numTerminatedWorkers === 1 ? "worker" : "workers"
      }`;
  }
}

function compileFinishedMessage(
  loggerConfig: LoggerConfig,
  duration: number,
): string {
  return `Compilation finished in ${bold(
    printDurationMs(
      loggerConfig.mockedTimings ? 123 : /* v8 ignore next */ duration,
    ).trim(),
  )}.`;
}

function printEventsMessage(
  events: Array<LatestEvent>,
  disabledOutputs: Array<OutputPath>,
): string {
  const what1 = events.length === 1 ? "file is" : "files are";
  const what2 =
    disabledOutputs.length > 0 ? "any of the enabled targets" : "any target";
  return events.every(
    (event) => event.tag === "WatcherEvent" && !event.affectsAnyTarget,
  )
    ? `FYI: The above Elm ${what1} not imported by ${what2}. Nothing to do!`
    : "Everything up to date.";
}

function printWebSocketConnectionRejectedReason(
  reason: WebSocketConnectionRejectedReason,
): string {
  switch (reason.tag) {
    case "BadUrl":
      return `wrong URL prefix – ${quote(reason.expectedStart)} != ${quote(reason.actualUrlString.slice(0, reason.expectedStart.length))}`;
    case "WrongToken":
      return "invalid security token";
  }
}
