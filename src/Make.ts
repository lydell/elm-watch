import * as Compile from "./Compile";
import { Env } from "./Helpers";
import type { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { Project } from "./Project";
import { GetNow } from "./Types";

type MakeResult = { tag: "Error" } | { tag: "Success" };

export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  project: Project
): Promise<MakeResult> {
  const installResult = await Compile.installDependencies(env, logger, project);

  switch (installResult.tag) {
    case "Error":
      return { tag: "Error" };

    case "Success":
      // Continue below.
      break;
  }

  const initialOutputActions = Compile.getOutputActions({
    project,
    runMode: "make",
    includeInterrupted: true,
    prioritizedOutputs: "AllEqualPriority",
  });

  Compile.printStatusLinesForElmJsonsErrors(logger, project);

  // `make` uses “fail fast.” _One_ of these error categories are shown at a time:
  // 1. All elm.json errors.
  // 2. All `elm make` errors.
  // 3. First postprocess error (likely the same error for all of them (bad
  //    command), and they might be slow.)
  if (
    isNonEmptyArray(initialOutputActions.actions) &&
    !isNonEmptyArray(project.elmJsonsErrors)
  ) {
    Compile.printSpaceForOutputs(logger, initialOutputActions);

    await new Promise<void>((resolve, reject) => {
      const cycle = (outputActions: Compile.OutputActions): void => {
        for (const action of outputActions.actions) {
          Compile.handleOutputAction({
            env,
            logger,
            getNow,
            runMode: { tag: "make" },
            elmToolingJsonPath: project.elmToolingJsonPath,
            total: outputActions.total,
            action,
          }).then(() => {
            const nextOutputActions = getNextOutputActions(project);
            if (isNonEmptyArray(nextOutputActions.actions)) {
              cycle(nextOutputActions);
            } else if (nextOutputActions.numExecuting === 0) {
              resolve();
            }
          }, reject);
        }
      };
      cycle(initialOutputActions);
    });
  }

  const errors = Compile.extractErrors(project);

  if (isNonEmptyArray(errors)) {
    Compile.printErrors(logger, errors);
    return { tag: "Error" };
  }

  return { tag: "Success" };
}

function getNextOutputActions(project: Project): Compile.OutputActions {
  const nextOutputActions = Compile.getOutputActions({
    project,
    runMode: "make",
    includeInterrupted: true,
    prioritizedOutputs: "AllEqualPriority",
  });
  // Skip postprocess if there are any errors (fail fast).
  return nextOutputActions.numErrors > 0
    ? {
        ...nextOutputActions,
        actions: nextOutputActions.actions.filter(
          (action2) => action2.tag !== "NeedsPostprocess"
        ),
      }
    : nextOutputActions;
}
