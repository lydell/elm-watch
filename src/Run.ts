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

export async function run(
  cwd: Cwd,
  env: Env,
  logger: Logger,
  getNow: GetNow,
  onIdle: OnIdle | undefined,
  runMode: RunMode,
  args: Array<CliArg>,
  restartReasons: Array<Hot.WatcherEvent>
): Promise<number> {
  const restart: Hot.Restart = (nextRestartReasons) =>
    run(cwd, env, logger, getNow, onIdle, runMode, args, nextRestartReasons);

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
        restart,
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
        restart,
        parseResult.elmToolingJsonPath
      );

    case "ElmToolingJsonNotFound":
      logger.errorTemplate(Errors.elmToolingJsonNotFound(cwd, args));
      return 1;

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
          return 1;

        case "DebugOptimizeForHot":
          logger.errorTemplate(Errors.debugOptimizeForHot());
          return 1;

        case "DebugOptimizeClash":
          logger.errorTemplate(Errors.debugOptimizeClash());
          return 1;

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
            return 1;
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
                restart,
                parseResult.elmToolingJsonPath
              );

            // istanbul ignore next
            case "NoCommonRoot":
              logger.errorTemplate(
                Errors.noCommonRoot(initProjectResult.paths)
              );
              return 1;

            case "Project": {
              switch (runMode) {
                case "make":
                  return Make.run(
                    env,
                    logger,
                    runMode,
                    initProjectResult.project
                  );

                case "hot":
                  return Hot.run(
                    env,
                    logger,
                    getNow,
                    onIdle,
                    restart,
                    restartReasons,
                    initProjectResult.project
                  );
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
  restart: Hot.Restart,
  elmToolingJsonPath: ElmToolingJsonPath
): Promise<number> {
  switch (runMode) {
    case "make":
      return 1;

    case "hot":
      return Hot.handleElmToolingJsonError(
        logger,
        getNow,
        restart,
        elmToolingJsonPath
      );
  }
}
