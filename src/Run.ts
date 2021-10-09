import * as CliArgs from "./CliArgs";
import * as ElmToolingJson from "./ElmToolingJson";
import * as ElmWatchStuffJson from "./ElmWatchStuffJson";
import * as Errors from "./Errors";
import { Env } from "./Helpers";
import * as Hot from "./Hot";
import type { Logger } from "./Logger";
import * as Make from "./Make";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { Cwd } from "./PathHelpers";
import { initProject } from "./Project";
import { CliArg, ElmToolingJsonPath, GetNow, OnIdle, RunMode } from "./Types";

type RunResult =
  | {
      tag: "Exit";
      exitCode: number;
    }
  | {
      tag: "Restart";
      restartReasons: NonEmptyArray<
        Hot.WatcherEvent | Hot.WebSocketConnectedEvent
      >;
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
  restartReasons: Array<Hot.WatcherEvent | Hot.WebSocketConnectedEvent>,
  webSocketState: Hot.WebSocketState | undefined
): Promise<RunResult> {
  const parseResult = ElmToolingJson.findReadAndParse(cwd);

  switch (parseResult.tag) {
    case "ReadAsJsonError":
      logger.errorTemplate(
        Errors.readElmToolingJsonAsJson(
          parseResult.elmToolingJsonPath,
          parseResult.error
        )
      );
      return handleElmToolingJsonError(
        logger,
        getNow,
        runMode,
        parseResult.elmToolingJsonPath
      );

    case "DecodeError":
      logger.errorTemplate(
        Errors.decodeElmToolingJson(
          parseResult.elmToolingJsonPath,
          parseResult.error
        )
      );
      return handleElmToolingJsonError(
        logger,
        getNow,
        runMode,
        parseResult.elmToolingJsonPath
      );

    case "ElmToolingJsonNotFound":
      logger.errorTemplate(Errors.elmToolingJsonNotFound(cwd, args));
      return { tag: "Exit", exitCode: 1 };

    case "Parsed": {
      const parseArgsResult = CliArgs.parseArgs(runMode, args);

      switch (parseArgsResult.tag) {
        case "BadArgs":
          logger.errorTemplate(
            Errors.badArgs(
              cwd,
              parseResult.elmToolingJsonPath,
              args,
              parseArgsResult.badArgs
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
          const unknownOutputs = parseArgsResult.outputs.filter(
            (arg) => !Object.prototype.hasOwnProperty.call(config.outputs, arg)
          );

          if (isNonEmptyArray(unknownOutputs)) {
            logger.errorTemplate(
              Errors.unknownOutputs(
                parseResult.elmToolingJsonPath,
                // The decoder validates that there’s at least one output.
                Object.keys(config.outputs) as NonEmptyArray<string>,
                unknownOutputs
              )
            );
            return { tag: "Exit", exitCode: 1 };
          }

          const elmWatchStuffJsonPath = ElmWatchStuffJson.getPath(
            parseResult.elmToolingJsonPath
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
                elmToolingJsonPath: parseResult.elmToolingJsonPath,
                config: parseResult.config,
                enabledOutputs: isNonEmptyArray(parseArgsResult.outputs)
                  ? new Set(parseArgsResult.outputs)
                  : new Set(Object.keys(config.outputs)),
                elmWatchStuffJsonPath,
                elmWatchStuffJson,
              });

              switch (initProjectResult.tag) {
                case "DuplicateOutputs":
                  logger.errorTemplate(
                    Errors.duplicateOutputs(
                      parseResult.elmToolingJsonPath,
                      initProjectResult.duplicates
                    )
                  );
                  return handleElmToolingJsonError(
                    logger,
                    getNow,
                    runMode,
                    parseResult.elmToolingJsonPath
                  );

                // istanbul ignore next
                case "NoCommonRoot":
                  logger.errorTemplate(
                    Errors.noCommonRoot(initProjectResult.paths)
                  );
                  return { tag: "Exit", exitCode: 1 };

                case "Project": {
                  switch (runMode) {
                    case "make": {
                      const result = await Make.run(
                        env,
                        logger,
                        getNow,
                        initProjectResult.project
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
                        webSocketState,
                        initProjectResult.project,
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
                        case "ExitOnIdle":
                          return { tag: "Exit", exitCode: 0 };

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

async function handleElmToolingJsonError(
  logger: Logger,
  getNow: GetNow,
  runMode: RunMode,
  elmToolingJsonPath: ElmToolingJsonPath
): Promise<RunResult> {
  switch (runMode) {
    case "make":
      return { tag: "Exit", exitCode: 1 };

    case "hot": {
      const elmToolingJsonEvent = await Hot.watchElmToolingJsonOnce(
        getNow,
        elmToolingJsonPath
      );
      logger.clearScreen();
      return {
        tag: "Restart",
        restartReasons: [elmToolingJsonEvent],
        webSocketState: undefined,
      };
    }
  }
}
