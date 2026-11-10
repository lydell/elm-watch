import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as Codec from "tiny-decoders";
import type WebSocket from "ws";

import {
  encodeWebSocketToClientMessage,
  type WebSocketToClientMessage,
  type WebSocketToServerMessage,
} from "../client/WebSocketMessages.ts";
import * as Compile from "./Compile.ts";
import type {
  WebSocketConnection,
  WebSocketConnectionRejectedReason,
  DevServer,
  DevServerHolder,
  DevServerMsg,
} from "./DevServer.ts";
import { ElmWatchStuffJson, type Target } from "./ElmWatchStuffJson.ts";
import {
  __ELM_WATCH_EXIT_ON_ERROR,
  __ELM_WATCH_WEBSOCKET_EVENT_SLEEP_MS,
  type Env,
  WATCH_REPORT_DEPENDENCIES,
} from "./Env.ts";
import * as Errors from "./Errors.ts";
import type { ErrorTemplate } from "./Errors.ts";
import * as ErrorSelection from "./ErrorSelection.ts";
import * as ErrorView from "./ErrorView.ts";
import {
  bold,
  dim,
  printDurationMs,
  silentlyReadIntEnvValue,
  toError,
} from "./Helpers.ts";
import type { Host } from "./Host.ts";
import * as Inject from "./Inject.ts";
import {
  filterLatestEvents,
  getLatestEventSleepMs,
  type LatestEvent,
  makeWatcherEvent,
  printEventsMessage,
  printInfoLine,
  WATCHER_EVENT_SLEEP_MS,
  type WatcherEvent,
  type WebSocketRelatedEvent,
} from "./LatestEvent.ts";
import type { Logger, LoggerConfig } from "./Logger.ts";
import { isNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray.ts";
import { openEditor, printOpenEditorErrorForTerminal } from "./OpenEditor.ts";
import { absoluteDirname } from "./PathHelpers.ts";
import type { PortChoice } from "./Port.ts";
import {
  type ApplicationTargetErrorWithMetadata,
  getAllTargetStates,
  getApplicationTargetsErrors,
  getFlatOutputs,
  getPackageStates,
  type OutputError,
  type OutputState,
  type PackageState,
  type Project,
} from "./Project.ts";
import { waitForRunningCommands } from "./Spawn.ts";
import { runTeaProgram } from "./TeaProgram.ts";
import * as Theme from "./Theme.ts";
import {
  type AbsolutePath,
  type CompilationMode,
  type CreateServer,
  type ElmJsonPath,
  type ElmWatchJsonPath,
  type GetNow,
  markAsAbsolutePath,
  type OutputPath,
  type TargetName,
  type WebSocketToken,
} from "./Types.ts";
import * as Watcher from "./Watcher.ts";
import {
  classifyWatcherEvent,
  type WatcherEventEffect,
} from "./WatcherEvents.ts";
import { makeWatcherProbe, type WatcherProbe } from "./WatcherProbe.ts";
import {
  getConnectionOutputPath,
  makePrioritizedOutputs,
  type OutputPathError,
  type ParseWebSocketConnectRequestUrlResult,
  parseWebSocketConnectRequestUrl,
  parseWebSocketToServerMessage,
  webSocketConnectRequestUrlErrorToString,
} from "./WebSocketConnect.ts";
import type { WebSocketConnection as WebSocketUrlConnection } from "./WebSocketUrl.ts";

type Mutable = {
  watcher: Watcher.Watcher;
  devServer: DevServer;
  project: Project;
  lastInfoMessage: string | undefined;
  // The one-line version of the info message (TTY only), for the error view.
  lastInfoLine: string | undefined;
  errorView: ErrorView.ErrorViewState;
  watcherTimeoutId: NodeJS.Timeout | undefined;
  watcherProbe: WatcherProbe | undefined;
  elmWatchStuffJsonWriteError: Error | undefined;
  killInstallDependencies: ((options: { force: boolean }) => void) | undefined;
  unsubscribeFromGracefulExit: () => void;
};

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

// Exported for tests.
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

// Exported for tests.
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
      webSocketToken: WebSocketToken;
      errorViewState: ErrorView.ErrorViewState;
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
  // they are up and running (see `WatcherProbe`). Changes made before that
  // might be missed, and are ignored.
  onWatcherReadyChange?: (isReady: boolean) => void;
  // Set while running (like `kill`). Resolves once elm-watch has received the
  // events for all file changes made before the call (see `WatcherProbe`).
  flushWatcher?: () => Promise<void>;
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
  devServerHolder: DevServerHolder,
  webSocketToken: WebSocketToken,
  // Keep the error view selection (and show all toggle) across restarts.
  errorViewState: ErrorView.ErrorViewState | undefined,
  project: Project,
  portChoice: PortChoice,
  signal: AbortSignal | undefined,
  hotTestHooks: HotTestHooks,
): Promise<HotRunResult> {
  const exitOnError = __ELM_WATCH_EXIT_ON_ERROR in env;
  const webSocketEventSleepMs = silentlyReadIntEnvValue(
    env[__ELM_WATCH_WEBSOCKET_EVENT_SLEEP_MS],
    100,
  );

  const result = await runTeaProgram<Mutable, Msg, Model, Cmd, HotRunResult>({
    initMutable: initMutable(
      logger,
      getNow,
      createServer,
      devServerHolder,
      webSocketToken,
      errorViewState,
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
              sleepMs: getNextActionSleepMs(newModel, webSocketEventSleepMs),
              watcherPaths: newModel.pendingWatcherEvents,
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
    runCmd: runCmd(
      env,
      logger,
      getNow,
      exitOnError,
      devServerHolder,
      webSocketToken,
    ),
  });

  hotTestHooks.kill = undefined;

  if (
    result.tag === "ExitOnIdle" &&
    result.reason === "CtrlCPressed" &&
    env[WATCH_REPORT_DEPENDENCIES] === "1"
  ) {
    // Let `node --watch` know about the ctrl+c. See `WATCH_REPORT_DEPENDENCIES`.
    // It forwards SIGINT to us, but by now we are about to exit anyway.
    try {
      process.kill(process.ppid, "SIGINT");
    } catch {
      // Not much to do. You’ll have to press ctrl+c again.
    }
  }

  return result;
}

export async function watchElmWatchJsonOnce(
  elmWatchJsonPath: ElmWatchJsonPath,
  hotTestHooks: HotTestHooks,
  onReady: () => void,
): Promise<WatcherEvent> {
  return new Promise((resolve, reject) => {
    // Watch the directory rather than the file itself, since editors might
    // replace the file (giving it a new inode) when saving.
    const dir = markAsAbsolutePath(path.dirname(elmWatchJsonPath));
    const basename = path.basename(elmWatchJsonPath);
    const watcherProbe =
      hotTestHooks.onWatcherReadyChange === undefined
        ? undefined
        : makeWatcherProbe([{ tag: "Shallow", dir }], onReady);
    const watcher = fs.watch(dir, (_, filename) => {
      const absolutePath = markAsAbsolutePath(
        filename === null ? dir : path.join(dir, filename),
      );
      if (watcherProbe?.ignore(absolutePath) === true) {
        return;
      }
      if (filename === null || filename === basename) {
        watcherProbe?.stop();
        watcher.close();
        resolve({
          tag: "WatcherEvent",
          eventName: fs.existsSync(elmWatchJsonPath) ? "changed" : "removed",
          file: {
            tag: "AbsolutePath",
            absolutePath: elmWatchJsonPath,
          },
        });
      }
    });
    watcher.on("error", (error) => {
      watcherProbe?.stop();
      watcher.close();
      reject(error);
    });
    if (watcherProbe === undefined) {
      onReady();
    } else {
      watcherProbe.start();
    }
  });
}

const initMutable =
  (
    logger: Logger,
    getNow: GetNow,
    createServer: CreateServer,
    devServerHolder: DevServerHolder,
    webSocketToken: WebSocketToken,
    errorViewState: ErrorView.ErrorViewState | undefined,
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
    const { onWatcherReadyChange } = hotTestHooks;
    onWatcherReadyChange?.(false);
    const watcherProbe =
      onWatcherReadyChange === undefined
        ? undefined
        : makeWatcherProbe(project.watchDirs, () => {
            onWatcherReadyChange(true);
          });
    const watcher = Watcher.watch(
      project.watchDirs,
      (absolutePath) => {
        if (watcherProbe?.ignore(absolutePath) === true) {
          return;
        }
        dispatch({
          tag: "GotWatcherEvent",
          date: getNow(),
          absolutePath,
        });
      },
      (error) => {
        closeAll(logger, mutable);
        resolvePromise({
          tag: "ExitOnHandledFatalError",
          errorTemplate: Errors.watcherError(error),
        });
      },
    );
    if (watcherProbe !== undefined) {
      watcherProbe.start();
      hotTestHooks.flushWatcher = watcherProbe.flush;
    }

    const { server: devServer, isNew: isNewDevServer } =
      devServerHolder.getOrCreate({
        createServer,
        getNow,
        portChoice,
        host: project.host,
        staticFilesDirectory: project.staticFilesDir,
        webSocketToken,
        allowedHosts: project.allowedHosts,
        configSource: project.configSource,
      });

    const mutable: Mutable = {
      watcher,
      devServer,
      project,
      lastInfoMessage: undefined,
      lastInfoLine: undefined,
      errorView: errorViewState ?? {
        showAll: false,
        expanded: false,
        selection: undefined,
      },
      watcherTimeoutId: undefined,
      watcherProbe,
      elmWatchStuffJsonWriteError: undefined,
      killInstallDependencies: undefined,
      unsubscribeFromGracefulExit: () => {
        // Replaced below.
      },
    };

    devServer.setDispatch((msg) => {
      onDevServerMsg(
        getNow(),
        logger,
        mutable,
        dispatch,
        resolvePromise,
        rejectPromise,
        msg,
      );
    });

    devServer.setResolveOutput(
      (absolutePath) =>
        findOutputForPath(mutable.project, absolutePath)?.outputPath.targetName,
    );

    // The port isn’t finalized until a few moments later (when the persisted
    // port is not available).
    devServer.listening
      .then(() => {
        writeElmWatchStuffJson(mutable, webSocketToken);
        // When not running as a TTY the output is a simple log, and it gets
        // a bit tedious if the stats are printed after each event. Instead,
        // we print it once at startup, and only the server links (connections
        // are always 0 at that time).
        // This has to be done once the server is ready – we don’t know the
        // final port number to print until then.
        if (!logger.config.isTTY && isNewDevServer) {
          logger.write(
            printServerLine(
              logger.config,
              mutable.devServer,
              mutable.project.host,
            ),
          );
        }
      })
      .catch(rejectPromise);

    const kill = (): void => {
      try {
        if (mutable.killInstallDependencies !== undefined) {
          mutable.killInstallDependencies({ force: true });
        }
        for (const targetState of getAllTargetStates(project)) {
          if ("kill" in targetState.status) {
            targetState.status.kill({ force: true });
          }
        }
        closeAll(logger, mutable);
      } catch (unknownError) {
        const error = toError(unknownError);
        rejectPromise(toError(error));
      }

      hotTestHooks.kill = undefined;
    };

    hotTestHooks.kill = () => {
      dispatch({ tag: "ExitRequested", date: getNow() });
      kill();
      resolvePromise({ tag: "ExitOnIdle", reason: "Other" });
      return Promise.resolve();
    };

    logger.setRawMode(
      () => {
        kill();
        resolvePromise({
          tag: "ExitOnIdle",
          reason: "CtrlCPressed",
        });
      },
      (data) => {
        const keys = ErrorView.parseKeys(data);
        if (isNonEmptyArray(keys)) {
          dispatch({ tag: "KeysPressed", date: getNow(), keys });
        }
      },
    );

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
      closeAll(logger, mutable);
      waitForRunningCommands()
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
          },
        ] as const,
    ),
    ...getFlatOutputs(mutable.project).map(
      ({ outputPath, outputState }) =>
        [
          outputPath.targetName,
          {
            compilationMode: outputState.compilationMode,
          },
        ] as const,
    ),
  ]);

  const json: ElmWatchStuffJson = {
    port: mutable.devServer.port,
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

// Exported for tests.
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

// Exported for tests.
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

const runCmd =
  (
    env: Env,
    logger: Logger,
    getNow: GetNow,
    exitOnError: boolean,
    devServerHolder: DevServerHolder,
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
      case "ChangeCompilationMode":
        cmd.outputState.compilationMode = cmd.compilationMode;
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
          prioritizedOutputs: getPrioritizedOutputs(mutable),
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
                  prioritizedOutputs: getPrioritizedOutputs(mutable),
                  handleOutputActionResult,
                });
              })
              .catch(rejectPromise);
          }
        } else if (outputActions.numExecuting === 0) {
          dispatch({
            tag: "CompilationPartDone",
            date: getNow(),
            prioritizedOutputs: getPrioritizedOutputs(mutable),
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
            // In a TTY, the info message starts right away (to be right below
            // the status lines), so we need an empty line.
            if (logger.config.isTTY) {
              logger.write("");
            }
            if (exitOnError) {
              // Exit once the rest of the commands (like logging the info
              // message) have run.
              queueMicrotask(() => {
                closeAll(logger, mutable);
                resolvePromise({ tag: "ExitOnIdle", reason: "Other" });
              });
            }
          }
        }
        return;

      case "InstallDependencies": {
        // If the dev server fails to boot, don’t even bother with anything else.
        mutable.devServer.listening
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

      case "LogInfoMessage": {
        const hasErrors = isNonEmptyArray(
          Compile.extractErrors(mutable.project),
        );
        const infoLine = printInfoLine({
          loggerConfig: logger.config,
          // In a TTY, the status lines and the error view already say that
          // there are errors, so use the information emoji to not repeat 🚨
          // over and over. In logs, 🚨 marks the end of the errors.
          emojiName: !hasErrors
            ? "Success"
            : logger.config.isTTY
              ? "Information"
              : "Error",
          date: getNow(),
          message: cmd.message,
          events: filterLatestEvents(cmd.events),
          project: mutable.project,
        });

        if (!logger.config.isTTY) {
          logger.write(`\n${infoLine}`);
          return;
        }

        mutable.lastInfoLine = infoLine;

        if (errorViewIsActive(logger, exitOnError, mutable.project)) {
          renderErrorView(
            logger,
            mutable,
            getErrorViewTargets(mutable.project),
            { notice: undefined },
          );
          return;
        }

        const fullMessage = [
          printServerLine(
            logger.config,
            mutable.devServer,
            mutable.project.host,
          ),
          "",
          infoLine,
        ].join("\n");
        logger.withSynchronizedOutput(() => {
          if (mutable.lastInfoMessage !== undefined) {
            logger.clearLastLines(mutable.lastInfoMessage.split("\n").length);
          }
          logger.writeWithoutTrailingNewline(fullMessage);
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
          webSocketSendToOutput(mutable, outputPath, {
            tag: "StatusChanged",
            status: {
              tag: "Busy",
              compilationMode: outputState.compilationMode,
            },
          });
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

      case "OpenEditor":
        openEditor(env, mutable.project, cmd, (error) => {
          webSocketSend(cmd.webSocket, { tag: "OpenEditorFailed", error });
        });
        return;

      case "HandleKeys": {
        if (!errorViewIsActive(logger, exitOnError, mutable.project)) {
          return;
        }
        const { errorView } = mutable;
        const targets = getErrorViewTargets(mutable.project);
        let selection = ErrorSelection.reconcile(
          errorView.selection,
          targets,
          getPrioritizedOutputs(mutable),
        );
        for (const key of cmd.keys) {
          switch (key) {
            case "ToggleShowAll":
              errorView.showAll = !errorView.showAll;
              break;

            case "ToggleExpanded":
              if (!errorView.showAll) {
                errorView.expanded = !errorView.expanded;
              }
              break;

            case "OpenEditor": {
              if (errorView.showAll || selection === undefined) {
                break;
              }
              const location = ErrorSelection.getOpenEditorLocation(
                ErrorSelection.getSelectedError(selection, targets)?.location,
              );
              if (location !== undefined) {
                openEditor(env, mutable.project, location, (error) => {
                  dispatch({
                    tag: "OpenEditorFromTerminalFailed",
                    date: getNow(),
                    message: printOpenEditorErrorForTerminal(error),
                  });
                });
              }
              break;
            }

            default:
              if (!errorView.showAll && selection !== undefined) {
                selection = ErrorSelection.navigate(selection, targets, key);
              }
          }
        }
        errorView.selection = selection;
        renderErrorView(logger, mutable, targets, { notice: undefined });
        return;
      }

      case "RenderErrorView":
        if (errorViewIsActive(logger, exitOnError, mutable.project)) {
          renderErrorView(
            logger,
            mutable,
            getErrorViewTargets(mutable.project),
            { notice: cmd.notice },
          );
        }
        return;

      case "PrintCompileErrors":
        // The error view is rendered together with the info message, which is
        // logged right after this.
        if (!errorViewIsActive(logger, exitOnError, mutable.project)) {
          logger.withSynchronizedOutput(() => {
            Compile.printErrors(logger, cmd.errors);
            // See `HandleElmWatchStuffJsonWriteError`.
            if (logger.config.isTTY) {
              logger.write("");
            }
          });
        }
        return;

      case "RespondToOutputRequests": {
        const flatOutputs = getFlatOutputs(mutable.project);
        // Copy, since responding removes the request from the set.
        for (const outputRequest of Array.from(
          mutable.devServer.getOutputRequests(),
        )) {
          const output = flatOutputs.find(
            ({ outputPath }) =>
              outputPath.targetName === outputRequest.targetName,
          );
          if (output === undefined) {
            outputRequest.serveFile();
            continue;
          }
          const response = getOutputRequestResponse(output.outputState);
          const respondAnyway =
            cmd.waiting === "RespondToAll" ||
            (cmd.waiting === "RespondIfNotDirty" && !output.outputState.dirty);
          switch (
            response === "Wait" && respondAnyway ? "ServeProxy" : response
          ) {
            case "ServeFile":
              outputRequest.serveFile();
              break;

            // The proxy file connects to the web socket server, which shows
            // errors, or compiles and reloads the page.
            case "ServeProxy":
              outputRequest.serveJavaScript(
                Inject.proxyFile(
                  output.outputPath,
                  getNow().getTime(),
                  getWebSocketConnection(mutable),
                  webSocketToken,
                  logger.config.debug,
                ),
              );
              break;

            case "Wait":
              break;
          }
        }
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
        closeAll(logger, mutable);
        // Connected browsers reconnect when the server is closed, which makes
        // them get the status of their target in the new elm-watch.json.
        // Otherwise, the server (including waiting output requests) is kept
        // for the next run.
        (elmWatchJsonChanged ? devServerHolder.close() : Promise.resolve())
          .then(() => {
            resolvePromise({
              tag: "Restart",
              restartReasons: cmd.restartReasons,
              webSocketToken,
              errorViewState: mutable.errorView,
            });
          })
          .catch(rejectPromise);
        return;
      }

      case "ExitOnIdle":
        closeAll(logger, mutable);
        resolvePromise({ tag: "ExitOnIdle", reason: "Other" });
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
        for (const { webSocket } of mutable.devServer.getConnections()) {
          webSocketSend(webSocket, cmd.message);
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
                errors: cmd.errors.map((errorTemplate) =>
                  Errors.toHtml(errorTemplate, theme, logger.config.noColor),
                ),
                foregroundColor: theme.foreground,
                backgroundColor: theme.background,
              },
            };
            webSocketSendToOutput(mutable, cmd.outputPath, message);
          })
          .catch(rejectPromise);
        return;

      case "WebSocketSendToOutput":
        webSocketSendToOutput(mutable, cmd.outputPath, cmd.message);
        return;

      case "WebSocketUpdatePriority":
        cmd.connection.priority = getNow().getTime();
        return;
    }
  };

function onDevServerMsg(
  now: Date,
  logger: Logger,
  mutable: Mutable,
  dispatch: (msg: Msg) => void,
  resolvePromise: (result: HotRunResult) => void,
  rejectPromise: (error: Error) => void,
  msg: DevServerMsg,
): void {
  switch (msg.tag) {
    case "OutputRequested": {
      const { outputRequest } = msg;
      // Requests made while restarting are queued. The browser might have
      // given up on the request since then.
      if (!mutable.devServer.getOutputRequests().has(outputRequest)) {
        return;
      }
      const output = getFlatOutputs(mutable.project).find(
        ({ outputPath }) => outputPath.targetName === outputRequest.targetName,
      );
      if (output === undefined) {
        outputRequest.serveFile();
        return;
      }
      dispatch({
        tag: "OutputRequested",
        date: now,
        outputPath: output.outputPath,
        outputState: output.outputState,
      });
      return;
    }

    case "WebSocketConnected":
      dispatch({
        tag: "WebSocketConnected",
        date: now,
        parseWebSocketConnectRequestUrlResult: parseWebSocketConnectRequestUrl(
          mutable.project,
          msg.connection.urlParams,
        ),
        webSocket: msg.connection.webSocket,
      });
      return;

    case "WebSocketConnectionRejected":
      dispatch({
        tag: "WebSocketConnectionRejected",
        date: now,
        origin: msg.origin,
        reason: msg.reason,
      });
      return;

    case "WebSocketMessageReceived": {
      const result = parseWebSocketConnectRequestUrl(
        mutable.project,
        msg.connection.urlParams,
      );
      dispatch({
        tag: "WebSocketMessageReceived",
        date: now,
        output:
          result.tag === "Success"
            ? {
                tag: "Output",
                elmJsonPath: result.elmJsonPath,
                outputPath: result.outputPath,
                outputState: result.outputState,
              }
            : { tag: "OutputPathError" },
        connection: msg.connection,
        data: msg.data,
      });
      return;
    }

    case "DevServerError":
      switch (msg.error.tag) {
        case "PortConflict": {
          const { portChoice } = msg.error;
          closeAll(logger, mutable);
          resolvePromise({
            tag: "ExitOnHandledFatalError",
            errorTemplate: portChoiceError(
              mutable.project,
              portChoice,
              msg.error.error,
            ),
          });
          return;
        }

        case "HostNotFound": {
          const { host } = msg.error;
          closeAll(logger, mutable);
          resolvePromise({
            tag: "ExitOnHandledFatalError",
            errorTemplate: Errors.hostNotFound(
              mutable.project.configSource,
              host,
              msg.error.error,
            ),
          });
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

// The dev server is closed by the caller of `run`, since it is kept
// between restarts.
function closeAll(logger: Logger, mutable: Mutable): void {
  logger.reset();
  mutable.unsubscribeFromGracefulExit();

  if (mutable.watcherTimeoutId !== undefined) {
    clearTimeout(mutable.watcherTimeoutId);
  }
  mutable.watcherProbe?.stop();

  mutable.devServer.unsetDispatch();
  mutable.watcher.close();
}

function getPrioritizedOutputs(mutable: Mutable): Map<TargetName, number> {
  return makePrioritizedOutputs(
    mutable.project,
    mutable.devServer.getConnections(),
    mutable.devServer.getOutputRequests(),
  );
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
      port: mutable.devServer.port,
    }
  );
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

function webSocketSend(
  webSocket: WebSocket,
  message: WebSocketToClientMessage,
): void {
  webSocket.send(encodeWebSocketToClientMessage(message));
}

function webSocketSendToOutput(
  mutable: Mutable,
  outputPath: OutputPath,
  message: WebSocketToClientMessage,
): void {
  for (const connection of mutable.devServer.getConnections()) {
    const connectionOutputPath = getConnectionOutputPath(
      mutable.project,
      connection,
    );
    if (
      connectionOutputPath.tag === "OutputPath" &&
      connectionOutputPath.theOutputPath === outputPath.theOutputPath
    ) {
      webSocketSend(connection.webSocket, message);
    }
  }
}

function getNextActionSleepMs(
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

function printServerLine(
  loggerConfig: LoggerConfig,
  devServer: DevServer,
  host: Host,
): string {
  return Compile.printStatusLine({
    maxWidth: loggerConfig.columns,
    fancy: loggerConfig.fancy,
    isTTY: loggerConfig.isTTY,
    emojiName: "Server",
    string: printServerLinks(devServer, host),
  });
}

function printServerLinks(devServer: DevServer, host: Host): string {
  const protocol = devServer.isHTTPS ? "https" : "http";
  const { port } = devServer;

  if (host !== "0.0.0.0") {
    // `localhost` is easier to read, and the same thing in practice.
    const hostname = host === "127.0.0.1" ? "localhost" : host;
    return `${protocol}://${hostname}:${port}`;
  }

  const networkIps = Object.values(os.networkInterfaces())
    .flatMap((addresses = []) =>
      addresses.filter(
        (address) => address.family === "IPv4" && !address.internal,
      ),
    )
    .map(({ address }) => address);

  return `${protocol}://localhost:${port}${networkIps
    .map((ip) => `   ${dim("network:")} ${protocol}://${ip}:${port}`)
    .join("")}`;
}

function compileFinishedMessage(
  loggerConfig: LoggerConfig,
  duration: number,
): string {
  return `Compiled in ${bold(
    printDurationMs(loggerConfig.mockedTimings ? 123 : duration).trim(),
  )}`;
}

// Errors are shown one at a time, navigated with the keyboard, when we can read
// keypresses. Otherwise (and when exiting on the first error), all errors are
// printed.
function errorViewIsActive(
  logger: Logger,
  exitOnError: boolean,
  project: Project,
): boolean {
  return (
    logger.isRawMode() &&
    !exitOnError &&
    isNonEmptyArray(Compile.extractErrors(project))
  );
}

// In the same order as the status lines.
function getErrorViewTargets(
  project: Project,
): Array<ErrorView.ErrorViewTarget> {
  return [
    ...project.targetsErrors.map((targetError) =>
      ErrorView.makeErrorViewTarget(targetError.outputPath.targetName, [
        Compile.renderTargetError(targetError),
      ]),
    ),
    ...Array.from(project.elmJsons).flatMap(([elmJsonPath, outputs]) =>
      Array.from(outputs, ([outputPath, { status }]) =>
        ErrorView.makeErrorViewTarget(
          outputPath.targetName,
          Compile.renderOutputErrors(elmJsonPath, outputPath, status, true),
        ),
      ),
    ),
    ...Array.from(
      project.packages,
      ([elmJsonPath, [packageTarget, { status }]]) =>
        ErrorView.makeErrorViewTarget(
          packageTarget.targetName,
          Compile.renderOutputErrors(elmJsonPath, packageTarget, status, true),
        ),
    ),
  ];
}

// Redraw the whole screen: Status lines, server line, the selected error (or
// all errors), the info line and keys to press. Only the error area changes
// when switching between one error at a time and showing all errors.
function renderErrorView(
  logger: Logger,
  mutable: Mutable,
  targets: Array<ErrorView.ErrorViewTarget>,
  { notice }: { notice: string | undefined },
): void {
  const { errorView } = mutable;
  errorView.selection = ErrorSelection.reconcile(
    errorView.selection,
    targets,
    getPrioritizedOutputs(mutable),
  );
  const { selection } = errorView;
  const highlightSelected =
    !errorView.showAll &&
    selection !== undefined &&
    ErrorSelection.canSwitchTarget(selection, targets);

  logger.withSynchronizedOutput(() => {
    logger.clearScreen();

    Compile.printAllStatusLines(logger, mutable.project, (targetName) => ({
      numErrors:
        targets.find((target) => target.targetName === targetName)?.numErrors ??
        0,
      selected: highlightSelected && selection.targetName === targetName,
    }));
    logger.write(
      printServerLine(logger.config, mutable.devServer, mutable.project.host),
    );
    logger.write("");

    logger.writeWithoutTrailingNewline(
      errorView.showAll || selection === undefined
        ? ErrorView.renderShowAll({
            loggerConfig: logger.config,
            errorStrings: Compile.errorsToTerminalStrings(
              logger.config,
              Compile.extractErrors(mutable.project),
            ),
            infoLine: mutable.lastInfoLine,
          })
        : ErrorView.render({
            loggerConfig: logger.config,
            expanded: errorView.expanded,
            selection,
            targets,
            notice,
            infoLine: mutable.lastInfoLine,
          }),
    );

    // For the `run-pty` tool: Let it know that it’s safe to render the
    // keyboard shortcuts below the cursor text again.
    logger.clearScreenDown();
  });

  // The info message is part of the error view, and can’t be updated on its
  // own.
  mutable.lastInfoMessage = undefined;
}
