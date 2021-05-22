import * as readline from "readline";

import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import { bold, Env, IS_WINDOWS, join } from "./helpers";
import { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { postprocess } from "./postprocess";
import * as SpawnElm from "./SpawnElm";
import { OutputStatus, State } from "./State";
import { OutputPath, outputPathToOriginalString } from "./types";

export async function compile(
  env: Env,
  logger: Logger,
  state: State
): Promise<number> {
  const toCompile = Array.from(state.elmJsons).flatMap(
    ([elmJsonPath, outputs]) =>
      Array.from(
        outputs,
        ([outputPath, outputState]) =>
          [elmJsonPath, outputPath, outputState] as const
      )
  );

  const fancy = !IS_WINDOWS && !logger.raw.NO_COLOR;
  const isInteractive = logger.raw.stderr.isTTY;

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
      statusLine(outputPath, status, logger.raw.stderr.columns, fancy)
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
        logger.raw.stderr.columns,
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

  logger.error("");
  logger.error(
    join(
      Array.from(
        new Set(errors.map((template) => template(logger.raw.stderr.columns)))
      ),
      "\n\n"
    )
  );
  logger.error("");
  logger.error(
    `${fancy ? "🚨 " : ""}${bold(errors.length.toString())} error${
      errors.length === 1 ? "" : "s"
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
