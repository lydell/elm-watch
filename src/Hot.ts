import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as Codec from "tiny-decoders";
import type WebSocket from "ws";

import {
  encodeWebSocketToClientMessage,
  type WebSocketToClientMessage,
} from "../client/WebSocketMessages.ts";
import * as Compile from "./Compile.ts";
import type { DevServer, DevServerHolder, DevServerMsg } from "./DevServer.ts";
import { ElmWatchStuffJson, type Target } from "./ElmWatchStuffJson.ts";
import {
  __ELM_WATCH_EXIT_ON_ERROR,
  __ELM_WATCH_WEBSOCKET_EVENT_SLEEP_MS,
  type Env,
  WATCH_REPORT_DEPENDENCIES,
} from "./Env.ts";
import * as Errors from "./Errors.ts";
import * as ErrorSelection from "./ErrorSelection.ts";
import * as ErrorView from "./ErrorView.ts";
import * as ExternalErrors from "./ExternalErrors.ts";
import { dim, silentlyReadIntEnvValue, toError } from "./Helpers.ts";
import type { Host } from "./Host.ts";
import {
  type Cmd,
  getNextActionSleepMs,
  getOutputRequestResponse,
  init,
  type Model,
  type Msg,
  update,
} from "./HotUpdate.ts";
import * as Inject from "./Inject.ts";
import {
  filterLatestEvents,
  type LatestEvent,
  printInfoLine,
  type WatcherEvent,
} from "./LatestEvent.ts";
import { isNonEmptyArray } from "./NonEmptyArray.ts";
import { openEditor, printOpenEditorErrorForTerminal } from "./OpenEditor.ts";
import { absoluteDirname } from "./PathHelpers.ts";
import type { PortChoice } from "./Port.ts";
import {
  getAllTargetStates,
  getApplicationTargetsErrors,
  getFlatOutputs,
  type Project,
} from "./Project.ts";
import { waitForRunningCommands } from "./Spawn.ts";
import { runTeaProgram } from "./TeaProgram.ts";
import type { Terminal, TerminalConfig } from "./Terminal.ts";
import * as Theme from "./Theme.ts";
import {
  type AbsolutePath,
  type CreateServer,
  type ElmWatchJsonPath,
  type GetNow,
  markAsAbsolutePath,
  type OutputPath,
  type TargetName,
  type WebSocketToken,
} from "./Types.ts";
import * as Watcher from "./Watcher.ts";
import { makeWatcherProbe, type WatcherProbe } from "./WatcherProbe.ts";
import {
  getConnectionOutputPath,
  makePrioritizedOutputs,
  parseWebSocketConnectRequestUrl,
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
  unsubscribeFromExternalErrors: () => void;
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
  terminal: Terminal,
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
      terminal,
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
    init: init(
      getNow(),
      restartReasons,
      getApplicationTargetsErrors(project),
      project.errorReporter !== undefined,
    ),
    update: (msg: Msg, model: Model): [Model, Array<Cmd>] => {
      const [newModel, cmds] = update(
        terminal.config,
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
      terminal.debug(msg.tag, msg, newModel, allCmds);
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
      terminal,
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
    terminal: Terminal,
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
        closeAll(terminal, mutable);
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
      unsubscribeFromExternalErrors:
        project.errorReporter === undefined
          ? () => {
              // Nothing to unsubscribe from.
            }
          : ExternalErrors.subscribe(
              project.errorReporter,
              (source, numErrors) => {
                dispatch({
                  tag: "ExternalErrorsChanged",
                  date: getNow(),
                  source,
                  numErrors,
                });
              },
            ),
    };

    devServer.setDispatch((msg) => {
      onDevServerMsg(
        getNow(),
        terminal,
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
        if (!terminal.config.isTTY && isNewDevServer) {
          terminal.write(
            printServerLine(
              terminal.config,
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
        closeAll(terminal, mutable);
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

    terminal.setRawMode(
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
      closeAll(terminal, mutable);
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

const runCmd =
  (
    env: Env,
    terminal: Terminal,
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
        terminal.clearScreen();
        mutable.lastInfoMessage = undefined;
        return;

      case "CompileAllOutputsAsNeeded": {
        const outputActions = Compile.getOutputActions({
          project: mutable.project,
          runMode: "hot",
          includeInterrupted: cmd.includeInterrupted,
          prioritizedOutputs: getPrioritizedOutputs(mutable),
        });

        // Errors from outside elm-watch are only updated here, together with
        // printing the status lines (see `Project.externalErrors`).
        if (cmd.mode !== "ContinueCompilation") {
          const previousVersion = mutable.project.externalErrors.version;
          mutable.project.externalErrors = ExternalErrors.getSnapshot(
            mutable.project.errorReporter,
          );
          if (mutable.project.externalErrors.version !== previousVersion) {
            sendExternalErrors(terminal, mutable, undefined, rejectPromise);
          }
        }

        switch (cmd.mode) {
          case "AfterInstallDependencies":
            terminal.withSynchronizedOutput(() => {
              Compile.printStatusLinesForTargetsErrors(
                terminal,
                mutable.project,
              );
              Compile.printSpaceForOutputs(terminal, "hot", outputActions);
            });
            break;

          case "AfterIdle":
            terminal.withSynchronizedOutput(() => {
              terminal.clearScreen();
              mutable.lastInfoMessage = undefined;
              Compile.printStatusLinesForTargetsErrors(
                terminal,
                mutable.project,
              );
              Compile.printSpaceForOutputs(terminal, "hot", outputActions);
            });
            break;

          case "ContinueCompilation":
            break;
        }

        if (isNonEmptyArray(outputActions.actions)) {
          for (const action of outputActions.actions) {
            Compile.handleOutputAction({
              env,
              terminal,
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
            terminal.write("");
            terminal.errorTemplate(
              Errors.elmWatchStuffJsonWriteError(
                mutable.project.elmWatchStuffJsonPath,
                mutable.elmWatchStuffJsonWriteError,
              ),
            );
            // In a TTY, the info message starts right away (to be right below
            // the status lines), so we need an empty line.
            if (terminal.config.isTTY) {
              terminal.write("");
            }
            dispatch({ tag: "ElmWatchStuffJsonWriteFailed", date: getNow() });
          }
        }
        return;

      case "InstallDependencies": {
        // If the dev server fails to boot, don’t even bother with anything else.
        mutable.devServer.listening
          .then(() => {
            const { promise, kill } = Compile.installDependencies(
              env,
              terminal,
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
          terminalConfig: terminal.config,
          // In a TTY, the status lines and the error view already say that
          // there are errors, so use the information emoji to not repeat 🚨
          // over and over. In logs, 🚨 marks the end of the errors.
          emojiName: !hasErrors
            ? "Success"
            : terminal.config.isTTY
              ? "Information"
              : "Error",
          date: getNow(),
          message: cmd.message,
          events: filterLatestEvents(cmd.events),
          project: mutable.project,
        });

        if (!terminal.config.isTTY) {
          terminal.write(`\n${infoLine}`);
          return;
        }

        mutable.lastInfoLine = infoLine;

        if (errorViewIsActive(terminal, exitOnError, mutable.project)) {
          renderErrorView(
            terminal,
            mutable,
            getErrorViewTargets(mutable.project),
            { notice: undefined },
          );
          return;
        }

        const fullMessage = [
          printServerLine(
            terminal.config,
            mutable.devServer,
            mutable.project.host,
          ),
          "",
          infoLine,
        ].join("\n");
        terminal.withSynchronizedOutput(() => {
          if (mutable.lastInfoMessage !== undefined) {
            terminal.clearLastLines(mutable.lastInfoMessage.split("\n").length);
          }
          terminal.writeWithoutTrailingNewline(fullMessage);
          // For the `run-pty` tool: Let it know that it’s safe to render the
          // keyboard shortcuts below the cursor text again.
          terminal.clearScreenDown();
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
        if (!errorViewIsActive(terminal, exitOnError, mutable.project)) {
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
        renderErrorView(terminal, mutable, targets, { notice: undefined });
        return;
      }

      case "RenderErrorView":
        if (errorViewIsActive(terminal, exitOnError, mutable.project)) {
          renderErrorView(
            terminal,
            mutable,
            getErrorViewTargets(mutable.project),
            { notice: cmd.notice },
          );
        }
        return;

      case "PrintCompileErrors":
        // The error view is rendered together with the info message, which is
        // logged right after this.
        if (!errorViewIsActive(terminal, exitOnError, mutable.project)) {
          terminal.withSynchronizedOutput(() => {
            Compile.printErrors(terminal, cmd.errors);
            // See `HandleElmWatchStuffJsonWriteError`.
            if (terminal.config.isTTY) {
              terminal.write("");
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
                  terminal.config.debug,
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
        closeAll(terminal, mutable);
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
        closeAll(terminal, mutable);
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

      case "WebSocketSendCompileErrorToOutput": {
        const message = Theme.getThemeFromTerminal(terminal).then(
          (theme): WebSocketToClientMessage => ({
            tag: "StatusChanged",
            status: {
              tag: "CompileError",
              compilationMode: cmd.compilationMode,
              errors: cmd.errors.map((errorTemplate) =>
                Errors.toHtml(errorTemplate, theme, terminal.config.noColor),
              ),
              foregroundColor: theme.foreground,
              backgroundColor: theme.background,
            },
          }),
        );
        message.catch(rejectPromise);
        webSocketSendToOutput(mutable, cmd.outputPath, message);
        return;
      }

      case "WebSocketSendExternalErrors":
        sendExternalErrors(terminal, mutable, cmd.webSocket, rejectPromise);
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
  terminal: Terminal,
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
          closeAll(terminal, mutable);
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
          closeAll(terminal, mutable);
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

// The dev server is closed by the caller of `run`, since it is kept
// between restarts.
function closeAll(terminal: Terminal, mutable: Mutable): void {
  terminal.reset();
  mutable.unsubscribeFromGracefulExit();
  mutable.unsubscribeFromExternalErrors();

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

// Messages with errors need the terminal’s colors first, which is async. Later
// messages to the same web socket wait for them, so that messages arrive in
// the order they were created. For example, when a browser connects, it gets
// the external errors before its status. Otherwise, it would briefly show ✅.
const pendingSends = new WeakMap<WebSocket, Promise<void>>();

function webSocketSend(
  webSocket: WebSocket,
  message: WebSocketToClientMessage | Promise<WebSocketToClientMessage>,
): void {
  const pending = pendingSends.get(webSocket);
  if (pending === undefined && !(message instanceof Promise)) {
    webSocketSendNow(webSocket, message);
    return;
  }
  const next = (pending ?? Promise.resolve())
    .then(() => message)
    .then(
      (resolvedMessage) => {
        webSocketSendNow(webSocket, resolvedMessage);
      },
      () => {
        // The error is handled by whoever created the message.
      },
    )
    .finally(() => {
      if (pendingSends.get(webSocket) === next) {
        pendingSends.delete(webSocket);
      }
    });
  pendingSends.set(webSocket, next);
}

function webSocketSendNow(
  webSocket: WebSocket,
  message: WebSocketToClientMessage,
): void {
  webSocket.send(encodeWebSocketToClientMessage(message), {
    // Browsers receive large binary messages faster than large text messages.
    // For 14 MB of JS: Chromium ~45 ms instead of ~135 ms, WebKit ~40 ms
    // instead of ~70 ms (Firefox is ~10 ms slower). Small messages stay text,
    // which is easier to read in the browser devtools.
    binary: message.tag === "SuccessfullyCompiled",
  });
}

function sendExternalErrors(
  terminal: Terminal,
  mutable: Mutable,
  // `undefined` means all connections.
  webSocket: WebSocket | undefined,
  rejectPromise: (error: Error) => void,
): void {
  const sources = Compile.renderExternalErrors(mutable.project);
  const toMessage = (theme: Theme.Theme): WebSocketToClientMessage => ({
    tag: "ExternalErrors",
    sources: sources.map(([source, errors]) => ({
      source,
      errors: errors.map((errorTemplate) =>
        Errors.toHtml(errorTemplate, theme, terminal.config.noColor),
      ),
    })),
    foregroundColor: theme.foreground,
    backgroundColor: theme.background,
  });
  // Without errors, the colors don’t matter, so don’t make other messages wait.
  let message: WebSocketToClientMessage | Promise<WebSocketToClientMessage>;
  if (isNonEmptyArray(sources)) {
    const promise = Theme.getThemeFromTerminal(terminal).then(toMessage);
    promise.catch(rejectPromise);
    message = promise;
  } else {
    message = toMessage(Theme.DEFAULT_THEME);
  }
  if (webSocket === undefined) {
    for (const connection of mutable.devServer.getConnections()) {
      webSocketSend(connection.webSocket, message);
    }
  } else {
    webSocketSend(webSocket, message);
  }
}

function webSocketSendToOutput(
  mutable: Mutable,
  outputPath: OutputPath,
  message: WebSocketToClientMessage | Promise<WebSocketToClientMessage>,
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

function printServerLine(
  terminalConfig: TerminalConfig,
  devServer: DevServer,
  host: Host,
): string {
  return Compile.printStatusLine({
    maxWidth: terminalConfig.columns,
    fancy: terminalConfig.fancy,
    isTTY: terminalConfig.isTTY,
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

// Errors are shown one at a time, navigated with the keyboard, when we can read
// keypresses. Otherwise (and when exiting on the first error), all errors are
// printed.
function errorViewIsActive(
  terminal: Terminal,
  exitOnError: boolean,
  project: Project,
): boolean {
  return (
    terminal.isRawMode() &&
    !exitOnError &&
    isNonEmptyArray(Compile.extractErrors(project))
  );
}

// In the same order as the status lines.
function getErrorViewTargets(
  project: Project,
): Array<ErrorView.ErrorViewTarget> {
  return [
    ...Compile.renderExternalErrors(project).map(([source, errors]) =>
      ErrorView.makeErrorViewTarget(source, errors),
    ),
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
  terminal: Terminal,
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

  terminal.withSynchronizedOutput(() => {
    terminal.clearScreen();

    Compile.printAllStatusLines(terminal, mutable.project, (targetName) => ({
      numErrors:
        targets.find((target) => target.targetName === targetName)?.numErrors ??
        0,
      selected: highlightSelected && selection.targetName === targetName,
    }));
    terminal.write(
      printServerLine(terminal.config, mutable.devServer, mutable.project.host),
    );
    terminal.write("");

    terminal.writeWithoutTrailingNewline(
      errorView.showAll || selection === undefined
        ? ErrorView.renderShowAll({
            terminalConfig: terminal.config,
            errorStrings: Compile.errorsToTerminalStrings(
              terminal.config,
              Compile.extractErrors(mutable.project),
            ),
            infoLine: mutable.lastInfoLine,
          })
        : ErrorView.render({
            terminalConfig: terminal.config,
            expanded: errorView.expanded,
            selection,
            targets,
            notice,
            infoLine: mutable.lastInfoLine,
          }),
    );

    // For the `run-pty` tool: Let it know that it’s safe to render the
    // keyboard shortcuts below the cursor text again.
    terminal.clearScreenDown();
  });

  // The info message is part of the error view, and can’t be updated on its
  // own.
  mutable.lastInfoMessage = undefined;
}
