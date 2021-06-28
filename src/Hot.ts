import * as chokidar from "chokidar";
import * as path from "path";
import * as readline from "readline";

import * as Compile from "./Compile";
import { HashSet } from "./HashSet";
import { bold, dim, Env, formatTime, join } from "./Helpers";
import type { Logger } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { AbsolutePath } from "./PathHelpers";
import { OutputState, Project } from "./Project";
import {
  ElmJsonPath,
  ElmToolingJsonPath,
  equalsInputPath,
  GetNow,
  OnIdle,
  OutputPath,
} from "./Types";

type WatcherEventName = "added" | "changed" | "removed";

export type WatcherEvent = {
  date: Date;
  eventName: WatcherEventName;
  file: AbsolutePath;
};

type NextAction =
  | {
      readonly tag: "Compile";
      readonly events: NonEmptyArray<WatcherEvent>;
    }
  | {
      readonly tag: "NoAction";
    }
  | {
      readonly tag: "PrintNonInterestingEvents";
      readonly events: NonEmptyArray<WatcherEvent>;
    }
  | {
      readonly tag: "Restart";
      readonly eventsWithMessages: NonEmptyArray<{
        event: WatcherEvent;
        message: string;
      }>;
    };

type MutableArray<T> = Array<T>;

type HotState =
  | {
      readonly tag: "Compiling";
      readonly start: Date;
      readonly events: MutableArray<WatcherEvent>;
      keepConsumingDirty: boolean;
    }
  | {
      readonly tag: "Dependencies";
      readonly start: Date;
      readonly events: MutableArray<WatcherEvent>;
    }
  | {
      readonly tag: "Idle";
    }
  | {
      readonly tag: "Restarting";
      readonly events: NonEmptyArray<WatcherEvent>;
    };

export type HotRunResult =
  | { tag: "ExitOnIdle" }
  | { tag: "Restart"; restartReasons: NonEmptyArray<WatcherEvent> };

// This function encapsulates all the tricky watcher logic and state mutations.
// `readonly` and `MutableArray` is used above to show what is and isn’t mutated.
// `let` variables below of course are re-assigned at times.
export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  restartReasons: Array<WatcherEvent>,
  project: Project
): Promise<HotRunResult> {
  const isInteractive = logger.raw.stderr.isTTY;

  const toCompile = Array.from(project.elmJsons).flatMap(
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

    const watcher = chokidar.watch(project.watchRoot.absolutePath, {
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

    const runOnIdle = (): void => {
      if (onIdle !== undefined) {
        const response = onIdle();
        switch (response) {
          case "KeepGoing":
            return;
          case "Stop":
            watcher.close().then(() => {
              resolve({ tag: "ExitOnIdle" });
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
        elmToolingJsonPath: project.elmToolingJsonPath,
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

        case "Compiling": {
          if (outputState.dirty) {
            return hotState.keepConsumingDirty
              ? compileOneOutput(elmJsonPath, outputPath, outputState, index)
              : undefined;
          }
          const someOutputIsExecutingOrWasInterrupted = toCompile.some(
            ([, , outputState2]) => {
              switch (outputState2.status.tag) {
                case "ElmMake":
                case "Postprocess":
                case "Interrupted":
                  return true;

                default:
                  return false;
              }
            }
          );
          // Output executing -> wait for that.
          // Output interrupted -> it will be re-executed soon, so wait for that.
          if (!someOutputIsExecutingOrWasInterrupted) {
            const duration = getNow().getTime() - hotState.start.getTime();
            const errors = Compile.extractErrors(project);
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
        }

        case "Restarting": {
          const someOutputIsExecuting = toCompile.some(([, , outputState2]) => {
            switch (outputState2.status.tag) {
              case "ElmMake":
              case "Postprocess":
                return true;

              default:
                return false;
            }
          });

          if (!someOutputIsExecuting) {
            runRestart(hotState.events);
          }
          return;
        }
      }
    };

    const compileAllOutputs = (): void => {
      for (const [
        index,
        [elmJsonPath, outputPath, outputState],
      ] of toCompile.entries()) {
        switch (outputState.status.tag) {
          case "ElmMake":
          case "Postprocess":
            // Already executing – when done they will re-execute if dirty
            // (unless we’re restarting or something like that).
            return;

          default:
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
          Compile.printStatusLinesForElmJsonsErrors(logger, project);
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
        resolve({ tag: "Restart", restartReasons: events });
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
                  project.disabledOutputs
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

    const onElmFileWatcherEvent = (
      event: WatcherEvent,
      passedNextAction: NextAction
    ): NextAction | undefined => {
      const elmFile = event.file;

      if (isRelatedToElmJsonsErrors(elmFile, project.elmJsonsErrors)) {
        return makeRestartNextAction(
          restartBecauseRelatedToElmJsonsErrorsMessage(event.eventName),
          event,
          passedNextAction
        );
      }

      let dirty = false;

      for (const [, outputs] of project.elmJsons) {
        for (const [, outputState] of outputs) {
          if (event.eventName === "removed") {
            for (const inputPath of outputState.inputs) {
              if (equalsInputPath(elmFile, inputPath)) {
                return makeRestartNextAction(
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
          makeEvent(eventName, absolutePathString, getNow()),
          passedNextAction
        );
      }

      const basename = path.basename(absolutePathString);

      switch (basename) {
        case "elm-tooling.json":
          switch (eventName) {
            case "added":
              return makeRestartNextAction(
                restartBecauseJsonFileChangedMessage(basename, eventName),
                makeEvent(eventName, absolutePathString, getNow()),
                passedNextAction
              );

            case "changed":
            case "removed":
              if (
                absolutePathString ===
                project.elmToolingJsonPath.theElmToolingJsonPath.absolutePath
              ) {
                return makeRestartNextAction(
                  restartBecauseJsonFileChangedMessage(basename, eventName),
                  makeEvent(eventName, absolutePathString, getNow()),
                  passedNextAction
                );
              }
              return undefined;
          }

        case "elm.json":
          switch (eventName) {
            case "added":
              return makeRestartNextAction(
                restartBecauseJsonFileChangedMessage(basename, eventName),
                makeEvent(eventName, absolutePathString, getNow()),
                passedNextAction
              );

            case "changed":
            case "removed":
              if (
                Array.from(project.elmJsons).some(
                  ([elmJsonPath]) =>
                    absolutePathString ===
                    elmJsonPath.theElmJsonPath.absolutePath
                )
              ) {
                return makeRestartNextAction(
                  restartBecauseJsonFileChangedMessage(basename, eventName),
                  makeEvent(eventName, absolutePathString, getNow()),
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

      watcherOnAll(watcher, (eventName, absolutePathString) => {
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
        watcherTimeoutId = setTimeout(() => {
          watcherTimeoutId = undefined;
          runNextAction(nextAction);
          nextAction = { tag: "NoAction" };
        }, 10);
      });

      // As far as I can tell, the watcher is never supposed to emit error events
      // during normal operation.
      watcher.on("error", reject);
    }

    hotState = {
      tag: "Dependencies",
      start: getNow(),
      events: restartReasons,
    };

    Compile.installDependencies(env, logger, project).then((installResult) => {
      switch (hotState.tag) {
        case "Dependencies": {
          switch (installResult.tag) {
            case "Error":
              hotState = { tag: "Idle" };
              runOnIdle();
              return;

            case "Success": {
              const { events, start } = hotState;
              hotState = { tag: "Idle" };
              runCompile(events, start);
              return;
            }
          }
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

    watcherOnAll(watcher, (eventName, absolutePathString) => {
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

function watcherOnAll(
  watcher: chokidar.FSWatcher,
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
}

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
  nextAction: NextAction
): NextAction {
  return {
    tag: "Restart",
    eventsWithMessages:
      nextAction.tag === "Restart"
        ? [...nextAction.eventsWithMessages, { event, message }]
        : [{ event, message }],
  };
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
