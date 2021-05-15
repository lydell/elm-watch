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
  absoluteRealpath,
  Cwd,
  findClosest,
  longestCommonAncestorPath,
} from "./path-helpers";
import { ElmMakeResult } from "./SpawnElm";
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
  elmJsonsErrors: Array<{ outputPath: OutputPath; error: ElmJsonError }>;
  elmJsons: HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>;
  // Maybe also websocket connections in the future.
};

type ElmJsonError =
  | {
      tag: "DuplicateInputs";
      duplicates: NonEmptyArray<{
        inputs: NonEmptyArray<InputPath>;
        resolved: AbsolutePath;
      }>;
    }
  | {
      tag: "ElmJsonNotFound";
      elmJsonNotFound: Array<InputPath>;
    }
  | {
      tag: "InputsFailedToResolve";
      inputsFailedToResolve: NonEmptyArray<{
        inputPath: InputPath;
        error: Error;
      }>;
    }
  | {
      tag: "InputsNotFound";
      inputsNotFound: NonEmptyArray<InputPath>;
    }
  | {
      tag: "NonUniqueElmJsonPaths";
      nonUniqueElmJsonPaths: Array<{
        inputPath: InputPath;
        elmJsonPath: ElmJsonPath;
      }>;
    };

export type OutputState = {
  inputs: NonEmptyArray<{ inputPath: InputPath; inputRealPath: AbsolutePath }>;
  mode: CompilationMode;
  status: ElmMakeResult | { tag: "NotWrittenToDisk" };
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

export function init({
  cwd,
  runMode,
  compilationMode,
  elmToolingJsonPath,
  config,
  enabledOutputs,
}: {
  cwd: Cwd;
  runMode: RunMode;
  compilationMode: CompilationMode;
  elmToolingJsonPath: ElmToolingJsonPath;
  config: ElmToolingJson.Config;
  enabledOutputs: Set<string>;
}): InitStateResult {
  const disabledOutputs = new HashSet<OutputPath>();
  const elmJsonsErrors: Array<{ outputPath: OutputPath; error: ElmJsonError }> =
    [];
  const elmJsons = new HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>();

  for (const [outputPathString, output] of Object.entries(config.outputs)) {
    const outputPath: OutputPath =
      outputPathString === "/dev/null"
        ? { tag: "NullOutputPath" }
        : {
            tag: "OutputPath",
            theOutputPath: absolutePathFromString(
              elmToolingJsonPath.theElmToolingJsonPath,
              outputPathString
            ),
          };

    if (enabledOutputs.has(outputPathString)) {
      const resolveElmJsonResult = resolveElmJson(
        elmToolingJsonPath,
        output.inputs
      );

      switch (resolveElmJsonResult.tag) {
        case "Success": {
          const previous =
            elmJsons.get(resolveElmJsonResult.elmJsonPath) ??
            new HashMap<OutputPath, OutputState>();
          previous.set(outputPath, {
            inputs: resolveElmJsonResult.inputs,
            mode: compilationMode,
            status: { tag: "NotWrittenToDisk" },
          });
          elmJsons.set(resolveElmJsonResult.elmJsonPath, previous);
          break;
        }

        default:
          elmJsonsErrors.push({ outputPath, error: resolveElmJsonResult });
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
      tag: "Success";
      elmJsonPath: ElmJsonPath;
      inputs: NonEmptyArray<{
        inputPath: InputPath;
        inputRealPath: AbsolutePath;
      }>;
    };

function resolveElmJson(
  elmToolingJsonPath: ElmToolingJsonPath,
  inputStrings: NonEmptyArray<string>
): ResolveElmJsonResult {
  const inputs: Array<{ inputPath: InputPath; inputRealPath: AbsolutePath }> =
    [];
  const inputsNotFound: Array<InputPath> = [];
  const inputsFailedToResolve: Array<{ inputPath: InputPath; error: Error }> =
    [];
  const resolved = new HashMap<AbsolutePath, NonEmptyArray<InputPath>>();

  for (const inputString of inputStrings) {
    const inputPath: InputPath = {
      tag: "InputPath",
      theInputPath: absolutePathFromString(
        elmToolingJsonPath.theElmToolingJsonPath,
        inputString
      ),
    };

    let resolvedPath;
    try {
      resolvedPath = absoluteRealpath(inputPath.theInputPath);
    } catch (errorAny) {
      const error = errorAny as Error & { code?: string };
      if (error.code === "ENOENT") {
        inputsNotFound.push(inputPath);
      } else {
        inputsFailedToResolve.push({ inputPath, error });
      }
      continue;
    }

    const previous = resolved.get(resolvedPath);
    if (previous === undefined) {
      resolved.set(resolvedPath, [inputPath]);
    } else {
      previous.push(inputPath);
    }

    inputs.push({ inputPath, inputRealPath: resolvedPath });
  }

  if (isNonEmptyArray(inputsNotFound)) {
    return {
      tag: "InputsNotFound",
      inputsNotFound,
    };
  }

  if (isNonEmptyArray(inputsFailedToResolve)) {
    return {
      tag: "InputsFailedToResolve",
      inputsFailedToResolve,
    };
  }

  const duplicates = Array.from(resolved)
    .filter(([_, inputPaths]) => inputPaths.length >= 2)
    .map(([resolvedPath, inputPaths]) => ({
      resolved: resolvedPath,
      inputs: inputPaths,
    }));

  if (isNonEmptyArray(duplicates)) {
    return {
      tag: "DuplicateInputs",
      duplicates,
    };
  }

  const elmJsonNotFound: Array<InputPath> = [];
  const elmJsonPaths: Array<{
    inputPath: InputPath;
    elmJsonPath: ElmJsonPath;
  }> = [];

  for (const { inputPath } of inputs) {
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

  if (isNonEmptyArray(elmJsonNotFound)) {
    return {
      tag: "ElmJsonNotFound",
      elmJsonNotFound,
    };
  }

  const elmJsonPathsSet = new HashSet(
    elmJsonPaths.map(({ elmJsonPath }) => elmJsonPath)
  );

  const uniqueElmJsonPath = getSetSingleton(elmJsonPathsSet);

  if (uniqueElmJsonPath === undefined) {
    return {
      tag: "NonUniqueElmJsonPaths",
      nonUniqueElmJsonPaths: elmJsonPaths,
    };
  }

  return {
    tag: "Success",
    elmJsonPath: uniqueElmJsonPath,
    // At this point we know for sure that inputs must be non-empty.
    inputs: inputs as NonEmptyArray<{
      inputPath: InputPath;
      inputRealPath: AbsolutePath;
    }>,
  };
}
