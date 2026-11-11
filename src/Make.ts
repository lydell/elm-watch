import * as Compile from "./Compile.ts";
import type { Env } from "./Env.ts";
import { getSnapshot } from "./ExternalErrors.ts";
import { bold, printDurationMs } from "./Helpers.ts";
import type { Logger, LoggerConfig } from "./Logger.ts";
import { isNonEmptyArray } from "./NonEmptyArray.ts";
import type { Project } from "./Project.ts";
import type { GetNow } from "./Types.ts";

type MakeResult = { tag: "Error" } | { tag: "Success" };

export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  project: Project,
): Promise<MakeResult> {
  const startTimestamp = getNow().getTime();

  const installResult = await Compile.installDependencies(
    env,
    logger,
    getNow,
    project,
  ).promise;

  switch (installResult.tag) {
    case "Error":
    case "Killed":
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

  // `make` uses “fail fast.” _One_ of these error categories are shown at a time:
  // 1. All elm.json errors.
  // 2. All `elm make` errors.
  // 3. First postprocess error (likely the same error for all of them (bad
  //    command), and they might be slow.)
  if (
    isNonEmptyArray(initialOutputActions.actions) &&
    !isNonEmptyArray(project.targetsErrors)
  ) {
    logger.withSynchronizedOutput(() => {
      Compile.printStatusLinesForTargetsErrors(logger, project);
      Compile.printSpaceForOutputs(logger, "make", initialOutputActions);
    });

    await new Promise<void>((resolve, reject) => {
      const cycle = (outputActions: Compile.OutputActions): void => {
        for (const action of outputActions.actions) {
          Compile.handleOutputAction({
            env,
            logger,
            getNow,
            runMode: { tag: "make" },
            total: outputActions.total,
            action,
          })
            .then(() => {
              const nextOutputActions = getNextOutputActions(project);
              if (isNonEmptyArray(nextOutputActions.actions)) {
                cycle(nextOutputActions);
              } else if (nextOutputActions.numExecuting === 0) {
                resolve();
              }
            })
            .catch(reject);
        }
      };
      cycle(initialOutputActions);
    });
  } else {
    logger.withSynchronizedOutput(() => {
      Compile.printStatusLinesForTargetsErrors(logger, project);
    });
  }

  // Errors from outside elm-watch might have been reported while compiling.
  project.externalErrors = getSnapshot(project.errorReporter);
  const errors = Compile.extractErrors(project);
  const failed = isNonEmptyArray(errors);

  logger.withSynchronizedOutput(() => {
    if (failed) {
      Compile.printErrors(logger, errors);
    }

    const duration = getNow().getTime() - startTimestamp;
    logger.write("");
    logger.write(
      compileFinishedMessage({
        loggerConfig: logger.config,
        duration,
        hasErrors: failed,
      }),
    );
  });

  return failed ? { tag: "Error" } : { tag: "Success" };
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
          (action2) => action2.tag !== "NeedsPostprocess",
        ),
      }
    : nextOutputActions;
}

function compileFinishedMessage({
  loggerConfig,
  duration,
  hasErrors,
}: {
  loggerConfig: LoggerConfig;
  duration: number;
  hasErrors: boolean;
}): string {
  return Compile.printStatusLine({
    maxWidth: Infinity,
    fancy: loggerConfig.fancy,
    isTTY: loggerConfig.isTTY,
    emojiName: hasErrors ? "Error" : "Success",
    string: `Compilation finished in ${bold(
      printDurationMs(loggerConfig.mockedTimings ? 123 : duration).trim(),
    )}.`,
  });
}
