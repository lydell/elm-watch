import * as Compile from "./Compile";
import { Env } from "./Helpers";
import type { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { Project } from "./Project";
import { RunMode } from "./Types";

export async function run(
  env: Env,
  logger: Logger,
  runMode: RunMode,
  project: Project
): Promise<number> {
  const installResult = await Compile.installDependencies(env, logger, project);

  switch (installResult.tag) {
    case "Error":
      return 1;

    case "Success":
      // Continue below.
      break;
  }

  const toCompile = Array.from(project.elmJsons).flatMap(
    ([elmJsonPath, outputs]) =>
      Array.from(
        outputs,
        ([outputPath, outputState]) =>
          [elmJsonPath, outputPath, outputState] as const
      )
  );

  Compile.printStatusLinesForElmJsonsErrors(logger, project);

  await Promise.all(
    toCompile.map(
      async (
        [elmJsonPath, outputPath, outputState],
        index: number
      ): Promise<void> =>
        Compile.compileOneOutput({
          env,
          logger,
          runMode,
          elmToolingJsonPath: project.elmToolingJsonPath,
          elmJsonPath,
          outputPath,
          outputState,
          index,
          total: toCompile.length,
        })
    )
  );

  const errors = Compile.extractErrors(project);

  if (isNonEmptyArray(errors)) {
    Compile.printErrors(logger, errors);
    return 1;
  }

  return 0;
}
