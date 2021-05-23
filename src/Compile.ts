import * as readline from "readline";

import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import { bold, Env, IS_WINDOWS, join } from "./Helpers";
import { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { postprocess } from "./Postprocess";
import * as SpawnElm from "./SpawnElm";
import { OutputStatus, State } from "./State";
import { OutputPath, outputPathToOriginalString } from "./Types";

export async function compile(
  env: Env,
  logger: Logger,
  state: State
): Promise<number> {
  const fancy = !IS_WINDOWS && !logger.raw.NO_COLOR;
  const isInteractive = logger.raw.stderr.isTTY;

  const elmJsonsArray = Array.from(state.elmJsons);

  // First make sure all packages are installed. Otherwise compilation sometimes
  // fails when you’ve got multiple outputs for the same elm.json. The error is
  // “not enough bytes”/“corrupt file” for `elm-stuff/0.19.1/{d,i,o}.dat`.
  // This is done in sequence, in an attempt to avoid:
  // - Downloading the same package twice.
  // - Two Elm processes writing to `~/.elm` at the same time.
  for (const [index, [elmJsonPath]] of elmJsonsArray.entries()) {
    // Don’t print `(x/y)` the first time, because chances are all packages are
    // downloaded via the first elm.json and that looks nicer.
    const message = `Download packages${
      index === 0 ? "" : ` (${index + 1}/${elmJsonsArray.length})`
    }`;

    const loadingMessage = fancy ? `⏳ ${message}` : `${message}: in progress`;

    // Avoid printing `loadingMessage` if there’s nothing to download.
    let didWriteLoadingMessage = false;
    const timeoutId = setTimeout(() => {
      logger.error(loadingMessage);
      didWriteLoadingMessage = true;
    }, 100);

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

  const toCompile = elmJsonsArray.flatMap(([elmJsonPath, outputs]) =>
    Array.from(
      outputs,
      ([outputPath, outputState]) =>
        [elmJsonPath, outputPath, outputState] as const
    )
  );

  const updateStatusLine = (
    outputPath: OutputPath,
    status: OutputStatus,
    index?: number
  ): void => {
    if (index !== undefined && isInteractive) {
      readline.moveCursor(logger.raw.stderr, 0, -toCompile.length + index);
      readline.clearLine(logger.raw.stderr, 0);
    }
    logger.error(
      statusLine(outputPath, status, logger.raw.stderrColumns, fancy)
    );
    if (index !== undefined && isInteractive) {
      readline.moveCursor(logger.raw.stderr, 0, toCompile.length - index - 1);
    }
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
    toCompile.map(async ([elmJsonPath, outputPath, outputState], index) => {
      outputState.status = { tag: "ElmMake" };
      updateStatusLine(outputPath, outputState.status);
      const elmMakeResult = await SpawnElm.make({
        elmJsonPath,
        mode: outputState.mode,
        inputs: outputState.inputs,
        output: outputPath,
        env,
      });
      if (
        elmMakeResult.tag === "Success" &&
        outputState.postprocess !== undefined
      ) {
        outputState.status = { tag: "Postprocess" };
        updateStatusLine(outputPath, outputState.status, index);
        outputState.status = await postprocess({
          elmJsonPath,
          mode: outputState.mode,
          output: outputPath,
          postprocessArray: outputState.postprocess,
          env,
        });
        updateStatusLine(outputPath, outputState.status, index);
      } else {
        outputState.status = elmMakeResult;
        updateStatusLine(outputPath, outputState.status, index);
      }
    })
  );

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

    case "ElmMake":
      return truncate(`${fancy ? "⏳ " : ""}${output}: elm make`);

    case "Postprocess":
      return truncate(`${fancy ? "⏳ " : ""}${output}: postprocess`);

    case "ElmNotFoundError":
    case "CommandNotFoundError":
    case "OtherSpawnError":
    case "UnexpectedElmMakeOutput":
    case "PostprocessNonZeroExit":
    case "ElmMakeJsonParseError":
    case "ElmMakeError":
    case "ElmJsonsErrors":
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
          case "ElmMake":
            return Errors.stuckInProgressState(outputPath, "elm make");

          // istanbul ignore next
          case "Postprocess":
            return Errors.stuckInProgressState(outputPath, "postprocess");

          case "Success":
            return [];

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
              status.command
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
        }
      })
    ),
  ];
}
