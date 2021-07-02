import * as chokidar from "chokidar";
import * as path from "path";
import * as readline from "readline";
import * as Decode from "tiny-decoders";
import { URLSearchParams } from "url";
import WebSocket from "ws";

import * as Compile from "./Compile";
import { ErrorTemplate } from "./Errors";
import { HashSet } from "./HashSet";
import { bold, dim, Env, formatTime, join } from "./Helpers";
import type { Logger } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { AbsolutePath } from "./PathHelpers";
import { PortChoice } from "./Port";
import { getToCompile, OutputState, Project } from "./Project";
import { runTeaProgram } from "./TeaProgram";
import {
  ElmJsonPath,
  ElmToolingJsonPath,
  equalsInputPath,
  GetNow,
  OnIdle,
  OutputPath,
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
};

type WebSocketConnection = {
  webSocket: WebSocket;
  outputPath: OutputPath | { tag: "OutputPathError" };
};

type Msg =
  | WebSocketServerMsg
  | {
      tag: "CompileOneOutputDone";
      date: Date;
      index: number;
      elmJsonPath: ElmJsonPath;
      outputPath: OutputPath;
      outputState: OutputState;
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
      tag: "ClearScreen";
    }
  | {
      tag: "CompileAllOutputs";
    }
  | {
      tag: "CompileOneOutput";
      index: number;
      elmJsonPath: ElmJsonPath;
      outputPath: OutputPath;
      outputState: OutputState;
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
      outputStates: Array<OutputState>;
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

    // TODO: Write elm-stuff/elm-watch.json
    // This and the above requires initMutable to be able to fail.
    // Unless we do this stuff earlier.
    // Writing elm-stuff/elm-watch.json can fail later anyway, when switching
    // mode for an output.
    // Failing to start the web socket server should probably fail the whole thing.
    // But what about write failure?
    // Either hard failure or show something about it.

    return {
      watcher,
      webSocketServer,
      webSocketConnections,
      project,
      lastInfoMessage: undefined,
      watcherTimeoutId: undefined,
    };
  };

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
  [{ tag: "InstallDependencies" }],
];

const WebSocketConnectedParams = Decode.fieldsAuto({
  elmWatchVersion: Decode.string,
  output: Decode.string,
  compiledTimestamp: Decode.number,
});

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

      case "CompileOneOutputDone":
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
            if (msg.outputState.dirty) {
              return model.hotState.keepConsumingDirty
                ? [
                    model,
                    [
                      {
                        tag: "CompileOneOutput",
                        index: msg.index,
                        elmJsonPath: msg.elmJsonPath,
                        outputPath: msg.outputPath,
                        outputState: msg.outputState,
                      },
                    ],
                  ]
                : [model, []];
            }

            const someOutputIsExecutingOrWasInterrupted = getToCompile(
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
            const someOutputIsExecuting = getToCompile(project).some(
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
                  model.hotState.start
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
        // parse url (output, version, timestamp)
        // update mutable
        // cause compilation if needed
        // respond
        const TODO_ERROR: [Model, Array<Cmd>] = [model, []];
        if (!msg.urlString.startsWith("/?")) {
          // Should probably not return like this.
          // Move parsing to a function and act upon its return value
          return TODO_ERROR;
        }
        // This never throws as far as I can tell.
        const params = new URLSearchParams(msg.urlString.slice(2));
        let webSocketConnectedParams;
        try {
          webSocketConnectedParams = WebSocketConnectedParams(
            Object.fromEntries(params)
          );
        } catch (errorAny) {
          // const error = errorAny as Decode.DecoderError;
          return TODO_ERROR;
        }
        if (webSocketConnectedParams.elmWatchVersion !== "%VERSION%") {
          return TODO_ERROR;
        }
        // find matching output (if any)
        // check status:
        //   compiled: compare timestamps
        //   not compiled: compile it!
        //   compiling: do nothing (I think)
        //   error: respond with error
        return [
          model,
          [
            {
              tag: "WebSocketAdd",
              webSocketConnection: {
                webSocket: msg.webSocket,
                outputPath: (() => {
                  throw new Error("TODO outputPath");
                })(),
              },
            },
          ],
        ];
      }

      case "WebSocketMessageReceived":
        // parse message
        // do stuff based on message
        // respond
        // don’t have to implement this right now
        return [model, []];

      case "WebSocketClosed":
        // just remove from mutable?
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

  const dirtyOutputs: Array<OutputState> = [];

  for (const [, outputs] of project.elmJsons) {
    for (const [, outputState] of outputs) {
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
        dirtyOutputs.push(outputState);
      }
    }
  }

  if (isNonEmptyArray(dirtyOutputs)) {
    const cmd: Cmd = { tag: "MarkAsDirty", outputStates: dirtyOutputs };
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
  events: Array<WatcherEvent>,
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
            keepConsumingDirty: false,
          },
        },
        [
          { tag: "ClearScreen" },
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
      case "ClearScreen":
        logger.clearScreen();
        mutable.lastInfoMessage = undefined;
        return;

      case "CompileAllOutputs": {
        const toCompile = getToCompile(mutable.project);
        for (const {
          index,
          elmJsonPath,
          outputPath,
          outputState,
        } of toCompile) {
          switch (outputState.status.tag) {
            case "ElmMake":
            case "Postprocess":
              // Already executing – when done they will re-execute if dirty
              // (unless we’re restarting or something like that).
              continue;

            default:
              Compile.compileOneOutput({
                env,
                logger,
                runMode: "hot",
                elmToolingJsonPath: mutable.project.elmToolingJsonPath,
                elmJsonPath,
                outputPath,
                outputState,
                index,
                total: toCompile.length,
              }).then(() => {
                dispatch({
                  tag: "CompileOneOutputDone",
                  date: getNow(),
                  index,
                  elmJsonPath,
                  outputPath,
                  outputState,
                });
              }, rejectPromise);
          }
        }
        return;
      }

      case "CompileOneOutput":
        Compile.compileOneOutput({
          env,
          logger,
          runMode: "hot",
          elmToolingJsonPath: mutable.project.elmToolingJsonPath,
          index: cmd.index,
          elmJsonPath: cmd.elmJsonPath,
          outputPath: cmd.outputPath,
          outputState: cmd.outputState,
          total: getToCompile(mutable.project).length,
        }).then(() => {
          dispatch({
            tag: "CompileOneOutputDone",
            date: getNow(),
            index: cmd.index,
            elmJsonPath: cmd.elmJsonPath,
            outputPath: cmd.outputPath,
            outputState: cmd.outputState,
          });
        }, rejectPromise);
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
        for (const outputState of cmd.outputStates) {
          outputState.dirty = true;
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
        outputStates: getToCompile(project).map(
          ({ outputState }) => outputState
        ),
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
