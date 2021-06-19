import * as chokidar from "chokidar";
import * as path from "path";

import { compile } from "./Compile";
import * as ElmToolingJson from "./ElmToolingJson";
import * as Errors from "./Errors";
import { CLEAR, Env } from "./Helpers";
import type { Logger } from "./Logger";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { Cwd } from "./PathHelpers";
import * as State from "./State";
import type { CliArg, CompilationMode, OnIdle, RunMode } from "./Types";

export async function run(
  cwd: Cwd,
  env: Env,
  logger: Logger,
  onIdle: OnIdle | undefined,
  runMode: RunMode,
  args: Array<CliArg>
): Promise<number> {
  const restart = (): Promise<number> =>
    run(cwd, env, logger, onIdle, runMode, args);

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
      const parseArgsResult = parseArgs(runMode, args);

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

async function hot(
  env: Env,
  logger: Logger,
  onIdle: OnIdle | undefined,
  passedRestart: () => Promise<number>,
  state: State.State
): Promise<number> {
  return new Promise((resolve, reject) => {
    let currentCompile: Promise<void> | undefined = undefined;
    let panicked = false;

    const watcher = chokidar.watch(state.watchRoot.absolutePath, {
      ignoreInitial: true,
      ignored: ["**/elm-stuff/**", "**/node_modules/**"],
      disableGlobbing: true,
    });

    const panic = (error: Error): void => {
      panicked = true;
      reject(error);
    };

    const restart = (): void => {
      logger.raw.stderr.write(CLEAR);
      state.fullRestartRequested = true;
      Promise.all([watcher.close(), currentCompile]).then(() => {
        passedRestart().then(resolve, reject);
      }, panic);
    };

    const runCompile = (): void => {
      if (currentCompile === undefined) {
        logger.raw.stderr.write(CLEAR);
        currentCompile = compile(env, logger, "hot", state).then(() => {
          currentCompile = undefined;
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
      (event: "added" | "changed" | "removed") =>
      (absolutePathString: string): void => {
        if (state.fullRestartRequested || panicked) {
          return;
        }

        if (absolutePathString.endsWith(".elm")) {
          for (const [, outputs] of state.elmJsons) {
            for (const [, outputState] of outputs) {
              if (outputState.allRelatedElmFilePaths.has(absolutePathString)) {
                outputState.dirty = true;
              }
            }
          }
          if (State.someOutputIsDirty(state)) {
            runCompile();
            logger.error("Compiled!");
          } else {
            // TODO: Better log. Show which file? Overwrite previous. Show time? Also show time on last ran compilation (above).
            // Can show extra message if state.disabledOutputs isn’t empty
            logger.error(
              `An Elm file was ${event}, but it did not affect any enabled outputs.`
            );
          }
          return;
        }

        const basename = path.basename(absolutePathString);

        switch (basename) {
          case "elm-tooling.json":
            switch (event) {
              case "added":
                restart();
                return;

              case "changed":
              case "removed":
                if (
                  absolutePathString ===
                  state.elmToolingJsonPath.theElmToolingJsonPath.absolutePath
                ) {
                  restart();
                }
                return;
            }

          case "elm.json":
            switch (event) {
              case "added":
                restart();
                return;

              case "changed": {
                for (const [elmJsonPath, outputs] of state.elmJsons) {
                  if (
                    absolutePathString ===
                    elmJsonPath.theElmJsonPath.absolutePath
                  ) {
                    state.hasRunInstall = false;
                    for (const [, outputState] of outputs) {
                      outputState.dirty = true;
                    }
                  }
                }
                if (!state.hasRunInstall) {
                  runCompile();
                  logger.error("Compiled!");
                }
                return;
              }

              case "removed":
                if (
                  Array.from(state.elmJsons).some(
                    ([elmJsonPath]) =>
                      absolutePathString ===
                      elmJsonPath.theElmJsonPath.absolutePath
                  )
                ) {
                  restart();
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

type ParseArgsResult =
  | {
      tag: "BadArgs";
      badArgs: NonEmptyArray<CliArg>;
    }
  | {
      tag: "Success";
      compilationMode: CompilationMode;
      outputs: Array<string>;
    }
  | { tag: "DebugOptimizeClash" }
  | { tag: "DebugOptimizeForHot" };

function parseArgs(runMode: RunMode, args: Array<CliArg>): ParseArgsResult {
  let debug = false;
  let optimize = false;
  const badArgs: Array<CliArg> = [];
  const outputs: Array<string> = [];

  for (const arg of args) {
    switch (arg.theArg) {
      case "--debug":
        debug = true;
        break;

      case "--optimize":
        optimize = true;
        break;

      default:
        if (ElmToolingJson.isValidOutputName(arg.theArg)) {
          outputs.push(arg.theArg);
        } else {
          badArgs.push(arg);
        }
    }
  }

  switch (runMode) {
    case "hot":
      if (debug || optimize) {
        return { tag: "DebugOptimizeForHot" };
      }
      break;

    case "make":
      if (debug && optimize) {
        return { tag: "DebugOptimizeClash" };
      }
      break;
  }

  if (isNonEmptyArray(badArgs)) {
    return {
      tag: "BadArgs",
      badArgs,
    };
  }

  return {
    tag: "Success",
    compilationMode: debug ? "debug" : optimize ? "optimize" : "standard",
    outputs,
  };
}
