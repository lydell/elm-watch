import * as chokidar from "chokidar";
import * as path from "path";
import * as readline from "readline";

import * as CliArgs from "./CliArgs";
import { compile } from "./Compile";
import * as ElmToolingJson from "./ElmToolingJson";
import * as Errors from "./Errors";
import { HashSet } from "./HashSet";
import { bold, CLEAR, dim, Env, formatTime } from "./Helpers";
import type { Logger } from "./Logger";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath, Cwd } from "./PathHelpers";
import * as State from "./State";
import type { CliArg, GetNow, OnIdle, OutputPath, RunMode } from "./Types";

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
      return 1;

    case "DecodeError":
      logger.errorTemplate(
        Errors.decodeElmToolingJson(
          parseResult.elmToolingJsonPath,
          parseResult.error
        )
      );
      return 1;

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

type WatcherEvent = "added" | "changed" | "removed";

async function hot(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  passedRestart: () => Promise<number>,
  state: State.State
): Promise<number> {
  return new Promise((resolve, reject) => {
    let currentCompile: Promise<void> | undefined = undefined;
    let panicked = false;
    let lastInfoMessage: string | undefined = undefined;

    const watcher = chokidar.watch(state.watchRoot.absolutePath, {
      ignoreInitial: true,
      ignored: ["**/elm-stuff/**", "**/node_modules/**"],
      disableGlobbing: true,
    });

    const logInfoMessage = (message: string): void => {
      if (lastInfoMessage !== undefined) {
        readline.moveCursor(
          logger.raw.stderr,
          0,
          -(lastInfoMessage.split("\n").length + 1)
        );
        readline.clearScreenDown(logger.raw.stderr);
      }
      const fullMessage = infoMessage(getNow(), message);
      lastInfoMessage = fullMessage;
      logger.error(fullMessage);
    };

    const panic = (error: Error): void => {
      panicked = true;
      reject(error);
    };

    const restart = (
      changedFile: "elm-tooling.json" | "elm.json",
      event: WatcherEvent
    ): void => {
      logger.error(`${CLEAR}${restartMessage(changedFile, event)}`);
      state.fullRestartRequested = true;
      Promise.all([watcher.close(), currentCompile]).then(() => {
        passedRestart().then(resolve, reject);
      }, panic);
    };

    const runCompile = (): void => {
      if (currentCompile === undefined) {
        logger.raw.stderr.write(CLEAR);
        lastInfoMessage = undefined;
        const start = getNow();
        currentCompile = compile(env, logger, "hot", state).then(() => {
          currentCompile = undefined;
          const duration = getNow().getTime() - start.getTime();
          logInfoMessage(
            compileFinishedMessage(state.lastChangedFile, duration)
          );
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
      (event: WatcherEvent) =>
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
          const absolutePath: AbsolutePath = {
            tag: "AbsolutePath",
            absolutePath: absolutePathString,
          };
          if (dirty) {
            state.lastChangedFile = absolutePath;
            runCompile();
          } else {
            logger.error(
              notInterestingElmFileChangedMessage(
                absolutePath,
                event,
                state.disabledOutputs
              )
            );
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

function infoMessage(date: Date, message: string): string {
  return `\n${bold(formatTime(date))} ${message}`;
}

function restartMessage(
  changedFile: "elm-tooling.json" | "elm.json",
  event: WatcherEvent
): string {
  return `A ${bold(changedFile)} file ${event}. Restarting!`;
}

function compileFinishedMessage(
  lastChangedFile: AbsolutePath | undefined,
  duration: number
): string {
  const common = `Compilation finished in ${bold(duration.toString())} ms.`;
  return lastChangedFile === undefined
    ? common
    : `
${common}
${dim("The last changed file was:")}
${dim(lastChangedFile.absolutePath)}
      `.trim();
}

function notInterestingElmFileChangedMessage(
  elmFile: AbsolutePath,
  event: WatcherEvent,
  disabledOutputs: HashSet<OutputPath>
): string {
  const what =
    disabledOutputs.size > 0 ? "any of the enabled outputs" : "anything";
  return `
FYI: An Elm file was ${event}, but it did not affect ${what}. The Elm file:
${dim(elmFile.absolutePath)}
  `.trim();
}
