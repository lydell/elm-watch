import * as ElmToolingJson from "./ElmToolingJson";
import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import { getSetSingleton } from "./helpers";
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
  CompilationMode,
  ElmJsonPath,
  ElmToolingJsonPath,
  InputPath,
  OutputPath,
  RunMode,
} from "./types";

export type State = {
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

export type OutputState = {
  inputs: NonEmptyArray<InputPath>;
  mode: CompilationMode;
};

export type InitStateResult =
  | {
      tag: "NoCommonRoot";
      paths: NonEmptyArray<AbsolutePath>;
    }
  | {
      tag: "State";
      state: State;
    };

export function init(
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
