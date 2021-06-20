import * as chokidar from "chokidar";
import * as path from "path";
import * as readline from "readline";

import * as CliArgs from "./CliArgs";
import { compile } from "./Compile";
import * as ElmToolingJson from "./ElmToolingJson";
import * as Errors from "./Errors";
import { HashSet } from "./HashSet";
import { bold, dim, Env, formatTime, join, WATCHER_SLEEP_MS } from "./Helpers";
import type { Logger } from "./Logger";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath, Cwd } from "./PathHelpers";
import * as State from "./State";
import {
  CliArg,
  ElmToolingJsonPath,
  equalsInputPath,
  GetNow,
  OnIdle,
  OutputPath,
  RunMode,
} from "./Types";

type Restart = (nextRestartReason: WatcherEvent) => Promise<number>;

export async function run(
  cwd: Cwd,
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  runMode: RunMode,
  args: Array<CliArg>,
  restartReason?: WatcherEvent
): Promise<number> {
  const restart: Restart = (nextRestartReason) =>
    run(cwd, env, logger, getNow, onIdle, runMode, args, nextRestartReason);

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

          const initStateResult = State.init({
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
                  return compile(env, logger, runMode, initStateResult.state);
                case "hot":
                  return hot(
                    env,
                    logger,
                    getNow,
                    onIdle,
                    restart,
                    restartReason,
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

type WatcherEventName = "added" | "changed" | "removed";

type WatcherEvent = {
  date: Date;
  eventName: WatcherEventName;
  file: AbsolutePath;
};

async function hot(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  passedRestart: Restart,
  passedRestartReason: WatcherEvent | undefined,
  state: State.State
): Promise<number> {
  const isInteractive = logger.raw.stderr.isTTY;

  return new Promise((resolve, reject) => {
    let currentCompile: Promise<void> | undefined = undefined;
    let panicked = false;
    let lastInfoMessage: string | undefined = undefined;
    let lastBatchOfEvents: Array<WatcherEvent> =
      passedRestartReason === undefined ? [] : [passedRestartReason];
    let lastBatchOfNotInterestingEvents: Array<WatcherEvent> = [];
    let printNonInterestingEventsTimeoutId: NodeJS.Timeout | undefined =
      undefined;

    const watcher = chokidar.watch(state.watchRoot.absolutePath, {
      ignoreInitial: true,
      ignored: ["**/elm-stuff/**", "**/node_modules/**"],
      disableGlobbing: true,
    });

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

    const maybePrintNonInterestingEvents = (): void => {
      if (isNonEmptyArray(lastBatchOfNotInterestingEvents)) {
        logInfoMessageWithTimeline(
          notInterestingElmFileChangedMessage(
            lastBatchOfNotInterestingEvents,
            state.disabledOutputs
          ),
          lastBatchOfNotInterestingEvents
        );
        lastBatchOfNotInterestingEvents = [];
      }
    };

    const panic = (error: Error): void => {
      panicked = true;
      reject(error);
    };

    const restart = (message: string, event: WatcherEvent): void => {
      logger.clearScreen();
      if (currentCompile !== undefined) {
        logInfoMessageWithTimeline(message, [event]);
      }
      state.fullRestartRequested = true;
      Promise.all([watcher.close(), currentCompile]).then(() => {
        passedRestart(event).then(resolve, reject);
      }, panic);
    };

    const runCompile = (): void => {
      if (currentCompile === undefined) {
        logger.clearScreen();
        lastInfoMessage = undefined;
        const start = getNow();
        currentCompile = compile(env, logger, "hot", state).then(() => {
          currentCompile = undefined;
          const duration = getNow().getTime() - start.getTime();
          logInfoMessageWithTimeline(
            compileFinishedMessage(duration),
            lastBatchOfEvents
          );
          lastBatchOfEvents = [];
          if (onIdle !== undefined && !state.fullRestartRequested) {
            const response = onIdle();
            switch (response) {
              case "KeepGoing":
                return;
              case "Stop":
                watcher.close().then(() => {
                  resolve(0);
                }, panic);
                return;
            }
          }
        }, panic);
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

    const onWatcherEvent =
      (eventName: WatcherEventName) =>
      (absolutePathString: string): void => {
        if (state.fullRestartRequested || panicked) {
          return;
        }

        if (absolutePathString.endsWith(".elm")) {
          const event = makeEvent(eventName, absolutePathString);
          const elmFile = event.file;

          if (isRelatedToElmJsonsErrors(elmFile, state.elmJsonsErrors)) {
            restart(
              restartBecauseRelatedToElmJsonsErrorsMessage(eventName),
              event
            );
            return;
          }

          let dirty = false;
          for (const [, outputs] of state.elmJsons) {
            for (const [, outputState] of outputs) {
              if (eventName === "removed") {
                for (const inputPath of outputState.inputs) {
                  if (equalsInputPath(elmFile, inputPath)) {
                    restart(restartBecauseInputWasRemovedMessage(), event);
                    return;
                  }
                }
              }
              if (
                outputState.allRelatedElmFilePaths.has(elmFile.absolutePath)
              ) {
                dirty = true;
                outputState.dirty = true;
              }
            }
          }
          if (dirty) {
            lastBatchOfNotInterestingEvents = [];
            lastBatchOfEvents.push(event);
            runCompile();
          } else if (currentCompile === undefined) {
            lastBatchOfNotInterestingEvents.push(event);
            if (printNonInterestingEventsTimeoutId !== undefined) {
              clearTimeout(printNonInterestingEventsTimeoutId);
            }
            printNonInterestingEventsTimeoutId = setTimeout(() => {
              printNonInterestingEventsTimeoutId = undefined;
              maybePrintNonInterestingEvents();
            }, WATCHER_SLEEP_MS);
          }
          return;
        }

        const basename = path.basename(absolutePathString);

        switch (basename) {
          case "elm-tooling.json":
            switch (eventName) {
              case "added":
                restart(
                  restartBecauseJsonFileChangedMessage(basename, eventName),
                  makeEvent(eventName, absolutePathString)
                );
                return;

              case "changed":
              case "removed":
                if (
                  absolutePathString ===
                  state.elmToolingJsonPath.theElmToolingJsonPath.absolutePath
                ) {
                  restart(
                    restartBecauseJsonFileChangedMessage(basename, eventName),
                    makeEvent(eventName, absolutePathString)
                  );
                }
                return;
            }

          case "elm.json":
            switch (eventName) {
              case "added":
                restart(
                  restartBecauseJsonFileChangedMessage(basename, eventName),
                  makeEvent(eventName, absolutePathString)
                );
                return;

              case "changed":
              case "removed":
                if (
                  Array.from(state.elmJsons).some(
                    ([elmJsonPath]) =>
                      absolutePathString ===
                      elmJsonPath.theElmJsonPath.absolutePath
                  )
                ) {
                  restart(
                    restartBecauseJsonFileChangedMessage(basename, eventName),
                    makeEvent(eventName, absolutePathString)
                  );
                }
                return;
            }

          default:
            // Ignore other types of files.
            return;
        }
      };

    watcher.on("add", onWatcherEvent("added"));
    watcher.on("change", onWatcherEvent("changed"));
    watcher.on("unlink", onWatcherEvent("removed"));

    // As far as I can tell, the watcher is never supposed to emit error events
    // during normal operation.
    watcher.on("error", panic);

    runCompile();
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
                restart({
                  date: now,
                  eventName,
                  file: {
                    tag: "AbsolutePath",
                    absolutePath: absolutePathString,
                  },
                })
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

function isRelatedToElmJsonsErrors(
  elmFile: AbsolutePath,
  elmJsonsErrors: State.State["elmJsonsErrors"]
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
  return `An ${bold(changedFile)} file ${eventName}. Restarting!`;
}

function restartBecauseRelatedToElmJsonsErrorsMessage(
  eventName: WatcherEventName
): string {
  return `A problematic input Elm file was ${eventName}. Restarting!`;
}

function restartBecauseInputWasRemovedMessage(): string {
  return "An input Elm file was removed. Restarting!";
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
