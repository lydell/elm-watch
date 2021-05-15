import * as ElmMakeError from "./ElmMakeError";
import * as Errors from "./Errors";
import { join } from "./helpers";
import { Logger } from "./Logger";
import { isNonEmptyArray, mapNonEmptyArray } from "./NonEmptyArray";
import * as SpawnElm from "./SpawnElm";
import { State } from "./State";
import { OutputPath, outputPathToString } from "./types";

export async function run(logger: Logger, state: State): Promise<number> {
  await Promise.all(
    Array.from(state.elmJsons).flatMap(([elmJsonPath, outputs]) =>
      Array.from(outputs, ([outputPath, outputState]) =>
        SpawnElm.make({
          elmJsonPath,
          mode: outputState.mode,
          inputs: mapNonEmptyArray(
            outputState.inputs,
            ({ inputPath }) => inputPath
          ),
          output: outputPath,
        }).then((result) => {
          outputState.status = result;
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
            `${outputPathToString(outputPath)}\n${message}`
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
    for (const [outputPath, outputState] of outputs) {
      switch (outputState.status.tag) {
        case "NotWrittenToDisk":
          break;

        case "Success":
          summary.succeeded.push(outputPath);
          break;

        case "ElmNotFoundError":
          summary.failed.push(outputPath);
          summary.messages.push({ outputPath, message: "TODO" });
          break;

        case "OtherSpawnError":
          summary.failed.push(outputPath);
          summary.messages.push({ outputPath, message: "TODO" });
          break;

        case "UnexpectedOutput":
          summary.failed.push(outputPath);
          summary.messages.push({ outputPath, message: "TODO" });
          break;

        case "JsonParseError":
          summary.failed.push(outputPath);
          summary.messages.push({ outputPath, message: "TODO" });
          break;

        case "DecodeError":
          summary.failed.push(outputPath);
          summary.messages.push({ outputPath, message: "TODO" });
          break;

        case "ElmMakeError":
          summary.failed.push(outputPath);

          switch (outputState.status.error.tag) {
            case "GeneralError":
              summary.messages.push({
                outputPath,
                message: ElmMakeError.renderGeneralError(
                  elmJsonPath,
                  outputState.status.error
                ),
              });
              break;

            case "CompileErrors":
              for (const error of outputState.status.error.errors) {
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
    ? [label, ...paths.map(outputPathToString)]
    : [];
}
