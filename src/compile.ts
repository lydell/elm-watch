import * as readline from "readline";

import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import { Env, IS_WINDOWS, join } from "./helpers";
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

  const updateStatusLine = (
    outputPath: OutputPath,
    status: OutputStatus,
    index?: number
  ): void => {
    if (index !== undefined) {
      readline.moveCursor(logger.raw.stdout, 0, -toCompile.length + index);
      readline.clearLine(logger.raw.stdout, 0);
    }
    logger.log(
      statusLine(outputPath, status, logger.raw.stdout.columns, fancy)
    );
    if (index !== undefined) {
      readline.moveCursor(logger.raw.stdout, 0, toCompile.length - index - 1);
    }
  };

  await Promise.all(
    toCompile.map(([elmJsonPath, outputPath, outputState], index) => {
      outputState.status = { tag: "ElmMake" };
      updateStatusLine(outputPath, outputState.status);
      return SpawnElm.make({
        elmJsonPath,
        mode: outputState.mode,
        inputs: outputState.inputs,
        output: outputPath,
        env,
      }).then((elmMakeResult) => {
        if (
          elmMakeResult.tag === "Success" &&
          outputState.postprocess !== undefined
        ) {
          outputState.status = { tag: "Postprocess" };
          updateStatusLine(outputPath, outputState.status, index);
          return postprocess({
            elmJsonPath,
            mode: outputState.mode,
            output: outputPath,
            postprocessArray: outputState.postprocess,
            env,
          }).then((postprocessResult) => {
            outputState.status = postprocessResult;
          });
        } else {
          outputState.status = elmMakeResult;
          updateStatusLine(outputPath, outputState.status, index);
          return undefined;
        }
      });
    })
  );

  const summary = summarize(state);

  logger.error(
    join(
      [
        ...summary.messages.map(
          ({ outputPath, message }) =>
            `${outputPathToOriginalString(outputPath)}\n${message}`
        ),
        ...summary.compileErrors,
      ],
      "\n\n\n"
    )
  );

  return isNonEmptyArray(summary.messages) || summary.compileErrors.size > 0
    ? 1
    : 0;
}

function statusLine(
  outputPath: OutputPath,
  status: OutputStatus,
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
      return truncate(fancy ? `🚨 ${output}` : `${output}: error`);
  }
}

type Summary = {
  messages: Array<{ outputPath: OutputPath; message: string }>;
  compileErrors: Set<string>;
};

function summarize(state: State): Summary {
  const summary: Summary = {
    messages: [],
    compileErrors: new Set(),
  };

  for (const { outputPath, error } of state.elmJsonsErrors) {
    switch (error.tag) {
      case "ElmJsonNotFound":
        summary.messages.push({
          outputPath,
          message: Errors.elmJsonNotFound(
            error.elmJsonNotFound,
            error.foundElmJsonPaths
          ),
        });
        break;

      case "NonUniqueElmJsonPaths":
        summary.messages.push({
          outputPath,
          message: Errors.nonUniqueElmJsonPaths(error.nonUniqueElmJsonPaths),
        });
        break;

      case "InputsNotFound":
        summary.messages.push({
          outputPath,
          message: Errors.inputsNotFound(error.inputsNotFound),
        });
        break;

      case "InputsFailedToResolve":
        summary.messages.push({
          outputPath,
          message: Errors.inputsFailedToResolve(error.inputsFailedToResolve),
        });
        break;

      case "DuplicateInputs":
        summary.messages.push({
          outputPath,
          message: Errors.duplicateInputs(error.duplicates),
        });
        break;
    }
  }

  for (const [elmJsonPath, outputs] of state.elmJsons) {
    for (const [outputPath, { status }] of outputs) {
      switch (status.tag) {
        case "NotWrittenToDisk":
          break;

        case "ElmMake":
          summary.messages.push({
            outputPath,
            message: Errors.stuckInProgressState("elm make"),
          });
          break;

        case "Postprocess":
          summary.messages.push({
            outputPath,
            message: Errors.stuckInProgressState("postprocess"),
          });
          break;

        case "Success":
          break;

        case "ElmNotFoundError":
          summary.messages.push({
            outputPath,
            message: Errors.elmNotFoundError(status.command),
          });
          break;

        case "CommandNotFoundError":
          summary.messages.push({
            outputPath,
            message: Errors.commandNotFoundError(status.command),
          });
          break;

        case "OtherSpawnError":
          summary.messages.push({
            outputPath,
            message: Errors.otherSpawnError(status.error, status.command),
          });
          break;

        case "UnexpectedElmMakeOutput":
          summary.messages.push({
            outputPath,
            message: Errors.unexpectedElmMakeOutput(
              status.exitReason,
              status.stdout,
              status.stderr,
              status.command
            ),
          });
          break;

        case "PostprocessNonZeroExit":
          summary.messages.push({
            outputPath,
            message: Errors.postprocessNonZeroExit(
              status.exitReason,
              status.stdout,
              status.stderr,
              status.command
            ),
          });
          break;

        case "ElmMakeJsonParseError":
          summary.messages.push({
            outputPath,
            message: Errors.elmMakeJsonParseError(
              status.error,
              status.jsonPath,
              status.command
            ),
          });
          break;

        case "ElmMakeError":
          switch (status.error.tag) {
            case "GeneralError":
              summary.messages.push({
                outputPath,
                message: ElmMakeError.renderGeneralError(
                  elmJsonPath,
                  status.error
                ),
              });
              break;

            case "CompileErrors":
              for (const error of status.error.errors) {
                for (const problem of error.problems) {
                  summary.compileErrors.add(
                    ElmMakeError.renderProblem(error.path, problem)
                  );
                }
              }
              break;
          }
          break;
      }
    }
  }

  return summary;
}
