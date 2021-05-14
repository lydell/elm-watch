import * as fs from "fs";
import type { DecoderError } from "tiny-decoders";

import * as ElmToolingJson from "./ElmToolingJson";
import * as Errors from "./Errors";
import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import { getSetSingleton } from "./helpers";
import type { Logger } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import {
  absoluteDirname,
  AbsolutePath,
  absolutePathFromString,
  Cwd,
  findClosest,
  longestCommonAncestorPath,
} from "./path-helpers";
import type {
  CliArg,
  CompilationMode,
  ElmJsonPath,
  ElmToolingJsonPath,
  InputPath,
  OutputPath,
  RunMode,
} from "./types";

export async function run(
  cwd: Cwd,
  logger: Logger,
  runMode: RunMode,
  args: Array<CliArg>
): Promise<number> {
  const parseResult = findReadAndParseElmToolingJson(cwd);

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

      const initStateResult = initState(
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
          await Promise.resolve();
          logger.log(
            `Run: ${runMode}\n${JSON.stringify(
              initStateResult.state,
              (_, value: unknown) =>
                value instanceof Set ||
                value instanceof HashSet ||
                value instanceof HashMap
                  ? Array.from(value)
                  : value,
              2
            )}`
          );
          return 0;
      }
    }
  }
}

export type ParseResult =
  | {
      tag: "DecodeError";
      elmToolingJsonPath: ElmToolingJsonPath;
      error: DecoderError;
    }
  | {
      tag: "ElmToolingJsonNotFound";
    }
  | {
      tag: "Parsed";
      elmToolingJsonPath: ElmToolingJsonPath;
      config: ElmToolingJson.Config;
    }
  | {
      tag: "ReadAsJsonError";
      elmToolingJsonPath: ElmToolingJsonPath;
      error: Error;
    };

function findReadAndParseElmToolingJson(cwd: Cwd): ParseResult {
  const elmToolingJsonPathRaw = findClosest("elm-tooling.json", cwd.path);
  if (elmToolingJsonPathRaw === undefined) {
    return {
      tag: "ElmToolingJsonNotFound",
    };
  }

  const elmToolingJsonPath: ElmToolingJsonPath = {
    tag: "ElmToolingJsonPath",
    theElmToolingJsonPath: elmToolingJsonPathRaw,
  };

  let json: unknown = undefined;
  try {
    json = JSON.parse(
      fs.readFileSync(elmToolingJsonPathRaw.absolutePath, "utf-8")
    );
  } catch (errorAny) {
    const error = errorAny as Error;
    return {
      tag: "ReadAsJsonError",
      elmToolingJsonPath,
      error,
    };
  }

  try {
    return {
      tag: "Parsed",
      elmToolingJsonPath,
      config: ElmToolingJson.decoder(json)["x-elm-watch"],
    };
  } catch (errorAny) {
    const error = errorAny as DecoderError;
    return {
      tag: "DecodeError",
      elmToolingJsonPath,
      error,
    };
  }
}

type State = {
  // Path to the longest ancestor of elm-tooling.json and all elm.json.
  watchRoot: AbsolutePath;
  cwd: Cwd;
  runMode: RunMode;
  elmToolingJsonPath: ElmToolingJsonPath;
  disabledOutputs: HashSet<OutputPath>;
  elmJsonsErrors: Array<ElmJsonError>;
  elmJsons: HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>;
  // Maybe also websocket connections in the future.
};

type OutputState = {
  inputs: NonEmptyArray<InputPath>;
  mode: CompilationMode;
};

type InitStateResult =
  | {
      tag: "NoCommonRoot";
      paths: NonEmptyArray<AbsolutePath>;
    }
  | {
      tag: "State";
      state: State;
    };

function initState(
  cwd: Cwd,
  runMode: RunMode,
  elmToolingJsonPath: ElmToolingJsonPath,
  config: ElmToolingJson.Config,
  enabledOutputs: Set<string>
): InitStateResult {
  const disabledOutputs = new HashSet<OutputPath>();
  const elmJsonsErrors: Array<ElmJsonError> = [];
  const elmJsons = new HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>();

  for (const [outputPathString, output] of Object.entries(config.outputs)) {
    const outputPath: OutputPath = {
      tag: "OutputPath",
      theOutputPath: absolutePathFromString(
        elmToolingJsonPath.theElmToolingJsonPath,
        outputPathString
      ),
    };

    if (enabledOutputs.has(outputPathString)) {
      const inputs = mapNonEmptyArray(
        output.inputs,
        (inputString): InputPath => ({
          tag: "InputPath",
          theInputPath: absolutePathFromString(
            elmToolingJsonPath.theElmToolingJsonPath,
            inputString
          ),
        })
      );

      const resolveElmJsonResult = resolveElmJson(inputs);

      switch (resolveElmJsonResult.tag) {
        case "ElmJsonPath": {
          const previous =
            elmJsons.get(resolveElmJsonResult.elmJsonPath) ??
            new HashMap<OutputPath, OutputState>();

          previous.set(outputPath, {
            inputs,
            mode: output.mode ?? "standard",
          });
          elmJsons.set(resolveElmJsonResult.elmJsonPath, previous);
          break;
        }

        case "ElmJsonError":
          elmJsonsErrors.push(resolveElmJsonResult);
          break;
      }
    } else {
      disabledOutputs.add(outputPath);
    }
  }

  const paths = mapNonEmptyArray(
    [
      elmToolingJsonPath.theElmToolingJsonPath,
      ...Array.from(
        elmJsons.keys(),
        (elmJsonPath) => elmJsonPath.theElmJsonPath
      ),
    ],
    (absolutePath) => absoluteDirname(absolutePath)
  );

  const watchRoot =
    longestCommonAncestorPath(paths) ??
    // On Windows, you can have one `C:` and one `D:` path and they don’t have
    // any overlap. Just go with the elm-tooling.json path in that case.
    elmToolingJsonPath.theElmToolingJsonPath;

  if (watchRoot === undefined) {
    return {
      tag: "NoCommonRoot",
      paths,
    };
  }

  return {
    tag: "State",
    state: {
      watchRoot,
      cwd,
      runMode,
      elmToolingJsonPath,
      disabledOutputs,
      elmJsonsErrors,
      elmJsons,
    },
  };
}

type ResolveElmJsonResult =
  | ElmJsonError
  | {
      tag: "ElmJsonPath";
      elmJsonPath: ElmJsonPath;
    };

type ElmJsonError = {
  tag: "ElmJsonError";
  elmJsonNotFound: Array<InputPath>;
  nonUniqueElmJsonPaths: Array<{
    inputPath: InputPath;
    elmJsonPath: ElmJsonPath;
  }>;
};

function resolveElmJson(
  inputs: NonEmptyArray<InputPath>
): ResolveElmJsonResult {
  const elmJsonNotFound: Array<InputPath> = [];
  const elmJsonPaths: Array<{
    inputPath: InputPath;
    elmJsonPath: ElmJsonPath;
  }> = [];

  for (const inputPath of inputs) {
    const elmJsonPathRaw = findClosest(
      "elm.json",
      absoluteDirname(inputPath.theInputPath)
    );
    if (elmJsonPathRaw === undefined) {
      elmJsonNotFound.push(inputPath);
    } else {
      elmJsonPaths.push({
        inputPath,
        elmJsonPath: { tag: "ElmJsonPath", theElmJsonPath: elmJsonPathRaw },
      });
    }
  }

  const elmJsonPathsSet = new HashSet(
    elmJsonPaths.map(({ elmJsonPath }) => elmJsonPath)
  );

  const uniqueElmJsonPath = getSetSingleton(elmJsonPathsSet);

  return isNonEmptyArray(elmJsonNotFound)
    ? {
        tag: "ElmJsonError",
        elmJsonNotFound,
        nonUniqueElmJsonPaths:
          uniqueElmJsonPath === undefined ? elmJsonPaths : [],
      }
    : uniqueElmJsonPath === undefined
    ? {
        tag: "ElmJsonError",
        elmJsonNotFound: [],
        nonUniqueElmJsonPaths: elmJsonPaths,
      }
    : {
        tag: "ElmJsonPath",
        elmJsonPath: uniqueElmJsonPath,
      };
}
