import * as Compile from "./Compile";
import { Env } from "./Helpers";
import type { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { getFlatOutputs, Project } from "./Project";
import { RunMode } from "./Types";

type MakeResult = { tag: "Error" } | { tag: "Success" };

export async function run(
  env: Env,
  logger: Logger,
  runMode: RunMode,
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

  const flatOutputs = getFlatOutputs(project);

  Compile.printStatusLinesForElmJsonsErrors(logger, project);

  await Promise.all(
    flatOutputs.map(
      async ({ index, elmJsonPath, outputPath, outputState }): Promise<void> =>
        Compile.compileOneOutput({
          env,
          logger,
          runMode,
          elmToolingJsonPath: project.elmToolingJsonPath,
          elmJsonPath,
          outputPath,
          outputState,
          index,
          total: flatOutputs.length,
        })
    )
  );

  const errors = Compile.extractErrors(project);

  if (isNonEmptyArray(errors)) {
    Compile.printErrors(logger, errors);
    return { tag: "Error" };
  }

  return { tag: "Success" };
}
