import * as readline from "readline";

import * as ElmJson from "./ElmJson";
import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import {
  bold,
  Env,
  IS_WINDOWS,
  join,
  sleep,
  WATCHER_SLEEP_MS,
} from "./Helpers";
import { walkImports } from "./ImportWalker";
import { Logger } from "./Logger";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { postprocess } from "./Postprocess";
import * as SpawnElm from "./SpawnElm";
import { OutputState, OutputStatus, State } from "./State";
import {
  ElmJsonPath,
  InputPath,
  OutputPath,
  outputPathToOriginalString,
  RunMode,
} from "./Types";

export async function compile(
  env: Env,
  logger: Logger,
  runMode: RunMode,
  state: State
): Promise<number> {
  const fancy = !IS_WINDOWS && !logger.raw.NO_COLOR;
  const isInteractive = logger.raw.stderr.isTTY;
  const loadingMessageDelay = Number(
    env.__ELM_WATCH_LOADING_MESSAGE_DELAY ?? "100"
  );

  const elmJsonsArray = Array.from(state.elmJsons);

  // First make sure all packages are installed. Otherwise compilation sometimes
  // fails when you’ve got multiple outputs for the same elm.json. The error is
  // “not enough bytes”/“corrupt file” for `elm-stuff/0.19.1/{d,i,o}.dat`.
  // This is done in sequence, in an attempt to avoid:
  // - Downloading the same package twice.
  // - Two Elm processes writing to `~/.elm` at the same time.
  if (!state.hasRunInstall) {
    for (const [index, [elmJsonPath]] of elmJsonsArray.entries()) {
      // Don’t print `(x/y)` the first time, because chances are all packages are
      // downloaded via the first elm.json and that looks nicer.
      const message = `Dependencies${
        index === 0 ? "" : ` (${index + 1}/${elmJsonsArray.length})`
      }`;

      const loadingMessage = fancy
        ? `⏳ ${message}`
        : `${message}: in progress`;

      // Avoid printing `loadingMessage` if there’s nothing to download.
      let didWriteLoadingMessage = false;
      const timeoutId = setTimeout(() => {
        logger.error(loadingMessage);
        didWriteLoadingMessage = true;
      }, loadingMessageDelay);

      const clearLoadingMessage = (): void => {
        if (didWriteLoadingMessage && isInteractive) {
          readline.moveCursor(logger.raw.stderr, 0, -1);
          readline.clearLine(logger.raw.stderr, 0);
        }
      };

      const onError = (error: Errors.ErrorTemplate): number => {
        clearLoadingMessage();
        logger.error(fancy ? `🚨 ${message}` : `${message}: error`);
        logger.error("");
        logger.errorTemplate(error);
        return 1;
      };

      const result = await SpawnElm.install({ elmJsonPath, env });
      clearTimeout(timeoutId);

      switch (result.tag) {
        // If the elm.json is invalid we can just ignore that and let the “real”
        // compilation later catch it. This way we get colored error messages.
        case "ElmJsonError":
          if (didWriteLoadingMessage) {
            clearLoadingMessage();
            logger.error(fancy ? `⛔️ ${message}` : `${message}: skipped`);
          }
          break;

        case "Success": {
          const gotOutput = result.elmInstallOutput !== "";
          if (didWriteLoadingMessage || gotOutput) {
            clearLoadingMessage();
            logger.error(fancy ? `✅ ${message}` : `${message}: success`);
          }
          if (gotOutput) {
            logger.error(result.elmInstallOutput);
          }
          break;
        }

        case "CreatingDummyFailed":
          return onError(Errors.creatingDummyFailed(elmJsonPath, result.error));

        case "ElmNotFoundError":
          return onError(Errors.elmNotFoundError(elmJsonPath, result.command));

        // istanbul ignore next
        case "OtherSpawnError":
          return onError(
            Errors.otherSpawnError(elmJsonPath, result.error, result.command)
          );

        case "ElmInstallError":
          return onError(
            Errors.elmInstallError(elmJsonPath, result.title, result.message)
          );

        case "UnexpectedElmInstallOutput":
          return onError(
            Errors.unexpectedElmInstallOutput(
              elmJsonPath,
              result.exitReason,
              result.stdout,
              result.stderr,
              result.command
            )
          );
      }
    }
    state.hasRunInstall = true;
    if (state.fullRestartRequested) {
      return 0;
    }
  }

  const toCompile = elmJsonsArray.flatMap(([elmJsonPath, outputs]) =>
    Array.from(
      outputs,
      ([outputPath, outputState]) =>
        [elmJsonPath, outputPath, outputState] as const
    )
  );

  let highestSeenIndex = -1;
  const updateStatusLine = (
    outputPath: OutputPath,
    status: OutputStatus,
    index: number
  ): void => {
    const shouldMoveCursor = isInteractive && index <= highestSeenIndex;
    if (shouldMoveCursor) {
      readline.moveCursor(logger.raw.stderr, 0, -toCompile.length + index);
      readline.clearLine(logger.raw.stderr, 0);
    }
    logger.error(
      statusLine(outputPath, status, logger.raw.stderrColumns, fancy)
    );
    if (shouldMoveCursor) {
      readline.moveCursor(logger.raw.stderr, 0, toCompile.length - index - 1);
    }
    highestSeenIndex = Math.max(highestSeenIndex, index);
  };

  for (const { outputPath } of state.elmJsonsErrors) {
    logger.error(
      statusLine(
        outputPath,
        { tag: "ElmJsonsErrors" },
        logger.raw.stderrColumns,
        fancy
      )
    );
  }

  await Promise.all(
    toCompile.map(
      async (
        [elmJsonPath, outputPath, outputState],
        index: number
      ): Promise<void> => {
        if (!outputState.dirty) {
          updateStatusLine(outputPath, outputState.status, index);
        }
        while (outputState.dirty) {
          // Watcher events that happen while waiting for `elm make` and
          // postprocessing can flip `dirty` back to `true`.
          outputState.dirty = false;
          switch (runMode) {
            case "make":
              break;
            case "hot":
              // Sleep for a little bit in hot mode to avoid unnecessary
              // recompilation when using “save all” in an editor, or when
              // running `git switch some-branch` or `git restore .`. These
              // operations results in many files being added/changed/deleted,
              // usually with 0-1 ms between each event.
              outputState.status = { tag: "Sleep" };
              updateStatusLine(outputPath, outputState.status, index);
              await sleep(WATCHER_SLEEP_MS);
              if (state.fullRestartRequested) {
                return;
              }
              if (outputState.dirty) {
                continue;
              }
              break;
          }
          outputState.status = { tag: "ElmMake" };
          updateStatusLine(outputPath, outputState.status, index);
          const [elmMakeResult] = await Promise.all([
            SpawnElm.make({
              elmJsonPath,
              mode: outputState.mode,
              inputs: outputState.inputs,
              output: outputPath,
              env,
            }),
            Promise.resolve().then(() => {
              switch (runMode) {
                case "make":
                  return;
                case "hot":
                  // Note: It doesn’t matter if a file changes before we’ve had
                  // chance to compute this the first time (during packages
                  // installation or `elm make` above). Everything is marked as
                  // dirty by default anyway and will get compiled.
                  updateAllRelatedElmFilePaths(
                    elmJsonPath,
                    outputState.inputs,
                    outputState
                  );
                  return;
              }
            }),
          ]);
          if (state.fullRestartRequested) {
            return;
          }
          if (outputState.dirty) {
            continue;
          }
          if (
            elmMakeResult.tag === "Success" &&
            outputState.postprocess !== undefined
          ) {
            outputState.status = { tag: "Postprocess" };
            updateStatusLine(outputPath, outputState.status, index);
            outputState.status = await postprocess({
              elmToolingJsonPath: state.elmToolingJsonPath,
              mode: outputState.mode,
              output: outputPath,
              postprocessArray: outputState.postprocess,
              env,
            });
            if (state.fullRestartRequested) {
              return;
            }
            if (outputState.dirty) {
              continue;
            }
            updateStatusLine(outputPath, outputState.status, index);
          } else {
            outputState.status = elmMakeResult;
            updateStatusLine(outputPath, outputState.status, index);
          }
        }
      }
    )
  );

  if (state.fullRestartRequested) {
    return 0;
  }

  const errors = extractErrors(state);

  if (!isNonEmptyArray(errors)) {
    return 0;
  }

  const errorStrings = Array.from(
    new Set(errors.map((template) => template(logger.raw.stderrColumns)))
  );

  logger.error("");
  logger.error(join(errorStrings, "\n\n"));
  logger.error("");
  logger.error(
    `${fancy ? "🚨 " : ""}${bold(errorStrings.length.toString())} error${
      errorStrings.length === 1 ? "" : "s"
    } found`
  );

  return 1;
}

function statusLine(
  outputPath: OutputPath,
  status: OutputStatus | { tag: "ElmJsonsErrors" },
  maxWidth: number,
  fancy: boolean
): string {
  const output = outputPathToOriginalString(outputPath);

  const truncate = (string: string): string => {
    // Emojis take two terminal columns.
    const length = fancy ? string.length + 1 : string.length;
    return length <= maxWidth
      ? string
      : fancy
      ? // Again, account for the emoji.
        `${string.slice(0, maxWidth - 2)}…`
      : `${string.slice(0, maxWidth - 3)}...`;
  };

  switch (status.tag) {
    case "NotWrittenToDisk":
    case "Success":
      return truncate(fancy ? `✅ ${output}` : `${output}: success`);

    case "Sleep":
      return truncate(`${fancy ? "⏳ " : ""}${output}`);

    case "ElmMake":
      return truncate(`${fancy ? "⏳ " : ""}${output}: elm make`);

    case "Postprocess":
      return truncate(`${fancy ? "⏳ " : ""}${output}: postprocess`);

    case "ElmNotFoundError":
    case "CommandNotFoundError":
    case "OtherSpawnError":
    case "UnexpectedElmMakeOutput":
    case "PostprocessNonZeroExit":
    case "ElmWatchNodeMissingScript":
    case "ElmWatchNodeImportError":
    case "ElmWatchNodeDefaultExportNotFunction":
    case "ElmWatchNodeRunError":
    case "ElmWatchNodeResultDecodeError":
    case "StdoutDecodeError":
    case "ElmMakeJsonParseError":
    case "ElmMakeError":
    case "ElmJsonsErrors":
    case "ElmJsonReadAsJsonError":
    case "ElmJsonDecodeError":
    case "ImportWalkerFileSystemError":
      return truncate(fancy ? `🚨 ${output}` : `${output}: error`);
  }
}

function extractErrors(state: State): Array<Errors.ErrorTemplate> {
  return [
    ...state.elmJsonsErrors.map(({ outputPath, error }) => {
      switch (error.tag) {
        case "ElmJsonNotFound":
          return Errors.elmJsonNotFound(
            outputPath,
            error.elmJsonNotFound,
            error.foundElmJsonPaths
          );

        case "NonUniqueElmJsonPaths":
          return Errors.nonUniqueElmJsonPaths(
            outputPath,
            error.nonUniqueElmJsonPaths
          );

        case "InputsNotFound":
          return Errors.inputsNotFound(outputPath, error.inputsNotFound);

        case "InputsFailedToResolve":
          return Errors.inputsFailedToResolve(
            outputPath,
            error.inputsFailedToResolve
          );

        case "DuplicateInputs":
          return Errors.duplicateInputs(outputPath, error.duplicates);
      }
    }),

    ...Array.from(state.elmJsons).flatMap(([elmJsonPath, outputs]) =>
      Array.from(outputs).flatMap(([outputPath, { status }]) => {
        switch (status.tag) {
          case "NotWrittenToDisk":
            return [];

          // istanbul ignore next
          case "Sleep":
            return Errors.stuckInProgressState(outputPath, "sleep");

          // istanbul ignore next
          case "ElmMake":
            return Errors.stuckInProgressState(outputPath, "elm make");

          // istanbul ignore next
          case "Postprocess":
            return Errors.stuckInProgressState(outputPath, "postprocess");

          case "Success":
            return [];

          // istanbul ignore next
          case "ElmNotFoundError":
            return Errors.elmNotFoundError(outputPath, status.command);

          case "CommandNotFoundError":
            return Errors.commandNotFoundError(outputPath, status.command);

          // istanbul ignore next
          case "OtherSpawnError":
            return Errors.otherSpawnError(
              outputPath,
              status.error,
              status.command
            );

          case "UnexpectedElmMakeOutput":
            return Errors.unexpectedElmMakeOutput(
              outputPath,
              status.exitReason,
              status.stdout,
              status.stderr,
              status.command
            );

          case "PostprocessNonZeroExit":
            return Errors.postprocessNonZeroExit(
              outputPath,
              status.exitReason,
              status.stdout,
              status.stderr,
              status.executedCommand
            );

          case "ElmWatchNodeMissingScript":
            return Errors.elmWatchNodeMissingScript(state.elmToolingJsonPath);

          case "ElmWatchNodeImportError":
            return Errors.elmWatchNodeImportError(
              status.scriptPath,
              status.error
            );

          case "ElmWatchNodeDefaultExportNotFunction":
            return Errors.elmWatchNodeDefaultExportNotFunction(
              status.scriptPath,
              status.imported
            );

          case "ElmWatchNodeRunError":
            return Errors.elmWatchNodeRunError(
              status.scriptPath,
              status.args,
              status.error
            );

          case "ElmWatchNodeResultDecodeError":
            return Errors.elmWatchNodeResultDecodeError(
              status.scriptPath,
              status.args,
              status.error
            );

          case "StdoutDecodeError":
            return Errors.stdoutDecodeError(
              status.error,
              status.executedCommand
            );

          case "ElmMakeJsonParseError":
            return Errors.elmMakeJsonParseError(
              outputPath,
              status.error,
              status.jsonPath,
              status.command
            );

          case "ElmMakeError":
            switch (status.error.tag) {
              case "GeneralError":
                return ElmMakeError.renderGeneralError(
                  outputPath,
                  elmJsonPath,
                  status.error
                );

              case "CompileErrors":
                return status.error.errors.flatMap((error) =>
                  error.problems.map((problem) =>
                    ElmMakeError.renderProblem(error.path, problem)
                  )
                );
            }

          case "ElmJsonReadAsJsonError":
            return Errors.readElmJsonAsJson(status.elmJsonPath, status.error);

          case "ElmJsonDecodeError":
            return Errors.decodeElmJson(status.elmJsonPath, status.error);

          case "ImportWalkerFileSystemError":
            return Errors.importWalkerFileSystemError(outputPath, status.error);
        }
      })
    ),
  ];
}

function updateAllRelatedElmFilePaths(
  elmJsonPath: ElmJsonPath,
  inputs: NonEmptyArray<InputPath>,
  outputState: OutputState
): void {
  const parseResult = ElmJson.readAndParse(elmJsonPath);

  switch (parseResult.tag) {
    case "Parsed": {
      const importWalkerResult = walkImports(
        ElmJson.getSourceDirectories(elmJsonPath, parseResult.elmJson),
        inputs
      );

      switch (importWalkerResult.tag) {
        case "Success":
          outputState.allRelatedElmFilePaths =
            importWalkerResult.allRelatedElmFilePaths;
          return;

        case "FileSystemError":
          outputState.allRelatedElmFilePaths = new Set();
          outputState.status = {
            tag: "ImportWalkerFileSystemError",
            error: importWalkerResult.error,
          };
          return;
      }
    }

    default:
      outputState.allRelatedElmFilePaths = new Set();
      outputState.status = parseResult;
      return;
  }
}
