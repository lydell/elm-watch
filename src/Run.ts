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
import type {
  CliArg,
  ElmToolingJsonPath,
  GetNow,
  OnIdle,
  OutputPath,
  RunMode,
} from "./Types";

export async function run(
  cwd: Cwd,
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  runMode: RunMode,
  args: Array<CliArg>
): Promise<number> {
  const restart = (): Promise<number> =>
    run(cwd, env, logger, getNow, onIdle, runMode, args);

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

type ElmFileWatcherEvent = {
  date: Date;
  eventName: WatcherEventName;
  elmFile: AbsolutePath;
};

async function hot(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  passedRestart: () => Promise<number>,
  state: State.State
): Promise<number> {
  const isInteractive = logger.raw.stderr.isTTY;

  return new Promise((resolve, reject) => {
    let currentCompile: Promise<void> | undefined = undefined;
    let panicked = false;
    let lastInfoMessage: string | undefined = undefined;
    let lastBatchOfEvents: Array<ElmFileWatcherEvent> = [];
    let lastBatchOfNotInterestingEvents: Array<ElmFileWatcherEvent> = [];
    let printNonInterestingEventsTimeoutId: NodeJS.Timeout | undefined =
      undefined;

    const watcher = chokidar.watch(state.watchRoot.absolutePath, {
      ignoreInitial: true,
      ignored: ["**/elm-stuff/**", "**/node_modules/**"],
      disableGlobbing: true,
    });

    const logInfoMessageWithTimeline = (
      message: string,
      events: Array<ElmFileWatcherEvent>
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

    const restart = (
      changedFile: "elm-tooling.json" | "elm.json",
      event: WatcherEventName
    ): void => {
      logger.clearScreen();
      if (currentCompile !== undefined) {
        logger.error(restartMessage(changedFile, event));
      }
      state.fullRestartRequested = true;
      Promise.all([watcher.close(), currentCompile]).then(() => {
        passedRestart().then(resolve, reject);
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

    const onWatcherEvent =
      (event: WatcherEventName) =>
      (absolutePathString: string): void => {
        if (state.fullRestartRequested || panicked) {
          return;
        }

        if (absolutePathString.endsWith(".elm")) {
          let dirty = false;
          for (const [, outputs] of state.elmJsons) {
            for (const [, outputState] of outputs) {
              if (outputState.allRelatedElmFilePaths.has(absolutePathString)) {
                dirty = true;
                outputState.dirty = true;
              }
            }
          }
          const elmFileWatcherEvent: ElmFileWatcherEvent = {
            date: getNow(),
            eventName: event,
            elmFile: {
              tag: "AbsolutePath",
              absolutePath: absolutePathString,
            },
          };
          if (dirty) {
            lastBatchOfNotInterestingEvents = [];
            lastBatchOfEvents.push(elmFileWatcherEvent);
            runCompile();
          } else if (currentCompile === undefined) {
            lastBatchOfNotInterestingEvents.push(elmFileWatcherEvent);
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
            switch (event) {
              case "added":
                restart(basename, event);
                return;

              case "changed":
              case "removed":
                if (
                  absolutePathString ===
                  state.elmToolingJsonPath.theElmToolingJsonPath.absolutePath
                ) {
                  restart(basename, event);
                }
                return;
            }

          case "elm.json":
            switch (event) {
              case "added":
                restart(basename, event);
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
                  restart(basename, event);
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
  runMode: RunMode,
  restart: () => Promise<number>,
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

        const onWatcherEvent = (): void => {
          logger.clearScreen();
          watcher.close().then(restart).then(resolve, reject);
        };

        watcher.on("add", onWatcherEvent);
        watcher.on("change", onWatcherEvent);
        watcher.on("unlink", onWatcherEvent);
        watcher.on("error", reject);
      });
  }
}

function infoMessageWithTimeline(
  date: Date,
  message: string,
  events: Array<ElmFileWatcherEvent>
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

function printTimeline(events: Array<ElmFileWatcherEvent>): string | undefined {
  if (!isNonEmptyArray(events)) {
    return undefined;
  }

  const first = events[0];
  const last = events.length >= 2 ? events[events.length - 1] : undefined;
  const numMoreEvents = events.length - 2;

  return dim(
    join(
      [
        printElmFileWatcherEvent(first),
        printNumMoreEvents(numMoreEvents),
        last === undefined ? undefined : printElmFileWatcherEvent(last),
      ].flatMap((part) => (part === undefined ? [] : part)),
      "\n"
    )
  );
}

function printElmFileWatcherEvent(event: ElmFileWatcherEvent): string {
  return `${formatTime(event.date)} ${event.eventName} ${
    event.elmFile.absolutePath
  }`;
}

function printNumMoreEvents(numMoreEvents: number): string | undefined {
  return numMoreEvents <= 0
    ? undefined
    : numMoreEvents === 1
    ? "(1 more event)"
    : `(${numMoreEvents} more events)`;
}

function restartMessage(
  changedFile: "elm-tooling.json" | "elm.json",
  event: WatcherEventName
): string {
  return `An ${bold(changedFile)} file ${event}. Restarting!`;
}

function compileFinishedMessage(duration: number): string {
  return `Compilation finished in ${bold(duration.toString())} ms.`;
}

function notInterestingElmFileChangedMessage(
  events: NonEmptyArray<ElmFileWatcherEvent>,
  disabledOutputs: HashSet<OutputPath>
): string {
  const what1 = events.length === 1 ? "file is" : "files are";
  const what2 =
    disabledOutputs.size > 0 ? "any of the enabled outputs" : "any output";
  return `FYI: The above Elm ${what1} not imported by ${what2}. Nothing to do!`;
}
