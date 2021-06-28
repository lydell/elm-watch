import * as readline from "readline";

import * as ElmJson from "./ElmJson";
import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import { bold, Env, join } from "./Helpers";
import { walkImports, WalkImportsResult } from "./ImportWalker";
import { Logger } from "./Logger";
import { NonEmptyArray } from "./NonEmptyArray";
import { postprocess } from "./Postprocess";
import { OutputState, OutputStatus, Project } from "./Project";
import * as SpawnElm from "./SpawnElm";
import {
  ElmJsonPath,
  ElmToolingJsonPath,
  InputPath,
  OutputPath,
  outputPathToOriginalString,
  RunMode,
} from "./Types";

export type InstallDependenciesResult = { tag: "Error" } | { tag: "Success" };

// Make sure all dependencies are installed. Otherwise compilation sometimes
// fails when you’ve got multiple outputs for the same elm.json. The error is
// “not enough bytes”/“corrupt file” for `elm-stuff/0.19.1/{d,i,o}.dat`.
// This is done in sequence, in an attempt to avoid:
// - Downloading the same package twice.
// - Two Elm processes writing to `~/.elm` at the same time.
export async function installDependencies(
  env: Env,
  logger: Logger,
  project: Project
): Promise<InstallDependenciesResult> {
  const loadingMessageDelay = Number(
    env.__ELM_WATCH_LOADING_MESSAGE_DELAY ?? "100"
  );

  const elmJsonsArray = Array.from(project.elmJsons);

  for (const [index, [elmJsonPath]] of elmJsonsArray.entries()) {
    // Don’t print `(x/y)` the first time, because chances are all packages are
    // downloaded via the first elm.json and that looks nicer.
    const message = `Dependencies${
      index === 0 ? "" : ` (${index + 1}/${elmJsonsArray.length})`
    }`;

    const loadingMessage = logger.fancy
      ? `⏳ ${message}`
      : `${message}: in progress`;

    // Avoid printing `loadingMessage` if there’s nothing to download.
    let didWriteLoadingMessage = false;
    const timeoutId = setTimeout(() => {
      logger.error(loadingMessage);
      didWriteLoadingMessage = true;
    }, loadingMessageDelay);

    const clearLoadingMessage = (): void => {
      if (didWriteLoadingMessage && logger.raw.stderr.isTTY) {
        readline.moveCursor(logger.raw.stderr, 0, -1);
        readline.clearLine(logger.raw.stderr, 0);
      }
    };

    const onError = (
      error: Errors.ErrorTemplate
    ): InstallDependenciesResult => {
      clearLoadingMessage();
      logger.error(logger.fancy ? `🚨 ${message}` : `${message}: error`);
      logger.error("");
      logger.errorTemplate(error);
      return { tag: "Error" };
    };

    const result = await SpawnElm.install({ elmJsonPath, env });
    clearTimeout(timeoutId);

    switch (result.tag) {
      // If the elm.json is invalid we can just ignore that and let the “real”
      // compilation later catch it. This way we get colored error messages.
      case "ElmJsonError":
        if (didWriteLoadingMessage) {
          clearLoadingMessage();
          logger.error(logger.fancy ? `⛔️ ${message}` : `${message}: skipped`);
        }
        break;

      case "Success": {
        const gotOutput = result.elmInstallOutput !== "";
        if (didWriteLoadingMessage || gotOutput) {
          clearLoadingMessage();
          logger.error(logger.fancy ? `✅ ${message}` : `${message}: success`);
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

  return { tag: "Success" };
}

export async function compileOneOutput({
  env,
  logger,
  runMode,
  elmToolingJsonPath,
  elmJsonPath,
  outputPath,
  outputState,
  index,
  total,
}: {
  env: Env;
  logger: Logger;
  runMode: RunMode;
  elmToolingJsonPath: ElmToolingJsonPath;
  elmJsonPath: ElmJsonPath;
  outputPath: OutputPath;
  outputState: OutputState;
  index: number;
  total: number;
}): Promise<void> {
  let hasPrintedStatusLine = false;
  const updateStatusLine = (): void => {
    const shouldMoveCursor = logger.raw.stderr.isTTY && hasPrintedStatusLine;
    if (shouldMoveCursor) {
      readline.moveCursor(logger.raw.stderr, 0, -total + index);
      readline.clearLine(logger.raw.stderr, 0);
    }
    logger.error(
      statusLine(
        outputPath,
        outputState.status,
        logger.raw.stderrColumns,
        logger.fancy
      )
    );
    if (shouldMoveCursor) {
      readline.moveCursor(logger.raw.stderr, 0, total - index - 1);
    }
    hasPrintedStatusLine = true;
  };

  if (!outputState.dirty) {
    updateStatusLine();
    return;
  }

  // Watcher events that happen while waiting for `elm make` and
  // postprocessing can flip `dirty` back to `true`.
  outputState.dirty = false;
  outputState.status = { tag: "ElmMake" };
  updateStatusLine();
  const [elmMakeResult, allRelatedElmFilePathsResult] = await Promise.all([
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
          return getAllRelatedElmFilePaths(elmJsonPath, outputState.inputs);
      }
    }),
  ]);
  if (outputState.dirty) {
    outputState.status = { tag: "Interrupted" };
    updateStatusLine();
    return;
  }
  if (
    elmMakeResult.tag === "Success" &&
    outputState.postprocess !== undefined
  ) {
    switch (allRelatedElmFilePathsResult?.tag) {
      case undefined:
        break;

      case "Success":
        outputState.allRelatedElmFilePaths =
          allRelatedElmFilePathsResult.allRelatedElmFilePaths;
        break;

      case "ImportWalkerFileSystemError":
      case "ElmJsonReadAsJsonError":
      case "ElmJsonDecodeError":
        outputState.allRelatedElmFilePaths = new Set();
        outputState.status = allRelatedElmFilePathsResult;
        updateStatusLine();
        return;
    }

    outputState.status = { tag: "Postprocess" };
    updateStatusLine();
    outputState.status = await postprocess({
      elmToolingJsonPath,
      mode: outputState.mode,
      output: outputPath,
      postprocessArray: outputState.postprocess,
      env,
    });
    if (outputState.dirty) {
      outputState.status = { tag: "Interrupted" };
    }
    updateStatusLine();
  } else {
    // If `elm make` failed, don’t bother with `getAllRelatedElmFilePaths` errors.
    outputState.status = elmMakeResult;
    updateStatusLine();
  }
}

export function printStatusLinesForElmJsonsErrors(
  logger: Logger,
  project: Project
): void {
  for (const { outputPath } of project.elmJsonsErrors) {
    logger.error(
      statusLine(
        outputPath,
        { tag: "ElmJsonsErrors" },
        logger.raw.stderrColumns,
        logger.fancy
      )
    );
  }
}

export function printErrors(
  logger: Logger,
  errors: NonEmptyArray<Errors.ErrorTemplate>
): void {
  const errorStrings = Array.from(
    new Set(errors.map((template) => template(logger.raw.stderrColumns)))
  );

  logger.error("");
  logger.error(join(errorStrings, "\n\n"));
  logger.error("");
  logger.error(
    `${logger.fancy ? "🚨 " : ""}${bold(errorStrings.length.toString())} error${
      errorStrings.length === 1 ? "" : "s"
    } found`
  );
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

    case "ElmMake":
      return truncate(`${fancy ? "⏳ " : ""}${output}: elm make`);

    case "Postprocess":
      return truncate(`${fancy ? "⏳ " : ""}${output}: postprocess`);

    case "Interrupted":
      return truncate(`${fancy ? "⏳ " : ""}${output}: interrupted`);

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

export function extractErrors(project: Project): Array<Errors.ErrorTemplate> {
  return [
    ...project.elmJsonsErrors.map(({ outputPath, error }) => {
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

    ...Array.from(project.elmJsons).flatMap(([elmJsonPath, outputs]) =>
      Array.from(outputs).flatMap(([outputPath, { status }]) => {
        switch (status.tag) {
          case "NotWrittenToDisk":
            return [];

          // istanbul ignore next
          case "ElmMake":
            return Errors.stuckInProgressState(outputPath, "elm make");

          // istanbul ignore next
          case "Postprocess":
            return Errors.stuckInProgressState(outputPath, "postprocess");

          // istanbul ignore next
          case "Interrupted":
            return Errors.stuckInProgressState(outputPath, "interrupted");

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
            return Errors.elmWatchNodeMissingScript(project.elmToolingJsonPath);

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

function getAllRelatedElmFilePaths(
  elmJsonPath: ElmJsonPath,
  inputs: NonEmptyArray<InputPath>
): ElmJson.ParseError | WalkImportsResult {
  const parseResult = ElmJson.readAndParse(elmJsonPath);

  switch (parseResult.tag) {
    case "Parsed":
      return walkImports(
        ElmJson.getSourceDirectories(elmJsonPath, parseResult.elmJson),
        inputs
      );

    default:
      return parseResult;
  }
}
