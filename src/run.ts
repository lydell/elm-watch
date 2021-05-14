import * as Compile from "./Compile";
import * as ElmToolingJson from "./ElmToolingJson";
import * as Errors from "./Errors";
import type { Logger } from "./Logger";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { Cwd } from "./path-helpers";
import * as State from "./State";
import type { CliArg, RunMode } from "./types";

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
      const badArgs = args.filter(
        (arg) => !ElmToolingJson.isValidOutputName(arg.theArg)
      );

      if (isNonEmptyArray(badArgs)) {
        logger.error(
          Errors.badArgs(cwd, parseResult.elmToolingJsonPath, args, badArgs)
        );
        return 1;
      }

      const { outputs } = parseResult.config;
      const stringArgs = args.map((arg) => arg.theArg);
      const unknownOutputs = stringArgs.filter(
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

      const initStateResult = State.init(
        cwd,
        runMode,
        parseResult.elmToolingJsonPath,
        parseResult.config,
        isNonEmptyArray(stringArgs)
          ? new Set(stringArgs)
          : new Set(Object.keys(outputs))
      );

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
