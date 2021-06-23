import * as ElmJson from "./ElmJson";
import * as ElmToolingJson from "./ElmToolingJson";
import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import { getSetSingleton } from "./Helpers";
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
  findClosest,
  longestCommonAncestorPath,
} from "./PathHelpers";
import { PostprocessResult } from "./Postprocess";
import { ElmMakeResult } from "./SpawnElm";
import type {
  CompilationMode,
  ElmJsonPath,
  ElmToolingJsonPath,
  InputPath,
  OutputPath,
  RunMode,
} from "./Types";

// The code base leans towards pure functions, but this data structure is going
// to be mutated a lot, so it’s the trickiest part. The properties without
// `readonly` are the ones that are mutated.
export type Project = {
  // Path to the longest ancestor of elm-tooling.json and all elm.json.
  readonly watchRoot: AbsolutePath;
  readonly elmToolingJsonPath: ElmToolingJsonPath;
  readonly disabledOutputs: HashSet<OutputPath>;
  readonly elmJsonsErrors: Array<{
    outputPath: OutputPath;
    error: ElmJsonError;
  }>;
  readonly elmJsons: HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>;
};

export type OutputState = {
  readonly inputs: NonEmptyArray<InputPath>;
  readonly mode: CompilationMode;
  readonly postprocess?: NonEmptyArray<string>;
  status: OutputStatus;
  allRelatedElmFilePaths: Set<string>;
  dirty: boolean;
};

export type OutputStatus =
  | ElmJson.ParseError
  | ElmMakeResult
  | PostprocessResult
  | { tag: "ElmMake" }
  | { tag: "ImportWalkerFileSystemError"; error: Error }
  | { tag: "Interrupted" }
  | { tag: "NotWrittenToDisk" }
  | { tag: "Postprocess" };

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
      elmJsonNotFound: NonEmptyArray<InputPath>;
      foundElmJsonPaths: Array<{
        inputPath: InputPath;
        elmJsonPath: ElmJsonPath;
      }>;
    }
  | {
      tag: "InputsFailedToResolve";
      inputsFailedToResolve: NonEmptyArray<{
        inputPath: UncheckedInputPath;
        error: Error;
      }>;
    }
  | {
      tag: "InputsNotFound";
      inputsNotFound: NonEmptyArray<UncheckedInputPath>;
    }
  | {
      tag: "NonUniqueElmJsonPaths";
      nonUniqueElmJsonPaths: NonEmptyArray<{
        inputPath: InputPath;
        elmJsonPath: ElmJsonPath;
      }>;
    };

export type UncheckedInputPath = {
  tag: "UncheckedInputPath";
  theUncheckedInputPath: AbsolutePath;
  originalString: string;
};

export type InitProjectResult =
  | {
      tag: "NoCommonRoot";
      paths: NonEmptyArray<AbsolutePath>;
    }
  | {
      tag: "Project";
      project: Project;
    };

export function initProject({
  compilationMode,
  elmToolingJsonPath,
  config,
  enabledOutputs,
}: {
  runMode: RunMode;
  compilationMode: CompilationMode;
  elmToolingJsonPath: ElmToolingJsonPath;
  config: ElmToolingJson.Config;
  enabledOutputs: Set<string>;
}): InitProjectResult {
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
              absoluteDirname(elmToolingJsonPath.theElmToolingJsonPath),
              outputPathString
            ),
            originalString: outputPathString,
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
            postprocess: output.postprocess,
            status: { tag: "NotWrittenToDisk" },
            allRelatedElmFilePaths: new Set(),
            dirty: true,
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

  const watchRoot = longestCommonAncestorPath(paths);

  // istanbul ignore if
  if (watchRoot === undefined) {
    return { tag: "NoCommonRoot", paths };
  }

  return {
    tag: "Project",
    project: {
      watchRoot,
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
      inputs: NonEmptyArray<InputPath>;
    };

function resolveElmJson(
  elmToolingJsonPath: ElmToolingJsonPath,
  inputStrings: NonEmptyArray<string>
): ResolveElmJsonResult {
  const inputs: Array<InputPath> = [];
  const inputsNotFound: Array<UncheckedInputPath> = [];
  const inputsFailedToResolve: Array<{
    inputPath: UncheckedInputPath;
    error: Error;
  }> = [];
  const resolved = new HashMap<AbsolutePath, NonEmptyArray<InputPath>>();

  for (const inputString of inputStrings) {
    const uncheckedInputPath: UncheckedInputPath = {
      tag: "UncheckedInputPath",
      theUncheckedInputPath: absolutePathFromString(
        absoluteDirname(elmToolingJsonPath.theElmToolingJsonPath),
        inputString
      ),
      originalString: inputString,
    };

    let realpath;
    try {
      realpath = absoluteRealpath(uncheckedInputPath.theUncheckedInputPath);
    } catch (errorAny) {
      const error = errorAny as Error & { code?: string };
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        inputsNotFound.push(uncheckedInputPath);
      } else {
        inputsFailedToResolve.push({ inputPath: uncheckedInputPath, error });
      }
      continue;
    }

    const inputPath: InputPath = {
      tag: "InputPath",
      theInputPath: uncheckedInputPath.theUncheckedInputPath,
      originalString: inputString,
      realpath,
    };

    const previous = resolved.get(realpath);
    if (previous === undefined) {
      resolved.set(realpath, [inputPath]);
    } else {
      previous.push(inputPath);
    }

    inputs.push(inputPath);
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

  if (isNonEmptyArray(elmJsonNotFound)) {
    return {
      tag: "ElmJsonNotFound",
      elmJsonNotFound,
      foundElmJsonPaths: elmJsonPaths,
    };
  }

  const elmJsonPathsSet = new HashSet(
    elmJsonPaths.map(({ elmJsonPath }) => elmJsonPath)
  );

  const uniqueElmJsonPath = getSetSingleton(elmJsonPathsSet);

  if (uniqueElmJsonPath === undefined) {
    return {
      tag: "NonUniqueElmJsonPaths",
      // At this point we know for sure that `elmJsonPaths` must be non-empty.
      nonUniqueElmJsonPaths: elmJsonPaths as NonEmptyArray<{
        inputPath: InputPath;
        elmJsonPath: ElmJsonPath;
      }>,
    };
  }

  return {
    tag: "Success",
    elmJsonPath: uniqueElmJsonPath,
    // At this point we know for sure that `inputs` must be non-empty.
    inputs: inputs as NonEmptyArray<InputPath>,
  };
}
