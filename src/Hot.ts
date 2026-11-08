import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as Codec from "tiny-decoders";
import * as url from "url";
import type { URLSearchParams } from "url";
import type WebSocket from "ws";

import {
  encodeWebSocketToClientMessage,
  type WebSocketToClientMessage,
  WebSocketToServerMessage,
} from "../client/WebSocketMessages.ts";
import { ALLOWED_HOSTS_DOCS_LINK, type RejectedHost } from "./AllowedHosts.ts";
import * as Compile from "./Compile.ts";
import type { ConfigSource, OpenEditorFunction } from "./Config.ts";
import { ElmWatchStuffJson, type Target } from "./ElmWatchStuffJson.ts";
import {
  __ELM_WATCH_EXIT_ON_ERROR,
  __ELM_WATCH_OPEN_EDITOR_TIMEOUT_MS,
  type Env,
} from "./Env.ts";
import * as Errors from "./Errors.ts";
import type { ErrorTemplate } from "./Errors.ts";
import {
  bold,
  capitalize,
  dim,
  formatTime,
  printDurationMs,
  quote,
  silentlyReadIntEnvValue,
  toError,
  unknownErrorToString,
} from "./Helpers.ts";
import type { Host } from "./Host.ts";
import * as Inject from "./Inject.ts";
import type { Logger, LoggerConfig } from "./Logger.ts";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  type NonEmptyArray,
} from "./NonEmptyArray.ts";
import { absoluteDirname } from "./PathHelpers.ts";
import type { PortChoice } from "./Port.ts";
import {
  type ApplicationTargetErrorWithMetadata,
  getAllTargetStates,
  getApplicationTargetsErrors,
  getFlatOutputs,
  getPackageSourceDirectory,
  getPackageStates,
  type OutputError,
  type OutputState,
  type PackageState,
  type Project,
  projectHasFilePathThatCanBeOpenedInEditor,
} from "./Project.ts";
import * as SimpleStaticFileServer from "./SimpleStaticFileServer.ts";
import { waitForRunningCommands } from "./Spawn.ts";
import { runTeaProgram } from "./TeaProgram.ts";
import * as Theme from "./Theme.ts";
import {
  type AbsolutePath,
  type BrowserUiPosition,
  type CompilationMode,
  type CreateServer,
  type ElmJsonPath,
  type ElmWatchJsonPath,
  type InputPath,
  type GetNow,
  type OutputPath,
  type TargetLocation,
  TargetName,
  type WebSocketToken,
} from "./Types.ts";
import * as Watcher from "./Watcher.ts";
import {
  type WebSocketConnectionRejectedReason,
  WebSocketServer,
  type WebSocketServerMsg,
} from "./WebSocketServer.ts";
import type {
  WebSocketConnection as WebSocketUrlConnection,
  WebSocketUrl,
} from "./WebSocketUrl.ts";

// We can’t tell whether something was added or changed, since `fs.watch`
// does not reliably say. That also doesn’t matter much.
type WatcherEventName = "changed" | "removed";

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
    };

type OutputRequestedEvent = {
  tag: "OutputRequestedNeedingCompilation";
  date: Date;
  outputPath: OutputPath;
};

export type LatestEvent =
  | OutputRequestedEvent
  | WebSocketRelatedEvent
  | (WatcherEvent & { affectsAnyTarget: boolean });

type Mutable = {
  watcher: Watcher.Watcher;
  webSocketServer: WebSocketServer;
  webSocketConnections: Array<WebSocketConnection>;
  outputRequests: Array<OutputRequest>;
  project: Project;
  lastInfoMessage: string | undefined;
  watcherTimeoutId: NodeJS.Timeout | undefined;
  watcherReadyTimeoutId: NodeJS.Timeout | undefined;
  elmWatchStuffJsonWriteError: Error | undefined;
  killInstallDependencies: ((options: { force: boolean }) => void) | undefined;
  unsubscribeFromGracefulExit: () => void;
};

type WebSocketConnection = {
  webSocket: WebSocket;
  outputPath: OutputPath | OutputPathError;
  priority: number;
};

// An HTTP request for an output that waits for the output to be compiled.
type OutputRequest = {
  msg: Extract<WebSocketServerMsg, { tag: "OutputRequested" }>;
  outputPath: OutputPath;
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
    };

type Model = {
  nextAction: NextAction;
  hotState: HotState;
  latestEvents: Array<LatestEvent>;
  // Watcher events are handled once the sleep before the next action is done.
  // Then we check if the paths exist. Atomic saves (write to a temporary
  // file, then rename it over the original) can briefly make a file look
  // removed, so we don’t want to check right away.
  pendingWatcherEvents: Array<PendingWatcherEvent>;
};

type PendingWatcherEvent = {
  date: Date;
  absolutePath: AbsolutePath;
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
      reason: "CtrlCPressed" | "Other" | "GracefulExit";
    }
  | {
      tag: "Restart";
      restartReasons: Array<LatestEvent>;
      webSocketState: WebSocketState | undefined;
      webSocketToken: WebSocketToken;
    };

export type WebSocketState = {
  webSocketServer: WebSocketServer;
  webSocketConnections: Array<WebSocketConnection>;
};

// This is only used in tests.
export type HotTestHooks = {
  // You are supposed to pass `undefined` initially. While running, this is
  // mutated to the function. Once successfully run, it is set back to
  // `undefined` again. Used to clean up between each test.
  kill: (() => Promise<void>) | undefined;
  // Called after each message has been handled. `isIdle` is true when there
  // is nothing more to do until something happens (nothing compiling, and no
  // pending events to handle or print). Lets tests wait for things to happen
  // instead of sleeping.
  onUpdate?: (msg: Msg, isIdle: boolean) => void;
  // Called with `false` when file watchers are created, and with `true` once
  // they should be up and running (see `WATCHER_READY_DELAY_MS`). Changes made
  // before that might be missed.
  onWatcherReadyChange?: (isReady: boolean) => void;
  // Replaces listening for SIGTERM on `process`. Returns an unsubscribe function.
  subscribeToSigterm?: (listener: () => void) => () => void;
};

function subscribeToProcessSigterm(listener: () => void): () => void {
  process.on("SIGTERM", listener);
  return () => {
    process.off("SIGTERM", listener);
  };
}

// This uses something inspired by The Elm Architecture, since it’s all about
// keeping state (model) and reacting to events (messages).
export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  createServer: CreateServer,
  restartReasons: Array<LatestEvent>,
  webSocketState: WebSocketState | undefined,
  webSocketToken: WebSocketToken,
  project: Project,
  portChoice: PortChoice,
  signal: AbortSignal | undefined,
  hotTestHooks: HotTestHooks,
): Promise<HotRunResult> {
  const exitOnError = __ELM_WATCH_EXIT_ON_ERROR in env;

  const result = await runTeaProgram<Mutable, Msg, Model, Cmd, HotRunResult>({
    initMutable: initMutable(
      logger,
      getNow,
      createServer,
      webSocketState,
      webSocketToken,
      project,
      portChoice,
      signal,
      hotTestHooks,
    ),
    init: init(getNow(), restartReasons, getApplicationTargetsErrors(project)),
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
        newModel.latestEvents.length > model.latestEvents.length ||
        newModel.pendingWatcherEvents.length > model.pendingWatcherEvents.length
          ? {
              tag: "SleepBeforeNextAction",
              sleepMs: getNextActionSleepMs(newModel),
              watcherPaths: newModel.pendingWatcherEvents.map(
                (event) => event.absolutePath,
              ),
            }
          : { tag: "NoCmd" },
      ];
      logger.debug(msg.tag, msg, newModel, allCmds);
      hotTestHooks.onUpdate?.(
        msg,
        newModel.nextAction.tag === "NoAction" &&
          newModel.hotState.tag === "Idle" &&
          newModel.latestEvents.length === 0 &&
          newModel.pendingWatcherEvents.length === 0,
      );
      return [newModel, allCmds];
    },
    runCmd: runCmd(env, logger, getNow, exitOnError, webSocketToken),
  });

  hotTestHooks.kill = undefined;

  return result;
}

export async function watchElmWatchJsonOnce(
  getNow: GetNow,
  elmWatchJsonPath: ElmWatchJsonPath,
  onReady: () => void,
): Promise<WatcherEvent> {
  return new Promise((resolve, reject) => {
    // Watch the directory rather than the file itself, since editors might
    // replace the file (giving it a new inode) when saving.
    const basename = path.basename(elmWatchJsonPath);
    const watcher = fs.watch(path.dirname(elmWatchJsonPath), (_, filename) => {
      if (filename === null || filename === basename) {
        watcher.close();
        resolve({
          tag: "WatcherEvent",
          date: getNow(),
          eventName: fs.existsSync(elmWatchJsonPath) ? "changed" : "removed",
          file: {
            tag: "AbsolutePath",
            absolutePath: elmWatchJsonPath,
          },
        });
      }
    });
    watcher.on("error", (error) => {
      watcher.close();
      reject(error);
    });
    onReady();
  });
}

const initMutable =
  (
    logger: Logger,
    getNow: GetNow,
    createServer: CreateServer,
    webSocketState: WebSocketState | undefined,
    webSocketToken: WebSocketToken,
    project: Project,
    portChoice: PortChoice,
    signal: AbortSignal | undefined,
    hotTestHooks: HotTestHooks,
  ) =>
  (
    dispatch: (msg: Msg) => void,
    resolvePromise: (result: HotRunResult) => void,
    rejectPromise: (error: Error) => void,
  ): Mutable => {
    hotTestHooks.onWatcherReadyChange?.(false);
    const watcher = Watcher.watch(
      project.watchDirs,
      (absolutePath) => {
        dispatch({
          tag: "GotWatcherEvent",
          date: getNow(),
          absolutePath,
        });
      },
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
    );

    const {
      webSocketServer = new WebSocketServer(
        createServer,
        portChoice,
        project.host,
        project.staticFilesDir,
        webSocketToken,
        project.allowedHosts,
        project.configSource,
      ),
      webSocketConnections = [],
    } = webSocketState ?? {};

    const mutable: Mutable = {
      watcher,
      webSocketServer,
      webSocketConnections,
      outputRequests: [],
      project,
      lastInfoMessage: undefined,
      watcherTimeoutId: undefined,
      watcherReadyTimeoutId: setTimeout(() => {
        hotTestHooks.onWatcherReadyChange?.(true);
      }, WATCHER_READY_DELAY_MS),
      elmWatchStuffJsonWriteError: undefined,
      killInstallDependencies: undefined,
      unsubscribeFromGracefulExit: () => {
        // Replaced below.
      },
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

    webSocketServer.setIsOutputPath(
      (absolutePath) =>
        findOutputForPath(mutable.project, absolutePath) !== undefined,
    );

    // The port isn’t finalized until a few moments later (when the persisted
    // port is not available).
    webSocketServer.listening
      .then(() => {
        writeElmWatchStuffJson(mutable, webSocketToken);
        // When not running as a TTY the output is a simple log, and it gets
        // a bit tedious if the stats are printed after each event. Instead,
        // we print it once at startup, and only the server links (connections
        // are always 0 at that time).
        // This has to be done once the server is ready – we don’t know the
        // final port number to print until then.
        const isRestart = webSocketState !== undefined;
        if (!logger.config.isTTY && !isRestart) {
          logger.write(
            printStats(logger.config, [
              printServerLinks(mutable.webSocketServer, mutable.project.host),
            ]),
          );
        }
      })
      .catch(rejectPromise);

    const kill = async (): Promise<void> => {
      try {
        if (mutable.killInstallDependencies !== undefined) {
          mutable.killInstallDependencies({ force: true });
        }
        for (const targetState of getAllTargetStates(project)) {
          if ("kill" in targetState.status) {
            targetState.status.kill({ force: true });
          }
        }
        await closeAll(logger, mutable);
      } catch (unknownError) {
        const error = toError(unknownError);
        rejectPromise(toError(error));
      }

      hotTestHooks.kill = undefined;
    };

    hotTestHooks.kill = async () => {
      dispatch({ tag: "ExitRequested", date: getNow() });
      await kill();
      resolvePromise({ tag: "ExitOnIdle", reason: "Other" });
    };

    logger.setRawMode(() => {
      kill()
        .then(() => {
          resolvePromise({
            tag: "ExitOnIdle",
            reason: "CtrlCPressed",
          });
        })
        .catch(rejectPromise);
    });

    // `node --watch` sends SIGTERM when restarting. Unlike ctrl+c, we let `elm`
    // finish (up to a timeout) before exiting, so that the next elm-watch
    // doesn’t run `elm` at the same time as the old one (which can corrupt
    // elm-stuff/). The `signal` option works the same way.
    const exitGracefully = (): void => {
      if (mutable.killInstallDependencies !== undefined) {
        mutable.killInstallDependencies({ force: false });
      }
      for (const targetState of getAllTargetStates(project)) {
        if ("kill" in targetState.status) {
          targetState.status.kill({ force: false });
        }
      }
      closeAll(logger, mutable)
        .then(waitForRunningCommands)
        .then(() => {
          resolvePromise({ tag: "ExitOnIdle", reason: "GracefulExit" });
        })
        .catch(rejectPromise);
    };

    const unsubscribeFromSigterm = (
      hotTestHooks.subscribeToSigterm ?? subscribeToProcessSigterm
    )(exitGracefully);
    signal?.addEventListener("abort", exitGracefully);
    mutable.unsubscribeFromGracefulExit = () => {
      unsubscribeFromSigterm();
      signal?.removeEventListener("abort", exitGracefully);
    };
    if (signal?.aborted === true) {
      // Wait for initialization to finish.
      queueMicrotask(exitGracefully);
    }

    return mutable;
  };

function writeElmWatchStuffJson(
  mutable: Mutable,
  webSocketToken: WebSocketToken,
): void {
  const targets: Record<string, Required<Target>> = Object.fromEntries([
    ...getApplicationTargetsErrors(mutable.project).map(
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

const init = (
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

function update(
  loggerConfig: LoggerConfig,
  project: Project,
  exitOnError: boolean,
  msg: Msg,
  model: Model,
): [Model, Array<Cmd>] {
  switch (msg.tag) {
    case "GotWatcherEvent":
      return [
        {
          ...model,
          pendingWatcherEvents: [
            ...model.pendingWatcherEvents,
            { date: msg.date, absolutePath: msg.absolutePath },
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
          return runNextAction(msg.date, project, model);
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
      const [newModel, cmds] = runNextAction(
        msg.date,
        project,
        modelWithEvents,
      );
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
      return onOutputRequested(
        msg.date,
        model,
        msg.outputPath,
        msg.outputState,
      );

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
          const targetError = result.error;
          const event: WebSocketRelatedEvent = {
            tag: "WebSocketConnectedNeedingNoAction",
            date: msg.date,
            outputPath: targetError.outputPath,
          };

          return [
            {
              ...model,
              latestEvents: [...model.latestEvents, event],
            },
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
  const [firstEvent] = model.pendingWatcherEvents;
  if (changedSourceDirectory !== undefined && firstEvent !== undefined) {
    const [nextAction, latestEvent, cmds] = makeRestartNextAction(
      makeWatcherEvent(
        project.missingSourceDirectories.has(changedSourceDirectory)
          ? "changed"
          : "removed",
        changedSourceDirectory,
        firstEvent.date,
      ),
      project,
    );
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
  const latestByPath = new Map<AbsolutePath, PendingWatcherEvent>();
  for (const event of model.pendingWatcherEvents) {
    latestByPath.delete(event.absolutePath);
    latestByPath.set(event.absolutePath, event);
  }

  let { nextAction } = model;
  const latestEvents = [...model.latestEvents];
  const cmds: Array<Cmd> = [];

  for (const { date, absolutePath } of latestByPath.values()) {
    const result = onWatcherEvent(
      date,
      project,
      removedPaths.has(absolutePath) ? "removed" : "changed",
      absolutePath,
      nextAction,
    );
    if (result !== undefined) {
      const [updatedNextAction, latestEvent, newCmds] = result;
      nextAction = updatedNextAction;
      latestEvents.push(latestEvent);
      cmds.push(...newCmds);
    }
  }

  return [
    { ...model, nextAction, latestEvents, pendingWatcherEvents: [] },
    cmds,
  ];
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
      // elm-watch.json files are irrelevant when not using elm-watch.json.
      if (project.configSource.tag !== "ElmWatchJson") {
        return undefined;
      }
      // We don’t know if an elm-watch.json other than the current one was
      // added or changed. Adding one could change which one is used, so
      // restart to be safe.
      if (
        absolutePath === project.configSource.elmWatchJsonPath ||
        eventName === "changed"
      ) {
        return makeRestartNextAction(
          makeWatcherEvent(eventName, absolutePath, now),
          project,
        );
      }
      return undefined;

    case "elm.json":
      if (getAllElmJsonPaths(project).some((p) => absolutePath === p)) {
        return makeRestartNextAction(
          makeWatcherEvent(eventName, absolutePath, now),
          project,
        );
      }
      return undefined;

    // Some compiler error messages suggest removing elm-stuff to fix the error.
    // Restart when that happens. Note: This could be a totally unrelated
    // elm-stuff directory, but I don’t think it’s worth the trouble trying to
    // check if it affects the project, and possibly logging if it isn’t.
    // See also `isElmStuffCompilerDir` below.
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
      if (eventName === "removed" && isElmStuffCompilerDir(absolutePath)) {
        return makeRestartNextAction(
          makeWatcherEvent(eventName, absolutePath, now),
          project,
        );
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

      // A directory might have been moved, added or removed. We only get an
      // event for the directory itself, not for every file inside it.
      return onDirectoryWatcherEvent(
        project,
        makeWatcherEvent(eventName, absolutePath, now),
        nextAction,
      );
  }
}

// Removing just the compiler’s directory, like elm-stuff/0.19.1/, is enough to
// get rid of a corrupt cache. That preserves files from other tools in
// elm-stuff/, like elm-watch, elm-review and elm-test.
function isElmStuffCompilerDir(absolutePath: AbsolutePath): boolean {
  return (
    path.basename(path.dirname(absolutePath)) === "elm-stuff" &&
    /^\d+\.\d+\.\d+$/.test(path.basename(absolutePath))
  );
}

function onDirectoryWatcherEvent(
  project: Project,
  event: WatcherEvent<TaggedAbsolutePath>,
  nextAction: NextAction,
): [NextAction, LatestEvent, Array<Cmd>] | undefined {
  const prefix = event.file.absolutePath + path.sep;
  const isInside = (absolutePath: AbsolutePath): boolean =>
    absolutePath.startsWith(prefix);

  if (
    (project.configSource.tag === "ElmWatchJson" &&
      isInside(project.configSource.elmWatchJsonPath)) ||
    getAllElmJsonPaths(project).some(isInside) ||
    isElmFileRelatedToTargetsErrors(isInside, project.targetsErrors)
  ) {
    return makeRestartNextAction(event, project);
  }

  const result = onElmFilesWatcherEvent(project, event, isInside, nextAction);
  // Ignore other types of files.
  return result[1].tag === "WatcherEvent" && !result[1].affectsAnyTarget
    ? undefined
    : result;
}

function onElmFileWatcherEvent(
  project: Project,
  event: WatcherEvent<TaggedAbsolutePath>,
  nextAction: NextAction,
): [NextAction, LatestEvent, Array<Cmd>] {
  const elmFile = event.file.absolutePath;
  const isElmFile = (absolutePath: AbsolutePath): boolean =>
    absolutePath === elmFile;

  if (isElmFileRelatedToTargetsErrors(isElmFile, project.targetsErrors)) {
    return makeRestartNextAction(event, project);
  }

  return onElmFilesWatcherEvent(project, event, isElmFile, nextAction);
}

// `matches` is either an exact match for an .elm file, or checks if a path is
// inside a directory.
function onElmFilesWatcherEvent(
  project: Project,
  event: WatcherEvent<TaggedAbsolutePath>,
  matches: (absolutePath: AbsolutePath) => boolean,
  nextAction: NextAction,
): [NextAction, LatestEvent, Array<Cmd>] {
  const matchesInputPath = (inputPath: InputPath): boolean =>
    matches(inputPath.theInputPath) || matches(inputPath.realpath);

  const dirtyOutputs: Array<{
    outputPath: OutputPath;
    outputState: OutputState;
  }> = [];
  const dirtyPackages: Array<PackageState> = [];

  for (const [elmJsonPath, outputs] of project.elmJsons) {
    for (const [outputPath, outputState] of outputs) {
      if (
        event.eventName === "removed" &&
        outputState.inputs.some(matchesInputPath)
      ) {
        return makeRestartNextAction(event, project);
      }
      Compile.ensureAllRelatedElmFilePaths(elmJsonPath, outputState);
      if (
        outputState.allRelatedElmFilePaths.has(event.file.absolutePath) ||
        Array.from(outputState.allRelatedElmFilePaths).some(matches)
      ) {
        dirtyOutputs.push({ outputPath, outputState });
      }
    }
  }

  // Packages typecheck everything in their source directory (src/).
  for (const [elmJsonPath, [, packageState]] of project.packages) {
    const sourceDirectory = getPackageSourceDirectory(elmJsonPath);
    if (
      event.file.absolutePath.startsWith(sourceDirectory + path.sep) ||
      matches(sourceDirectory)
    ) {
      dirtyPackages.push(packageState);
    }
  }

  return isNonEmptyArray(dirtyOutputs) || isNonEmptyArray(dirtyPackages)
    ? [
        compileNextAction(nextAction),
        { ...event, affectsAnyTarget: true },
        [
          {
            tag: "MarkAsDirty",
            outputs: dirtyOutputs,
            packages: dirtyPackages,
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
          prioritizedOutputs: makePrioritizedOutputs(mutable),
        });

        switch (cmd.mode) {
          case "AfterInstallDependencies":
            logger.withSynchronizedOutput(() => {
              Compile.printStatusLinesForTargetsErrors(logger, mutable.project);
              Compile.printSpaceForOutputs(logger, "hot", outputActions);
            });
            break;

          case "AfterIdle":
            logger.withSynchronizedOutput(() => {
              logger.clearScreen();
              mutable.lastInfoMessage = undefined;
              Compile.printStatusLinesForTargetsErrors(logger, mutable.project);
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
                webSocketConnection: getWebSocketConnection(mutable),
                webSocketToken,
              },
              total: outputActions.total,
              action,
            })
              .then((handleOutputActionResult) => {
                dispatch({
                  tag: "CompilationPartDone",
                  date: getNow(),
                  prioritizedOutputs: makePrioritizedOutputs(mutable),
                  handleOutputActionResult,
                });
              })
              .catch(rejectPromise);
          }
        } else if (outputActions.numExecuting === 0) {
          dispatch({
            tag: "CompilationPartDone",
            date: getNow(),
            prioritizedOutputs: makePrioritizedOutputs(mutable),
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
          // oxlint-disable-next-line typescript/no-unnecessary-condition
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

      case "LogInfoMessageWithTimeline": {
        const fullMessage = infoMessageWithTimeline({
          loggerConfig: logger.config,
          date: getNow(),
          mutable,
          host: mutable.project.host,
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
            outputState.status.kill({ force: false });
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
        for (const packageState of cmd.packages) {
          packageState.dirty = true;
          if ("kill" in packageState.status) {
            packageState.status.kill({ force: false });
          }
        }
        return;

      case "NoCmd":
        return;

      case "OpenEditor": {
        const { openEditor } = mutable.project;
        if (openEditor.tag === "NotSet") {
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
          switch (openEditor.tag) {
            case "Command":
              openEditorWithCommand(env, mutable, cmd, openEditor.command);
              return;
            case "Function":
              openEditorWithFunction(cmd, openEditor.openEditor);
              return;
          }
        }
        return;
      }

      case "PrintCompileErrors":
        logger.withSynchronizedOutput(() => {
          Compile.printErrors(logger, cmd.errors);
        });
        return;

      case "RespondToOutputRequests": {
        const flatOutputs = getFlatOutputs(mutable.project);
        mutable.outputRequests = mutable.outputRequests.filter(
          ({ msg, outputPath }) => {
            const output = flatOutputs.find(
              (flatOutput) =>
                flatOutput.outputPath.theOutputPath ===
                outputPath.theOutputPath,
            );
            if (output === undefined) {
              msg.serveStatic();
              return false;
            }
            const response = getOutputRequestResponse(output.outputState);
            const respondAnyway =
              cmd.waiting === "RespondToAll" ||
              (cmd.waiting === "RespondIfNotDirty" &&
                !output.outputState.dirty);
            switch (
              response === "Wait" && respondAnyway ? "ServeProxy" : response
            ) {
              case "ServeFile":
                msg.serveStatic();
                return false;

              // The proxy file connects to the web socket server, which shows
              // errors, or compiles and reloads the page.
              case "ServeProxy":
                SimpleStaticFileServer.respondJavaScript(
                  msg.request,
                  msg.response,
                  Inject.proxyFile(
                    outputPath,
                    getNow().getTime(),
                    output.outputState.browserUiPosition,
                    getWebSocketConnection(mutable),
                    webSocketToken,
                    logger.config.debug,
                  ),
                );
                return false;

              case "Wait":
                return true;
            }
          },
        );
        return;
      }

      case "Restart": {
        // Outputs and port may have changed if elm-watch.json changes.
        const elmWatchJsonChanged = cmd.restartReasons.some((event) => {
          switch (event.tag) {
            case "WatcherEvent":
              return (
                event.file.tag === "AbsolutePath" &&
                path.basename(event.file.absolutePath) === "elm-watch.json"
              );
            default:
              return false;
          }
        });
        closeAll(logger, mutable, {
          killWebSocketServer: elmWatchJsonChanged,
        })
          .then(() => {
            if (!elmWatchJsonChanged) {
              // Let waiting requests wait for the next run instead.
              for (const { msg } of mutable.outputRequests) {
                mutable.webSocketServer.dispatchToQueue(msg);
              }
            }
            resolvePromise({
              tag: "Restart",
              restartReasons: cmd.restartReasons,
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
          dispatch({
            tag: "SleepBeforeNextActionDone",
            date: getNow(),
            removedPaths: new Set(
              cmd.watcherPaths.filter(
                (absolutePath) => !fs.existsSync(absolutePath),
              ),
            ),
            changedSourceDirectories: mutable.project.watchDirs.flatMap(
              ({ tag, dir }) =>
                tag === "SourceDirectory" &&
                fs.existsSync(dir) ===
                  mutable.project.missingSourceDirectories.has(dir)
                  ? [dir]
                  : [],
            ),
          });
        }, cmd.sleepMs);
        return;

      case "Throw":
        rejectPromise(cmd.error);
        return;

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
    case "OutputRequested": {
      const output = findOutputForPath(mutable.project, msg.absolutePath);
      if (output === undefined) {
        msg.serveStatic();
        return;
      }
      const outputRequest: OutputRequest = {
        msg,
        outputPath: output.outputPath,
        priority: now.getTime(),
      };
      mutable.outputRequests.push(outputRequest);
      // Stop prioritizing the output if the browser gives up on the request.
      msg.response.once("close", () => {
        mutable.outputRequests = mutable.outputRequests.filter(
          (request) => request !== outputRequest,
        );
      });
      dispatch({
        tag: "OutputRequested",
        date: now,
        outputPath: output.outputPath,
        outputState: output.outputState,
      });
      return;
    }

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
      dispatch({
        tag: "WebSocketClosed",
        date: now,
        outputPath:
          removedConnection === undefined
            ? { tag: "OutputPathError" }
            : removedConnection.outputPath,
      });
      return;
    }

    case "WebSocketMessageReceived": {
      const webSocketConnection = mutable.webSocketConnections.find(
        ({ webSocket }) => webSocket === msg.webSocket,
      );

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
                errorTemplate: Errors.hostNotFound(
                  mutable.project.configSource,
                  host,
                  msg.error.error,
                ),
              });
            })
            .catch(rejectPromise);
          return;
        }

        case "OtherError":
          rejectPromise(msg.error.error);
          return;
      }
  }
}

function portChoiceError(
  project: Project,
  portChoice: PortChoice,
  error: Error,
): Errors.ErrorTemplate {
  switch (portChoice.tag) {
    case "NoPort":
      return Errors.portConflictForNoPort(error);

    case "PersistedPort":
      return Errors.portConflictForPersistedPort(
        project.elmWatchStuffJsonPath,
        portChoice.port,
      );

    case "PortFromConfig":
      return Errors.portConflictForPortFromConfig(
        project.configSource,
        portChoice.port,
      );
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
        browserUiPosition:
          handleOutputActionResult.outputState.browserUiPosition,
        openErrorOverlay: handleOutputActionResult.outputState.openErrorOverlay,
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
  { killWebSocketServer = true } = {},
): Promise<void> {
  logger.reset();
  mutable.unsubscribeFromGracefulExit();

  if (mutable.watcherTimeoutId !== undefined) {
    clearTimeout(mutable.watcherTimeoutId);
  }
  clearTimeout(mutable.watcherReadyTimeoutId);

  mutable.webSocketServer.unsetDispatch();
  mutable.watcher.close();
  if (killWebSocketServer) {
    await mutable.webSocketServer.close();
  }
}

function makePrioritizedOutputs(mutable: Mutable): Map<TargetName, number> {
  const map = new Map<TargetName, number>();
  for (const { outputPath, priority } of [
    ...mutable.webSocketConnections,
    ...mutable.outputRequests,
  ]) {
    if (outputPath.tag !== "OutputPathError") {
      const previous = map.get(outputPath.targetName) ?? 0;
      map.set(outputPath.targetName, Math.max(priority, previous));
    }
  }
  return map;
}

function findOutputForPath(
  project: Project,
  absolutePath: AbsolutePath,
): ReturnType<typeof getFlatOutputs>[number] | undefined {
  const realRequestedPath = realpathDirname(absolutePath);
  return getFlatOutputs(project).find(
    ({ outputPath }) =>
      outputPath.theOutputPath === absolutePath ||
      realpathDirname(outputPath.theOutputPath) === realRequestedPath,
  );
}

// The static files server follows symlinks, so a request might go to an output
// via a symlinked directory. The file itself might not exist yet, so only the
// directory is resolved.
function realpathDirname(absolutePath: AbsolutePath): string {
  try {
    return path.join(
      fs.realpathSync(path.dirname(absolutePath)),
      path.basename(absolutePath),
    );
  } catch {
    return absolutePath;
  }
}

function getWebSocketConnection(mutable: Mutable): WebSocketUrlConnection {
  return (
    mutable.project.webSocketUrl ?? {
      tag: "AutomaticUrl",
      port: mutable.webSocketServer.port,
    }
  );
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
        packages: getPackageStates(project),
        killInstallDependencies: true,
      },
    ],
  ];
}

// `matches` is either an exact match for an .elm file, or checks if a path is
// inside a directory.
function isElmFileRelatedToTargetsErrors(
  matches: (absolutePath: AbsolutePath) => boolean,
  targetsErrors: Project["targetsErrors"],
): boolean {
  const matchesInputPath = (inputPath: InputPath): boolean =>
    matches(inputPath.theInputPath) || matches(inputPath.realpath);
  return targetsErrors.some(({ error }) => {
    switch (error.tag) {
      case "DuplicateInputs":
        return error.duplicates.some(
          ({ inputs, resolved }) =>
            matches(resolved) || inputs.some(matchesInputPath),
        );

      // elm.json is watched separately.
      case "ElmJsonNotFound":
      case "ElmJsonTypeMismatch":
        return false;

      // The only way I’ve found to trigger this is by a symlink loop.
      case "InputsFailedToResolve":
        return error.inputsFailedToResolve.some(({ inputPath }) =>
          matches(inputPath.theUncheckedInputPath),
        );

      case "InputsNotFound":
        return error.inputsNotFound.some((inputPath) =>
          matches(inputPath.theUncheckedInputPath),
        );
    }
  });
}

// Including the elm.json files of targets with errors: The elm.json might be
// missing, or have the wrong "type".
function getAllElmJsonPaths(project: Project): Array<ElmJsonPath> {
  return [
    ...project.elmJsons.keys(),
    ...project.packages.keys(),
    ...project.targetsErrors.map(({ elmJsonPath }) => elmJsonPath),
  ];
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
    elmWatchVersion: Codec.field(Codec.string, { optional: true }),
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
      encoder: (value) => value.toString(),
    }),
  },
  { allowExtraFields: false },
);

type ParseWebSocketConnectRequestUrlResult =
  | ParseWebSocketConnectRequestUrlError
  | {
      tag: "ElmJsonError";
      error: ApplicationTargetErrorWithMetadata;
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
      enabledOutputs: Array<TargetLocation>;
      disabledOutputs: Array<TargetLocation>;
    }
  | {
      tag: "TargetNotFound";
      targetName: TargetName;
      enabledOutputs: Array<TargetLocation>;
      disabledOutputs: Array<TargetLocation>;
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

  if (
    webSocketConnectedParams.elmWatchVersion !== undefined &&
    webSocketConnectedParams.elmWatchVersion !== "%VERSION%"
  ) {
    return {
      tag: "WrongVersion",
      expectedVersion: "%VERSION%",
      actualVersion: webSocketConnectedParams.elmWatchVersion,
    };
  }

  const flatOutputs = getFlatOutputs(project);

  const { targetName } = webSocketConnectedParams;
  const matchElmJsonError = getApplicationTargetsErrors(project).find(
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
      ...project.targetsErrors.map(({ outputPath }) => outputPath),
      ...flatOutputs.map(({ outputPath }) => outputPath),
      ...Array.from(
        project.packages.values(),
        ([packageTarget]) => packageTarget,
      ),
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
  configSource: ConfigSource,
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
        configSource,
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
  const stringData =
    typeof data === "string"
      ? data
      : Array.isArray(data)
        ? Buffer.concat(data).toString("utf8")
        : data instanceof ArrayBuffer
          ? new TextDecoder("utf8").decode(data)
          : data.toString("utf8");

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
                browserUiPosition: outputState.browserUiPosition,
                openErrorOverlay: outputState.openErrorOverlay,
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
  date: Date,
  model: Model,
  outputPath: OutputPath,
  outputState: OutputState,
): [Model, Array<Cmd>] {
  const withEvent = (newModel: Model): Model => ({
    ...newModel,
    latestEvents: [
      ...newModel.latestEvents,
      { tag: "OutputRequestedNeedingCompilation", date, outputPath },
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

function getOutputRequestResponse(
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

function onChangedCompilationModeOrBrowserUiPosition(
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

function getNextActionSleepMs(model: Model): number {
  return Math.max(
    0,
    ...model.latestEvents.map(getLatestEventSleepMs),
    ...(model.pendingWatcherEvents.length > 0 ? [WATCHER_EVENT_SLEEP_MS] : []),
  );
}

// On macOS, all `fs.watch` watchers share a single FSEvents stream, which libuv
// recreates on a separate thread every time a watcher is added or removed.
// Events happening before the new stream is up are lost. That usually takes
// less than a millisecond, but can take longer under heavy load. There is no
// way to know when the stream is up, so the test hook (which tests use to know
// when it is safe to make file changes) waits a little.
const WATCHER_READY_DELAY_MS = 100;

// Sleep for a little bit to avoid unnecessary recompilation when using “save
// all” in an editor, or when running `git switch some-branch` or `git restore
// .`. These operations results in many files being added/changed/deleted,
// usually with 0-1 ms between each event. This also lets atomic saves finish
// before we check if files exist.
const WATCHER_EVENT_SLEEP_MS = 10;

function getLatestEventSleepMs(event: LatestEvent): number {
  switch (event.tag) {
    case "WatcherEvent":
      return WATCHER_EVENT_SLEEP_MS;

    // Also sleep for a little bit when web sockets connect and disconnect.
    // That’s useful when there are burst connections because of multiple
    // scripts on the same page, or many tabs with elm-watch. This is slower
    // than file system events.
    case "OutputRequestedNeedingCompilation":
    case "WebSocketClosed":
    case "WebSocketConnectedNeedingCompilation":
    case "WebSocketConnectedNeedingNoAction":
    case "WebSocketConnectedWithErrors":
    case "WebSocketConnectionRejected":
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
    maxWidth: loggerConfig.columns,
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
  return printStats(loggerConfig, [
    printServerLinks(mutable.webSocketServer, host),
    `${dim("web socket connections:")} ${mutable.webSocketConnections.length}`,
  ]);
}

function printStats(
  loggerConfig: LoggerConfig,
  stats: NonEmptyArray<string>,
): string {
  return stats
    .map((part) =>
      Compile.printStatusLine({
        maxWidth: loggerConfig.columns,
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
    // `localhost` is easier to read, and the same thing in practice.
    const hostname = host === "127.0.0.1" ? "localhost" : host;
    return `${dim("server:")} ${protocol}://${hostname}:${port}`;
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

    case "OutputRequestedNeedingCompilation":
      return `HTTP request needing compilation of: ${event.outputPath.targetName}`;

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
  }
}

function compileFinishedMessage(
  loggerConfig: LoggerConfig,
  duration: number,
): string {
  return `Compilation finished in ${bold(
    printDurationMs(loggerConfig.mockedTimings ? 123 : duration).trim(),
  )}.`;
}

function printEventsMessage(
  events: Array<LatestEvent>,
  disabledOutputs: Array<TargetLocation>,
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

function openEditorWithCommand(
  env: Env,
  mutable: Mutable,
  cmd: Extract<Cmd, { tag: "OpenEditor" }>,
  command: string,
): void {
  const cwd = mutable.project.root;
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

function openEditorWithFunction(
  cmd: Extract<Cmd, { tag: "OpenEditor" }>,
  openEditor: OpenEditorFunction,
): void {
  const location = { file: cmd.file, line: cmd.line, column: cmd.column };
  new Promise((resolve) => {
    resolve(openEditor(location));
  }).catch((error: unknown) => {
    webSocketSend(cmd.webSocket, {
      tag: "OpenEditorFailed",
      error: {
        tag: "CommandFailed",
        message: Errors.openEditorFunctionFailed(
          location,
          unknownErrorToString(error),
        ),
      },
    });
  });
}

function printWebSocketConnectionRejectedReason(
  reason: WebSocketConnectionRejectedReason,
): string {
  switch (reason.tag) {
    case "BadUrl":
      return `wrong URL prefix – ${quote(reason.expectedStart)} != ${quote(reason.actualUrlString.slice(0, reason.expectedStart.length))}`;
    case "HostNotAllowed":
      return printRejectedHost("Host header", reason.rejectedHost);
    case "OriginNotAllowed":
      return printRejectedHost("origin", reason.rejectedHost);
    case "WrongToken":
      return "invalid security token";
  }
}

function printRejectedHost(what: string, rejectedHost: RejectedHost): string {
  switch (rejectedHost.tag) {
    case "NotAllowed":
      return `${what} not allowed – add ${quote(rejectedHost.hostname)} to allowedHosts (see ${ALLOWED_HOSTS_DOCS_LINK})`;
    case "Invalid":
      return `invalid ${what}: ${rejectedHost.value === undefined ? "(missing)" : quote(rejectedHost.value)}`;
  }
}
