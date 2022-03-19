import * as Compile from "./Compile";
import { Env } from "./Env";
import { bold, dim, printDurationMs } from "./Helpers";
import type { Logger, LoggerConfig } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { PostprocessWorkerPool } from "./Postprocess";
import { ELM_WATCH_NODE } from "./PostprocessShared";
import { Project } from "./Project";
import { GetNow } from "./Types";

type MakeResult = { tag: "Error" } | { tag: "Success" };

export async function run(
  env: Env,
  logger: Logger,
  getNow: GetNow,
  project: Project,
  postprocessWorkerPool: PostprocessWorkerPool
): Promise<MakeResult> {
  const startTimestamp = getNow().getTime();

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
    Compile.printSpaceForOutputs(logger, "make", initialOutputActions);

    await new Promise<void>((resolve, reject) => {
      const cycle = (outputActions: Compile.OutputActions): void => {
        for (const action of outputActions.actions) {
          Compile.handleOutputAction({
            env,
            logger,
            getNow,
            runMode: { tag: "make" },
            elmWatchJsonPath: project.elmWatchJsonPath,
            total: outputActions.total,
            action,
            postprocess: project.postprocess,
            postprocessWorkerPool,
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
  }

  const numWorkers = postprocessWorkerPool.getSize();

  await postprocessWorkerPool.terminate();

  const errors = Compile.extractErrors(project);
  const failed = isNonEmptyArray(errors);

  if (failed) {
    Compile.printErrors(logger, errors);
  }

  const duration = getNow().getTime() - startTimestamp;
  logger.write("");
  logger.write(
    compileFinishedMessage({
      loggerConfig: logger.config,
      duration,
      numWorkers,
      hasErrors: failed,
    })
  );

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
          (action2) => action2.tag !== "NeedsPostprocess"
        ),
      }
    : nextOutputActions;
}

function compileFinishedMessage({
  loggerConfig,
  duration,
  numWorkers,
  hasErrors,
}: {
  loggerConfig: LoggerConfig;
  duration: number;
  numWorkers: number;
  hasErrors: boolean;
}): string {
  const workersString =
    numWorkers > 0
      ? dim(
          ` (using ${numWorkers} ${ELM_WATCH_NODE} ${
            numWorkers === 1 ? "worker" : "workers"
          }).`
        )
      : ".";

  return Compile.printStatusLine({
    maxWidth: Infinity,
    fancy: loggerConfig.fancy,
    isTTY: loggerConfig.isTTY,
    emojiName: hasErrors ? "Error" : "Success",
    string: `Compilation finished in ${bold(
      printDurationMs(
        loggerConfig.mockedTimings ? 123 : /* istanbul ignore next */ duration
      ).trim()
    )}${workersString}`,
  });
}
