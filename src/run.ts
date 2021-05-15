import * as Compile from "./Compile";
import * as ElmToolingJson from "./ElmToolingJson";
import * as Errors from "./Errors";
import type { Logger } from "./Logger";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { Cwd } from "./path-helpers";
import * as State from "./State";
import type { CliArg, CompilationMode, RunMode } from "./types";

export async function run(
  cwd: Cwd,
  logger: Logger,
  runMode: RunMode,
  args: Array<CliArg>
): Promise<number> {
  const parseResult = ElmToolingJson.findReadAndParse(cwd);

  switch (parseResult.tag) {
    case "ReadAsJsonError":
      logger.error(
        Errors.readAsJson(parseResult.elmToolingJsonPath, parseResult.error)
      );
      return 1;

    case "DecodeError":
      logger.error(
        Errors.decode(parseResult.elmToolingJsonPath, parseResult.error)
      );
      return 1;

    case "ElmToolingJsonNotFound":
      logger.error(Errors.elmToolingJsonNotFound(cwd, args));
      return 1;

    case "Parsed": {
      const parseArgsResult = parseArgs(runMode, args);

      switch (parseArgsResult.tag) {
        case "BadArgs":
          logger.error(
            Errors.badArgs(
              cwd,
              parseResult.elmToolingJsonPath,
              args,
              parseArgsResult.badArgs
            )
          );
          return 1;

        case "DebugOptimizeForHot":
          logger.error(Errors.debugOptimizeForHot());
          return 1;

        case "DebugOptimizeClash":
          logger.error(Errors.debugOptimizeClash());
          return 1;

        case "Success": {
          const { outputs } = parseResult.config;
          const unknownOutputs = parseArgsResult.outputs.filter(
            (arg) => !Object.prototype.hasOwnProperty.call(outputs, arg)
          );

          if (isNonEmptyArray(unknownOutputs)) {
            logger.error(
              Errors.unknownOutputs(
                parseResult.elmToolingJsonPath,
                // The decoder validates that there’s at least one output.
                Object.keys(outputs) as NonEmptyArray<string>,
                unknownOutputs
              )
            );
            return 1;
          }

          const initStateResult = State.init({
            cwd,
            runMode,
            compilationMode: parseArgsResult.compilationMode,
            elmToolingJsonPath: parseResult.elmToolingJsonPath,
            config: parseResult.config,
            enabledOutputs: isNonEmptyArray(parseArgsResult.outputs)
              ? new Set(parseArgsResult.outputs)
              : new Set(Object.keys(outputs)),
          });

          switch (initStateResult.tag) {
            case "NoCommonRoot":
              logger.error(Errors.noCommonRoot(initStateResult.paths));
              return 1;

            case "State":
              return Compile.run(logger, initStateResult.state);
          }
        }
      }
    }
  }
}

type ParseArgsResult =
  | {
      tag: "BadArgs";
      badArgs: NonEmptyArray<CliArg>;
    }
  | {
      tag: "Success";
      compilationMode: CompilationMode;
      outputs: Array<string>;
    }
  | { tag: "DebugOptimizeClash" }
  | { tag: "DebugOptimizeForHot" };

function parseArgs(runMode: RunMode, args: Array<CliArg>): ParseArgsResult {
  let debug = false;
  let optimize = false;
  const badArgs: Array<CliArg> = [];
  const outputs: Array<string> = [];

  for (const arg of args) {
    switch (arg.theArg) {
      case "--debug":
        debug = true;
        break;

      case "--optimize":
        optimize = true;
        break;

      default:
        if (ElmToolingJson.isValidOutputName(arg.theArg)) {
          outputs.push(arg.theArg);
        } else {
          badArgs.push(arg);
        }
    }
  }

  switch (runMode) {
    case "hot":
      if (debug || optimize) {
        return { tag: "DebugOptimizeForHot" };
      }
      break;

    case "make":
      if (debug && optimize) {
        return { tag: "DebugOptimizeClash" };
      }
      break;
  }

  if (isNonEmptyArray(badArgs)) {
    return {
      tag: "BadArgs",
      badArgs,
    };
  }

  return {
    tag: "Success",
    compilationMode: debug ? "debug" : optimize ? "optimize" : "standard",
    outputs,
  };
}
