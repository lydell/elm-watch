import * as CliArgs from "./CliArgs";
import * as ElmToolingJson from "./ElmToolingJson";
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
  | { tag: "Exit"; exitCode: number }
  | { tag: "Restart"; restartReasons: NonEmptyArray<Hot.WatcherEvent> };

export async function run(
  cwd: Cwd,
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  runMode: RunMode,
  args: Array<CliArg>,
  restartReasons: Array<Hot.WatcherEvent>
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
          const { outputs } = parseResult.config;
          const unknownOutputs = parseArgsResult.outputs.filter(
            (arg) => !Object.prototype.hasOwnProperty.call(outputs, arg)
          );

          if (isNonEmptyArray(unknownOutputs)) {
            logger.errorTemplate(
              Errors.unknownOutputs(
                parseResult.elmToolingJsonPath,
                // The decoder validates that there’s at least one output.
                Object.keys(outputs) as NonEmptyArray<string>,
                unknownOutputs
              )
            );
            return { tag: "Exit", exitCode: 1 };
          }

          const initProjectResult = initProject({
            runMode,
            compilationMode: parseArgsResult.compilationMode,
            elmToolingJsonPath: parseResult.elmToolingJsonPath,
            config: parseResult.config,
            enabledOutputs: isNonEmptyArray(parseArgsResult.outputs)
              ? new Set(parseArgsResult.outputs)
              : new Set(Object.keys(outputs)),
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
                    runMode,
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
                    initProjectResult.project
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
      return { tag: "Restart", restartReasons: [elmToolingJsonEvent] };
    }
  }
}
