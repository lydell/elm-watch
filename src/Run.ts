import * as CliArgs from "./CliArgs";
import * as Compile from "./Compile";
import * as ElmWatchJson from "./ElmWatchJson";
import * as ElmWatchStuffJson from "./ElmWatchStuffJson";
import * as Errors from "./Errors";
import { Env } from "./Helpers";
import * as Hot from "./Hot";
import type { Logger } from "./Logger";
import * as Make from "./Make";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { ELM_WATCH_NODE, PostprocessWorkerPool } from "./Postprocess";
import { initProject } from "./Project";
import {
  CliArg,
  Cwd,
  ElmWatchJsonPath,
  GetNow,
  OnIdle,
  RunMode,
} from "./Types";

type RunResult =
  | {
      tag: "Exit";
      exitCode: number;
    }
  | {
      tag: "Restart";
      restartReasons: NonEmptyArray<
        Hot.WatcherEvent | Hot.WebSocketRelatedEvent
      >;
      postprocessWorkerPool: PostprocessWorkerPool;
      webSocketState: Hot.WebSocketState | undefined;
    };

export async function run(
  cwd: Cwd,
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  runMode: RunMode,
  args: Array<CliArg>,
  restartReasons: Array<Hot.WatcherEvent | Hot.WebSocketRelatedEvent>,
  postprocessWorkerPool: PostprocessWorkerPool,
  webSocketState: Hot.WebSocketState | undefined
): Promise<RunResult> {
  const parseResult = ElmWatchJson.findReadAndParse(cwd);

  switch (parseResult.tag) {
    case "ReadAsJsonError":
      logger.errorTemplate(
        Errors.readElmWatchJsonAsJson(
          parseResult.elmWatchJsonPath,
          parseResult.error
        )
      );
      return handleElmWatchJsonError(
        logger,
        getNow,
        runMode,
        parseResult.elmWatchJsonPath,
        postprocessWorkerPool
      );

    case "DecodeError":
      logger.errorTemplate(
        Errors.decodeElmWatchJson(
          parseResult.elmWatchJsonPath,
          parseResult.error
        )
      );
      return handleElmWatchJsonError(
        logger,
        getNow,
        runMode,
        parseResult.elmWatchJsonPath,
        postprocessWorkerPool
      );

    case "ElmWatchJsonNotFound":
      logger.errorTemplate(Errors.elmWatchJsonNotFound(cwd, args));
      return { tag: "Exit", exitCode: 1 };

    case "Parsed": {
      const parseArgsResult = CliArgs.parseArgs(runMode, args);

      switch (parseArgsResult.tag) {
        case "UnknownFlags":
          logger.errorTemplate(
            Errors.unknownFlags(
              cwd,
              parseResult.elmWatchJsonPath,
              runMode,
              args,
              parseArgsResult.unknownFlags
            )
          );
          return { tag: "Exit", exitCode: 1 };

        case "DebugOptimizeForHot":
          logger.errorTemplate(Errors.debugOptimizeForHot());
          return { tag: "Exit", exitCode: 1 };

        case "DebugOptimizeClash":
          logger.errorTemplate(Errors.debugOptimizeClash());
          return { tag: "Exit", exitCode: 1 };

        case "Success": {
          const { config } = parseResult;

          // The decoder validates that there’s at least one output.
          const knownTargets = Object.keys(
            config.targets
          ) as NonEmptyArray<string>;

          const unknownTargetsSubstrings =
            parseArgsResult.targetsSubstrings.filter(
              (substring) =>
                !knownTargets.some((targetName) =>
                  targetName.includes(substring)
                )
            );

          if (isNonEmptyArray(unknownTargetsSubstrings)) {
            logger.errorTemplate(
              Errors.unknownTargetsSubstrings(
                parseResult.elmWatchJsonPath,
                knownTargets,
                unknownTargetsSubstrings
              )
            );
            return { tag: "Exit", exitCode: 1 };
          }

          const elmWatchStuffJsonPath = ElmWatchStuffJson.getPath(
            parseResult.elmWatchJsonPath
          );

          const elmWatchStuffJsonParseResult =
            runMode === "hot"
              ? ElmWatchStuffJson.readAndParse(elmWatchStuffJsonPath)
              : undefined;

          switch (elmWatchStuffJsonParseResult?.tag) {
            case "ElmWatchStuffJsonReadAsJsonError":
              logger.errorTemplate(
                Errors.readElmWatchStuffJsonAsJson(
                  elmWatchStuffJsonPath,
                  elmWatchStuffJsonParseResult.error
                )
              );
              return { tag: "Exit", exitCode: 1 };

            case "ElmWatchStuffJsonDecodeError":
              logger.errorTemplate(
                Errors.decodeElmWatchStuffJson(
                  elmWatchStuffJsonPath,
                  elmWatchStuffJsonParseResult.error
                )
              );
              return { tag: "Exit", exitCode: 1 };

            case undefined:
            case "Parsed":
            case "NoElmWatchStuffJson": {
              const elmWatchStuffJson =
                elmWatchStuffJsonParseResult?.tag === "Parsed"
                  ? elmWatchStuffJsonParseResult.elmWatchStuffJson
                  : undefined;

              const initProjectResult = initProject({
                env,
                compilationMode: parseArgsResult.compilationMode,
                elmWatchJsonPath: parseResult.elmWatchJsonPath,
                config: parseResult.config,
                enabledTargetsSubstrings: isNonEmptyArray(
                  parseArgsResult.targetsSubstrings
                )
                  ? parseArgsResult.targetsSubstrings
                  : knownTargets,
                elmWatchStuffJsonPath,
                elmWatchStuffJson,
              });

              switch (initProjectResult.tag) {
                case "DuplicateOutputs":
                  logger.errorTemplate(
                    Errors.duplicateOutputs(
                      parseResult.elmWatchJsonPath,
                      initProjectResult.duplicates
                    )
                  );
                  return handleElmWatchJsonError(
                    logger,
                    getNow,
                    runMode,
                    parseResult.elmWatchJsonPath,
                    postprocessWorkerPool
                  );

                // istanbul ignore next
                case "NoCommonRoot":
                  logger.errorTemplate(
                    Errors.noCommonRoot(initProjectResult.paths)
                  );
                  return { tag: "Exit", exitCode: 1 };

                case "Project": {
                  const { project } = initProjectResult;

                  switch (project.postprocess.tag) {
                    case "NoPostprocess":
                      break;
                    case "Postprocess":
                      if (
                        project.postprocess.postprocessArray[0] ===
                        ELM_WATCH_NODE
                      ) {
                        // Warm up one worker, since we’re going to need it.
                        postprocessWorkerPool.getOrCreateAvailableWorker();
                      }
                      break;
                  }

                  switch (runMode) {
                    case "make": {
                      const result = await Make.run(
                        env,
                        logger,
                        getNow,
                        project,
                        postprocessWorkerPool
                      );
                      switch (result.tag) {
                        case "Error":
                          return { tag: "Exit", exitCode: 1 };

                        case "Success":
                          return { tag: "Exit", exitCode: 0 };
                      }
                    }

                    case "hot": {
                      const result = await Hot.run(
                        env,
                        logger,
                        getNow,
                        onIdle,
                        restartReasons,
                        postprocessWorkerPool,
                        webSocketState,
                        project,
                        config.port !== undefined
                          ? { tag: "PortFromConfig", port: config.port }
                          : elmWatchStuffJson !== undefined
                          ? {
                              tag: "PersistedPort",
                              port: elmWatchStuffJson.port,
                            }
                          : { tag: "NoPort" }
                      );
                      switch (result.tag) {
                        case "ExitOnHandledFatalError":
                          logger.errorTemplate(result.errorTemplate);
                          return { tag: "Exit", exitCode: 1 };

                        case "ExitOnIdle":
                          return { tag: "Exit", exitCode: 1 };

                        case "Restart":
                          return result;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

async function handleElmWatchJsonError(
  logger: Logger,
  getNow: GetNow,
  runMode: RunMode,
  elmWatchJsonPath: ElmWatchJsonPath,
  postprocessWorkerPool: PostprocessWorkerPool
): Promise<RunResult> {
  switch (runMode) {
    case "make":
      return { tag: "Exit", exitCode: 1 };

    case "hot": {
      logger.error("");
      Compile.printNumErrors(logger, 1);
      const elmWatchJsonEvent = await Hot.watchElmWatchJsonOnce(
        getNow,
        elmWatchJsonPath
      );
      logger.clearScreen();
      return {
        tag: "Restart",
        restartReasons: [elmWatchJsonEvent],
        postprocessWorkerPool,
        webSocketState: undefined,
      };
    }
  }
}
