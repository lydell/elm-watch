import * as crypto from "crypto";

import * as CliArgs from "./CliArgs.ts";
import * as Compile from "./Compile.ts";
import type { Config } from "./Config.ts";
import * as ElmWatchJson from "./ElmWatchJson.ts";
import * as ElmWatchStuffJson from "./ElmWatchStuffJson.ts";
import type { Env } from "./Env.ts";
import * as Errors from "./Errors.ts";
import type { ErrorViewState } from "./ErrorView.ts";
import * as Hot from "./Hot.ts";
import type { Logger } from "./Logger.ts";
import * as Make from "./Make.ts";
import { isNonEmptyArray, mapNonEmptyArray } from "./NonEmptyArray.ts";
import { absolutePathFromString } from "./PathHelpers.ts";
import { initProject, projectToDebug } from "./Project.ts";
import {
  type CliArg,
  type CompilationMode,
  type CreateServer,
  type Cwd,
  type ElmWatchJsonPath,
  type ElmWatchStuffDir,
  type ElmWatchStuffJsonPath,
  type GetNow,
  markAsElmWatchStuffDir,
  markAsElmWatchStuffJsonPath,
  markAsWebSocketToken,
  type RunMode,
  type WebSocketToken,
} from "./Types.ts";
import type { WebSocketServer } from "./WebSocketServer.ts";

export type RunResult =
  | {
      tag: "Exit";
      exitCode: number;
    }
  | {
      tag: "Restart";
      restartReasons: Array<Hot.LatestEvent>;
      webSocketServer: WebSocketServer | undefined;
      webSocketToken: WebSocketToken | undefined;
      errorViewState: ErrorViewState | undefined;
    };

export async function run(
  cwd: Cwd,
  env: Env,
  logger: Logger,
  getNow: GetNow,
  createServer: CreateServer,
  runMode: RunMode,
  args: Array<CliArg>,
  restartReasons: Array<Hot.LatestEvent>,
  webSocketServer: WebSocketServer | undefined,
  webSocketTokenFromPreviousRun: WebSocketToken | undefined,
  errorViewState: ErrorViewState | undefined,
  hotTestHooks: Hot.HotTestHooks,
): Promise<RunResult> {
  const parseResult = ElmWatchJson.findReadAndParse(cwd);

  switch (parseResult.tag) {
    case "ReadError":
      logger.errorTemplate(
        Errors.readElmWatchJson(
          parseResult.elmWatchJsonPath,
          parseResult.error,
        ),
      );
      return handleElmWatchJsonError(
        logger,
        runMode,
        parseResult.elmWatchJsonPath,
        webSocketTokenFromPreviousRun,
        errorViewState,
        hotTestHooks,
      );

    case "DecoderError":
      logger.errorTemplate(
        Errors.decodeElmWatchJson(
          parseResult.elmWatchJsonPath,
          parseResult.error,
        ),
      );
      return handleElmWatchJsonError(
        logger,
        runMode,
        parseResult.elmWatchJsonPath,
        webSocketTokenFromPreviousRun,
        errorViewState,
        hotTestHooks,
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
              parseArgsResult.unknownFlags,
            ),
          );
          return { tag: "Exit", exitCode: 1 };

        case "DebugOptimizeForHot":
          logger.errorTemplate(Errors.debugOptimizeForHot());
          return { tag: "Exit", exitCode: 1 };

        case "DebugOptimizeClash":
          logger.errorTemplate(Errors.debugOptimizeClash());
          return { tag: "Exit", exitCode: 1 };

        case "Success": {
          const { value: config } = parseResult;
          const knownTargets = mapNonEmptyArray(
            config.targets,
            (target) => target.name,
          );
          const unknownTargetsSubstrings =
            parseArgsResult.targetsSubstrings.filter(
              (substring) =>
                !knownTargets.some((targetName) =>
                  targetName.includes(substring),
                ),
            );

          if (isNonEmptyArray(unknownTargetsSubstrings)) {
            logger.errorTemplate(
              Errors.unknownTargetsSubstrings(
                parseResult.elmWatchJsonPath,
                knownTargets,
                unknownTargetsSubstrings,
              ),
            );
            return { tag: "Exit", exitCode: 1 };
          }

          return runConfig({
            env,
            logger,
            getNow,
            createServer,
            runMode,
            compilationMode: parseArgsResult.compilationMode,
            targetsSubstrings: parseArgsResult.targetsSubstrings,
            config,
            restartReasons,
            webSocketServer,
            webSocketTokenFromPreviousRun,
            errorViewState,
            signal: undefined,
            hotTestHooks,
          });
        }
      }
    }
  }
}

export async function runConfig({
  env,
  logger,
  getNow,
  createServer,
  runMode,
  compilationMode,
  targetsSubstrings,
  config,
  restartReasons,
  webSocketServer,
  webSocketTokenFromPreviousRun,
  errorViewState,
  signal,
  hotTestHooks,
}: {
  env: Env;
  logger: Logger;
  getNow: GetNow;
  createServer: CreateServer;
  runMode: RunMode;
  compilationMode: CompilationMode;
  targetsSubstrings: Array<string>;
  config: Config;
  restartReasons: Array<Hot.LatestEvent>;
  webSocketServer: WebSocketServer | undefined;
  webSocketTokenFromPreviousRun: WebSocketToken | undefined;
  errorViewState: ErrorViewState | undefined;
  signal: AbortSignal | undefined;
  hotTestHooks: Hot.HotTestHooks;
}): Promise<RunResult> {
  const elmWatchStuffDir: ElmWatchStuffDir = markAsElmWatchStuffDir(
    absolutePathFromString(config.root, "elm-stuff", "elm-watch"),
  );

  const elmWatchStuffJsonPath: ElmWatchStuffJsonPath =
    markAsElmWatchStuffJsonPath(
      absolutePathFromString(elmWatchStuffDir, "stuff.json"),
    );

  const elmWatchStuffJsonParseResult =
    runMode === "hot"
      ? ElmWatchStuffJson.readAndParse(elmWatchStuffJsonPath)
      : undefined;

  switch (elmWatchStuffJsonParseResult?.tag) {
    case "ElmWatchStuffJsonReadError":
      logger.errorTemplate(
        Errors.readElmWatchStuffJson(
          elmWatchStuffJsonPath,
          elmWatchStuffJsonParseResult.errors,
        ),
      );
      return { tag: "Exit", exitCode: 1 };

    case "ElmWatchStuffJsonDecodeError":
      logger.errorTemplate(
        Errors.decodeElmWatchStuffJson(
          elmWatchStuffJsonPath,
          elmWatchStuffJsonParseResult.error,
        ),
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
        getNow,
        compilationMode,
        config,
        enabledTargetsSubstrings: isNonEmptyArray(targetsSubstrings)
          ? targetsSubstrings
          : mapNonEmptyArray(config.targets, (target) => target.name),
        elmWatchStuffDir,
        elmWatchStuffJsonPath,
        elmWatchStuffJson,
      });

      switch (initProjectResult.tag) {
        case "DuplicateOutputs":
          logger.errorTemplate(
            Errors.duplicateOutputs(
              config.source,
              initProjectResult.duplicates,
            ),
          );
          switch (config.source.tag) {
            case "ElmWatchJson":
              return handleElmWatchJsonError(
                logger,
                runMode,
                config.source.elmWatchJsonPath,
                webSocketTokenFromPreviousRun,
                errorViewState,
                hotTestHooks,
              );
            case "Options":
              // The options can only change by restarting the whole program.
              return { tag: "Exit", exitCode: 1 };
          }

        case "NonUniquePackageElmJsons":
          logger.errorTemplate(
            Errors.nonUniquePackageElmJsons(
              config.source,
              initProjectResult.nonUniquePackageElmJsons,
            ),
          );
          switch (config.source.tag) {
            case "ElmWatchJson":
              return handleElmWatchJsonError(
                logger,
                runMode,
                config.source.elmWatchJsonPath,
                webSocketTokenFromPreviousRun,
                errorViewState,
                hotTestHooks,
              );
            case "Options":
              // The options can only change by restarting the whole program.
              return { tag: "Exit", exitCode: 1 };
          }

        case "Project": {
          const { project } = initProjectResult;

          logger.debug("Project", projectToDebug(project));

          switch (runMode) {
            case "make": {
              const result = await Make.run(env, logger, getNow, project);
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
                createServer,
                restartReasons,
                webSocketServer,
                elmWatchStuffJson?.webSocketToken ??
                  webSocketTokenFromPreviousRun ??
                  markAsWebSocketToken(crypto.randomUUID()),
                errorViewState,
                project,
                config.port !== undefined
                  ? { tag: "PortFromConfig", port: config.port }
                  : elmWatchStuffJson !== undefined
                    ? {
                        tag: "PersistedPort",
                        port: elmWatchStuffJson.port,
                      }
                    : { tag: "NoPort" },
                signal,
                hotTestHooks,
              );
              switch (result.tag) {
                case "ExitOnHandledFatalError":
                  logger.errorTemplate(result.errorTemplate);
                  return { tag: "Exit", exitCode: 1 };

                case "ExitOnIdle":
                  return {
                    tag: "Exit",
                    exitCode: result.reason === "Other" ? 1 : 0,
                  };

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

async function handleElmWatchJsonError(
  logger: Logger,
  runMode: RunMode,
  elmWatchJsonPath: ElmWatchJsonPath,
  webSocketTokenFromPreviousRun: WebSocketToken | undefined,
  errorViewState: ErrorViewState | undefined,
  hotTestHooks: Hot.HotTestHooks,
): Promise<RunResult> {
  switch (runMode) {
    case "make":
      return { tag: "Exit", exitCode: 1 };

    case "hot": {
      const elmWatchJsonEvent = await Hot.watchElmWatchJsonOnce(
        elmWatchJsonPath,
        hotTestHooks,
        // Print this once the watcher is ready, so that if the user (or a
        // test) reacts to it, the change is guaranteed to be picked up.
        () => {
          logger.write("");
          Compile.printNumErrors(logger, 1);
        },
      );
      logger.clearScreen();
      return {
        tag: "Restart",
        restartReasons: [{ ...elmWatchJsonEvent, affectsAnyTarget: true }],
        webSocketServer: undefined,
        webSocketToken: webSocketTokenFromPreviousRun,
        errorViewState,
      };
    }
  }
}
