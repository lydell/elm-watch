import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import { Env, join } from "./helpers";
import { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { postprocess } from "./postprocess";
import * as SpawnElm from "./SpawnElm";
import { State } from "./State";
import { OutputPath, outputPathToOriginalString } from "./types";

export async function compile(
  env: Env,
  logger: Logger,
  state: State
): Promise<number> {
  await Promise.all(
    Array.from(state.elmJsons).flatMap(([elmJsonPath, outputs]) =>
      Array.from(outputs, ([outputPath, outputState]) =>
        SpawnElm.make({
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
            return undefined;
          }
        })
      )
    )
  );

  const summary = summarize(state);

  logger.log(
    join(
      [
        ...summary.messages.map(
          ({ outputPath, message }) =>
            `${outputPathToOriginalString(outputPath)}\n${message}`
        ),
        ...summary.compileErrors,
        ...printOutputPaths("Succeeded:", summary.succeeded),
        ...printOutputPaths("Failed:", summary.failed),
      ],
      "\n\n\n"
    )
  );

  return isNonEmptyArray(summary.failed) ? 1 : 0;
}

type Summary = {
  succeeded: Array<OutputPath>;
  failed: Array<OutputPath>;
  messages: Array<{ outputPath: OutputPath; message: string }>;
  compileErrors: Set<string>;
};

function summarize(state: State): Summary {
  const summary: Summary = {
    succeeded: [],
    failed: [],
    messages: [],
    compileErrors: new Set(),
  };

  for (const { outputPath, error } of state.elmJsonsErrors) {
    summary.failed.push(outputPath);

    switch (error.tag) {
      case "ElmJsonNotFound":
        summary.messages.push({
          outputPath,
          message: Errors.elmJsonNotFound(error.elmJsonNotFound),
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

        case "Success":
          summary.succeeded.push(outputPath);
          break;

        case "ElmNotFoundError":
          summary.failed.push(outputPath);
          summary.messages.push({
            outputPath,
            message: Errors.elmNotFoundError(status.command),
          });
          break;

        case "CommandNotFoundError":
          summary.failed.push(outputPath);
          summary.messages.push({
            outputPath,
            message: Errors.commandNotFoundError(status.command),
          });
          break;

        case "OtherSpawnError":
          summary.failed.push(outputPath);
          summary.messages.push({
            outputPath,
            message: Errors.otherSpawnError(status.error, status.command),
          });
          break;

        case "UnexpectedElmMakeOutput":
          summary.failed.push(outputPath);
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
          summary.failed.push(outputPath);
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
          summary.failed.push(outputPath);
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
          summary.failed.push(outputPath);

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

function printOutputPaths(
  label: string,
  paths: Array<OutputPath>
): Array<string> {
  return isNonEmptyArray(paths)
    ? [label, ...paths.map(outputPathToOriginalString)]
    : [];
}
