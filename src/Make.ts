import * as Compile from "./Compile";
import { Env } from "./Helpers";
import type { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { getOutputActions, OutputActions, Project } from "./Project";
import { GetNow } from "./Types";

type MakeResult = { tag: "Error" } | { tag: "Success" };

export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  project: Project,
  maxParallel: number
): Promise<MakeResult> {
  const installResult = await Compile.installDependencies(env, logger, project);

  switch (installResult.tag) {
    case "Error":
      return { tag: "Error" };

    case "Success":
      // Continue below.
      break;
  }

  const initialOutputActions = getOutputActions(project, "make", maxParallel);

  Compile.printStatusLinesForElmJsonsErrors(logger, project);
  Compile.printSpaceForOutputs(logger, initialOutputActions.total);

  await new Promise<void>((resolve, reject) => {
    const cycle = (outputActions: OutputActions): void => {
      for (const action of outputActions.actions) {
        Compile.handleOutputAction({
          env,
          logger,
          getNow,
          runMode: "make",
          elmToolingJsonPath: project.elmToolingJsonPath,
          total: outputActions.total,
          action,
        }).then(() => {
          const nextOutputActions = getOutputActions(
            project,
            "make",
            maxParallel
          );
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

  const errors = Compile.extractErrors(project);

  if (isNonEmptyArray(errors)) {
    Compile.printErrors(logger, errors);
    return { tag: "Error" };
  }

  return { tag: "Success" };
}
