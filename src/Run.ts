import * as chokidar from "chokidar";
import * as path from "path";
import * as readline from "readline";

import * as CliArgs from "./CliArgs";
import * as Compile from "./Compile";
import * as ElmToolingJson from "./ElmToolingJson";
import * as Errors from "./Errors";
import { HashSet } from "./HashSet";
import { bold, dim, Env, formatTime, join } from "./Helpers";
import type { Logger } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { AbsolutePath, Cwd } from "./PathHelpers";
import { initState, OutputState, State } from "./State";
import {
  CliArg,
  ElmJsonPath,
  ElmToolingJsonPath,
  equalsInputPath,
  GetNow,
  OnIdle,
  OutputPath,
  RunMode,
} from "./Types";

type Restart = (
  nextRestartReason: NonEmptyArray<WatcherEvent>
) => Promise<number>;

export async function run(
  cwd: Cwd,
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  runMode: RunMode,
  args: Array<CliArg>,
  restartReasons: Array<WatcherEvent>
): Promise<number> {
  const restart: Restart = (nextRestartReasons) =>
    run(cwd, env, logger, getNow, onIdle, runMode, args, nextRestartReasons);

  const parseResult = ElmToolingJson.findReadAndParse(cwd);

  switch (parseResult.tag) {
    case "ReadAsJsonError":
      logger.errorTemplate(
        Errors.readElmToolingJsonAsJson(
          parseResult.elmToolingJsonPath,
          parseResult.error
        )
      );
      return handleElmToolingJsonError(
        1,
        logger,
        getNow,
        runMode,
        restart,
        parseResult.elmToolingJsonPath
      );

    case "DecodeError":
      logger.errorTemplate(
        Errors.decodeElmToolingJson(
          parseResult.elmToolingJsonPath,
          parseResult.error
        )
      );
      return handleElmToolingJsonError(
        1,
        logger,
        getNow,
        runMode,
        restart,
        parseResult.elmToolingJsonPath
      );

    case "ElmToolingJsonNotFound":
      logger.errorTemplate(Errors.elmToolingJsonNotFound(cwd, args));
      return 1;

    case "Parsed": {
      const parseArgsResult = CliArgs.parseArgs(runMode, args);

      switch (parseArgsResult.tag) {
        case "BadArgs":
          logger.errorTemplate(
            Errors.badArgs(
              cwd,
              parseResult.elmToolingJsonPath,
              args,
              parseArgsResult.badArgs
            )
          );
          return 1;

        case "DebugOptimizeForHot":
          logger.errorTemplate(Errors.debugOptimizeForHot());
          return 1;

        case "DebugOptimizeClash":
          logger.errorTemplate(Errors.debugOptimizeClash());
          return 1;

        case "Success": {
          const { outputs } = parseResult.config;
          const unknownOutputs = parseArgsResult.outputs.filter(
            (arg) => !Object.prototype.hasOwnProperty.call(outputs, arg)
          );

          if (isNonEmptyArray(unknownOutputs)) {
            logger.errorTemplate(
              Errors.unknownOutputs(
                parseResult.elmToolingJsonPath,
                // The decoder validates that there’s at least one output.
                Object.keys(outputs) as NonEmptyArray<string>,
                unknownOutputs
              )
            );
            return 1;
          }

          const initStateResult = initState({
            cwd,
            runMode,
            compilationMode: parseArgsResult.compilationMode,
            elmToolingJsonPath: parseResult.elmToolingJsonPath,
            config: parseResult.config,
            enabledOutputs: isNonEmptyArray(parseArgsResult.outputs)
              ? new Set(parseArgsResult.outputs)
              : new Set(Object.keys(outputs)),
          });

          switch (initStateResult.tag) {
            // istanbul ignore next
            case "NoCommonRoot":
              logger.errorTemplate(Errors.noCommonRoot(initStateResult.paths));
              return 1;

            case "State": {
              switch (runMode) {
                case "make":
                  return make(env, logger, runMode, initStateResult.state);

                case "hot":
                  return hot(
                    env,
                    logger,
                    getNow,
                    onIdle,
                    restart,
                    restartReasons,
                    initStateResult.state
                  );
              }
            }
          }
        }
      }
    }
  }
}

async function make(
  env: Env,
  logger: Logger,
  runMode: RunMode,
  state: State
): Promise<number> {
  const installResult = await Compile.installDependencies(env, logger, state);

  if (installResult !== 0) {
    return installResult;
  }

  const toCompile = Array.from(state.elmJsons).flatMap(
    ([elmJsonPath, outputs]) =>
      Array.from(
        outputs,
        ([outputPath, outputState]) =>
          [elmJsonPath, outputPath, outputState] as const
      )
  );

  Compile.printElmJsonsErrors(logger, state);

  await Promise.all(
    toCompile.map(
      async (
        [elmJsonPath, outputPath, outputState],
        index: number
      ): Promise<void> =>
        Compile.compileOneOutput({
          env,
          logger,
          runMode,
          elmToolingJsonPath: state.elmToolingJsonPath,
          elmJsonPath,
          outputPath,
          outputState,
          index,
          total: toCompile.length,
        })
    )
  );

  const errors = Compile.extractErrors(state);

  if (isNonEmptyArray(errors)) {
    Compile.printErrors(logger, errors);
    return 1;
  }

  return 0;
}

type WatcherEventName = "added" | "changed" | "removed";

type WatcherEvent = {
  date: Date;
  eventName: WatcherEventName;
  file: AbsolutePath;
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

async function hot(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  passedRestart: Restart,
  passedRestartReasons: Array<WatcherEvent>,
  state: State
): Promise<number> {
  const isInteractive = logger.raw.stderr.isTTY;

  const toCompile = Array.from(state.elmJsons).flatMap(
    ([elmJsonPath, outputs]) =>
      Array.from(
        outputs,
        ([outputPath, outputState]): [ElmJsonPath, OutputPath, OutputState] => [
          elmJsonPath,
          outputPath,
          outputState,
        ]
      )
  );

  return new Promise((resolve, reject) => {
    let hotState: HotState = { tag: "Idle" };

    const watcher = chokidar.watch(state.watchRoot.absolutePath, {
      ignoreInitial: true,
      ignored: ["**/elm-stuff/**", "**/node_modules/**"],
      disableGlobbing: true,
    });

    let lastInfoMessage: string | undefined = undefined;
    const logInfoMessageWithTimeline = (
      message: string,
      events: Array<WatcherEvent>
    ): void => {
      if (lastInfoMessage !== undefined && isInteractive) {
        readline.moveCursor(
          logger.raw.stderr,
          0,
          -lastInfoMessage.split("\n").length
        );
        readline.clearScreenDown(logger.raw.stderr);
      }
      const fullMessage = infoMessageWithTimeline(getNow(), message, events);
      lastInfoMessage = fullMessage;
      logger.error(fullMessage);
    };

    const restart = (
      message: string,
      event: WatcherEvent,
      nextAction: NextAction
    ): NextAction => ({
      tag: "Restart",
      eventsWithMessages:
        nextAction.tag === "Restart"
          ? [...nextAction.eventsWithMessages, { event, message }]
          : [{ event, message }],
    });

    const runOnIdle = (): void => {
      if (onIdle !== undefined) {
        const response = onIdle();
        switch (response) {
          case "KeepGoing":
            return;
          case "Stop":
            watcher.close().then(() => {
              resolve(0);
            }, reject);
            return;
        }
      }
    };

    const compileOneOutput = async (
      elmJsonPath: ElmJsonPath,
      outputPath: OutputPath,
      outputState: OutputState,
      index: number
    ): Promise<void> => {
      await Compile.compileOneOutput({
        env,
        logger,
        runMode: "hot",
        elmToolingJsonPath: state.elmToolingJsonPath,
        elmJsonPath,
        outputPath,
        outputState,
        index,
        total: toCompile.length,
      });

      switch (hotState.tag) {
        case "Dependencies":
        case "Idle":
          throw new Error(`HotState became ${hotState.tag} while compiling!`);

        case "Compiling":
          if (outputState.dirty) {
            if (hotState.keepConsumingDirty) {
              return compileOneOutput(
                elmJsonPath,
                outputPath,
                outputState,
                index
              );
            }
          } else if (allAreIdle(toCompile)) {
            const duration = getNow().getTime() - hotState.start.getTime();
            const errors = Compile.extractErrors(state);
            if (isNonEmptyArray(errors)) {
              Compile.printErrors(logger, errors);
            }
            logInfoMessageWithTimeline(
              compileFinishedMessage(duration),
              hotState.events
            );
            hotState = { tag: "Idle" };
            runOnIdle();
          }
          return;

        case "Restarting":
          if (allAreIdle(toCompile)) {
            runRestart(hotState.events);
          }
          return;
      }
    };

    const compileAllOutputs = (): void => {
      for (const [
        index,
        [elmJsonPath, outputPath, outputState],
      ] of toCompile.entries()) {
        if (isIdle(outputState)) {
          compileOneOutput(elmJsonPath, outputPath, outputState, index).catch(
            reject
          );
        }
      }
    };

    const runCompile = (events: Array<WatcherEvent>, start: Date): void => {
      switch (hotState.tag) {
        case "Idle": {
          logger.clearScreen();
          lastInfoMessage = undefined;
          hotState = {
            tag: "Compiling",
            start,
            events,
            keepConsumingDirty: false,
          };
          Compile.printElmJsonsErrors(logger, state);
          compileAllOutputs();
          return;
        }

        case "Compiling":
          hotState.events.push(...events);
          hotState.keepConsumingDirty = true;
          compileAllOutputs();
          return;

        case "Dependencies":
          hotState.events.push(...events);
          return;

        case "Restarting":
          return;
      }
    };

    const runRestart = (events: NonEmptyArray<WatcherEvent>): void => {
      watcher.close().then(() => {
        passedRestart(events).then(resolve, reject);
      }, reject);
    };

    const runNextAction = (nextAction: NextAction): void => {
      switch (nextAction.tag) {
        case "NoAction":
          return;

        case "Restart": {
          const { eventsWithMessages } = nextAction;
          const events = mapNonEmptyArray(
            eventsWithMessages,
            ({ event }) => event
          );

          switch (hotState.tag) {
            case "Idle": {
              logger.clearScreen();
              lastInfoMessage = undefined;
              hotState = { tag: "Restarting", events };
              runRestart(events);
              return;
            }

            case "Dependencies":
            case "Compiling": {
              logger.clearScreen();
              lastInfoMessage = undefined;
              hotState = { tag: "Restarting", events };
              logInfoMessageWithTimeline(
                restartingMessage(eventsWithMessages),
                events
              );
              // The actual restart is triggered once the current compilation is over.
              return;
            }

            case "Restarting":
              return;
          }
        }

        case "Compile":
          runCompile(nextAction.events, getNow());
          return;

        case "PrintNonInterestingEvents":
          switch (hotState.tag) {
            case "Idle":
              logInfoMessageWithTimeline(
                notInterestingElmFileChangedMessage(
                  nextAction.events,
                  state.disabledOutputs
                ),
                nextAction.events
              );
              runOnIdle();
              return;

            case "Compiling":
            case "Dependencies":
            case "Restarting":
              return;
          }
      }
    };

    const makeEvent = (
      eventName: WatcherEventName,
      absolutePathString: string
    ): WatcherEvent => ({
      date: getNow(),
      eventName,
      file: {
        tag: "AbsolutePath",
        absolutePath: absolutePathString,
      },
    });

    const onElmFileWatcherEvent = (
      event: WatcherEvent,
      passedNextAction: NextAction
    ): NextAction | undefined => {
      const elmFile = event.file;

      if (isRelatedToElmJsonsErrors(elmFile, state.elmJsonsErrors)) {
        return restart(
          restartBecauseRelatedToElmJsonsErrorsMessage(event.eventName),
          event,
          passedNextAction
        );
      }

      let dirty = false;

      for (const [, outputs] of state.elmJsons) {
        for (const [, outputState] of outputs) {
          if (event.eventName === "removed") {
            for (const inputPath of outputState.inputs) {
              if (equalsInputPath(elmFile, inputPath)) {
                return restart(
                  restartBecauseInputWasRemovedMessage(),
                  event,
                  passedNextAction
                );
              }
            }
          }
          if (outputState.allRelatedElmFilePaths.has(elmFile.absolutePath)) {
            dirty = true;
            outputState.dirty = true;
          }
        }
      }

      if (dirty) {
        switch (passedNextAction.tag) {
          case "Restart":
            return passedNextAction;

          case "Compile":
            return {
              tag: "Compile",
              events: [...passedNextAction.events, event],
            };

          case "NoAction":
          case "PrintNonInterestingEvents":
            return {
              tag: "Compile",
              events: [event],
            };
        }
      } else {
        switch (passedNextAction.tag) {
          case "Restart":
          case "Compile":
            return passedNextAction;

          case "NoAction":
            return {
              tag: "PrintNonInterestingEvents",
              events: [event],
            };

          case "PrintNonInterestingEvents":
            return {
              tag: "PrintNonInterestingEvents",
              events: [...passedNextAction.events, event],
            };
        }
      }
    };

    const onWatcherEvent = (
      eventName: WatcherEventName,
      absolutePathString: string,
      passedNextAction: NextAction
    ): NextAction | undefined => {
      if (absolutePathString.endsWith(".elm")) {
        return onElmFileWatcherEvent(
          makeEvent(eventName, absolutePathString),
          passedNextAction
        );
      }

      const basename = path.basename(absolutePathString);

      switch (basename) {
        case "elm-tooling.json":
          switch (eventName) {
            case "added":
              return restart(
                restartBecauseJsonFileChangedMessage(basename, eventName),
                makeEvent(eventName, absolutePathString),
                passedNextAction
              );

            case "changed":
            case "removed":
              if (
                absolutePathString ===
                state.elmToolingJsonPath.theElmToolingJsonPath.absolutePath
              ) {
                return restart(
                  restartBecauseJsonFileChangedMessage(basename, eventName),
                  makeEvent(eventName, absolutePathString),
                  passedNextAction
                );
              }
              return undefined;
          }

        case "elm.json":
          switch (eventName) {
            case "added":
              return restart(
                restartBecauseJsonFileChangedMessage(basename, eventName),
                makeEvent(eventName, absolutePathString),
                passedNextAction
              );

            case "changed":
            case "removed":
              if (
                Array.from(state.elmJsons).some(
                  ([elmJsonPath]) =>
                    absolutePathString ===
                    elmJsonPath.theElmJsonPath.absolutePath
                )
              ) {
                return restart(
                  restartBecauseJsonFileChangedMessage(basename, eventName),
                  makeEvent(eventName, absolutePathString),
                  passedNextAction
                );
              }
              return undefined;
          }

        default:
          // Ignore other types of files.
          return undefined;
      }
    };

    {
      let nextAction: NextAction = { tag: "NoAction" };
      let watcherTimeoutId: NodeJS.Timeout | undefined;

      // I think the thing here is that we only want to batch 10 ms on Idle, not
      // Compiling. Probably not for Restarting – well yes, there could be
      // several events leading to restart and we want to capture them all.
      const onWatcherEventWrapper =
        (eventName: WatcherEventName) =>
        (absolutePathString: string): void => {
          const updatedNextAction = onWatcherEvent(
            eventName,
            absolutePathString,
            nextAction
          );

          if (updatedNextAction === undefined) {
            return;
          }

          if (hotState.tag === "Compiling") {
            hotState.keepConsumingDirty = false;
          }

          if (updatedNextAction.tag === "Restart") {
            // Interrupt all compilation.
            for (const [, , outputState] of toCompile) {
              outputState.dirty = true;
            }
          }

          nextAction = updatedNextAction;

          if (watcherTimeoutId !== undefined) {
            clearTimeout(watcherTimeoutId);
          }

          // Sleep for a little bit in hot mode to avoid unnecessary
          // recompilation when using “save all” in an editor, or when running
          // `git switch some-branch` or `git restore .`. These operations
          // results in many files being added/changed/deleted, usually with
          // 0-1 ms between each event.
          setTimeout(() => {
            watcherTimeoutId = undefined;
            runNextAction(nextAction);
            nextAction = { tag: "NoAction" };
          }, 10);
        };

      watcher.on("add", onWatcherEventWrapper("added"));
      watcher.on("change", onWatcherEventWrapper("changed"));
      watcher.on("unlink", onWatcherEventWrapper("removed"));

      // As far as I can tell, the watcher is never supposed to emit error events
      // during normal operation.
      watcher.on("error", reject);
    }

    hotState = {
      tag: "Dependencies",
      start: getNow(),
      events: passedRestartReasons,
    };

    Compile.installDependencies(env, logger, state).then((exitCode) => {
      switch (hotState.tag) {
        case "Dependencies": {
          if (exitCode !== 0) {
            hotState = { tag: "Idle" };
            runOnIdle();
            return;
          }

          const { events, start } = hotState;
          hotState = { tag: "Idle" };
          runCompile(events, start);
          return;
        }

        case "Restarting":
          runRestart(hotState.events);
          return;

        case "Idle":
        case "Compiling":
          reject(
            new Error(
              `HotState became ${hotState.tag} while installing dependencies!`
            )
          );
          return;
      }
    }, reject);
  });
}

async function handleElmToolingJsonError(
  exitCode: number,
  logger: Logger,
  getNow: GetNow,
  runMode: RunMode,
  restart: Restart,
  elmToolingJsonPath: ElmToolingJsonPath
): Promise<number> {
  switch (runMode) {
    case "make":
      return exitCode;

    case "hot":
      return new Promise((resolve, reject) => {
        const watcher = chokidar.watch(
          elmToolingJsonPath.theElmToolingJsonPath.absolutePath,
          {
            ignoreInitial: true,
            disableGlobbing: true,
          }
        );

        const onWatcherEvent =
          (eventName: WatcherEventName) =>
          (absolutePathString: string): void => {
            const now = getNow();
            logger.clearScreen();
            watcher
              .close()
              .then(() =>
                restart([
                  {
                    date: now,
                    eventName,
                    file: {
                      tag: "AbsolutePath",
                      absolutePath: absolutePathString,
                    },
                  },
                ])
              )
              .then(resolve, reject);
          };

        watcher.on("add", onWatcherEvent("added"));
        watcher.on("change", onWatcherEvent("changed"));
        watcher.on("unlink", onWatcherEvent("removed"));
        watcher.on("error", reject);
      });
  }
}

function isIdle(outputState: OutputState): boolean {
  switch (outputState.status.tag) {
    case "ElmMake":
    case "Postprocess":
    case "Interrupted":
      return false;

    default:
      return true;
  }
}

function allAreIdle(
  toCompile: Array<[ElmJsonPath, OutputPath, OutputState]>
): boolean {
  return toCompile.every(([, , outputState]) => isIdle(outputState));
}
function isRelatedToElmJsonsErrors(
  elmFile: AbsolutePath,
  elmJsonsErrors: State["elmJsonsErrors"]
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
