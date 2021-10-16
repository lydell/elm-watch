import * as os from "os";

import * as ElmJson from "./ElmJson";
import * as ElmWatchJson from "./ElmWatchJson";
import { ElmWatchStuffJson } from "./ElmWatchStuffJson";
import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import {
  Env,
  getSetSingleton,
  silentlyReadIntEnvValue,
  toError,
} from "./Helpers";
import { WalkImportsError } from "./ImportWalker";
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
import { Postprocess, PostprocessError } from "./Postprocess";
import { RunElmMakeError } from "./SpawnElm";
import type {
  CompilationMode,
  ElmJsonPath,
  ElmWatchJsonPath,
  ElmWatchStuffJsonPath,
  InputPath,
  OutputPath,
} from "./Types";

// The code base leans towards pure functions, but this data structure is going
// to be mutated a lot, so it’s the trickiest part. The properties without
// `readonly` are the ones that are mutated.
export type Project = {
  // Path to the longest ancestor of elm-watch.json and all elm.json.
  readonly watchRoot: AbsolutePath;
  readonly elmWatchJsonPath: ElmWatchJsonPath;
  readonly elmWatchStuffJsonPath: ElmWatchStuffJsonPath;
  readonly disabledOutputs: HashSet<OutputPath>;
  readonly elmJsonsErrors: Array<{
    outputPath: OutputPath;
    error: ElmJsonError;
  }>;
  readonly elmJsons: HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>;
  readonly maxParallel: number;
  readonly postprocess: Postprocess;
};

export type OutputState = {
  readonly inputs: NonEmptyArray<InputPath>;
  compilationMode: CompilationMode;
  status: OutputStatus;
  allRelatedElmFilePaths: Set<string>;
  dirty: boolean;
};

export type OutputStatus =
  | OutputError
  | {
      tag: "ElmMake";
      compilationMode: CompilationMode;
    }
  | {
      tag: "ElmMakeTypecheckOnly";
    }
  | {
      tag: "Interrupted";
    }
  | {
      tag: "NotWrittenToDisk";
    }
  | {
      tag: "Postprocess";
    }
  | {
      tag: "QueuedForElmMake";
    }
  | {
      tag: "QueuedForPostprocess";
      postprocessArray: NonEmptyArray<string>;
      code: Buffer | string;
    }
  | {
      tag: "Success";
      fileSize: number;
      compiledTimestamp: number;
    };

export type OutputError =
  | ElmJson.ParseError
  | OutputFsError
  | PostprocessError
  | RunElmMakeError
  | WalkImportsError;

export type OutputFsError =
  | {
      tag: "ReadOutputError";
      error: Error;
    }
  | {
      tag: "WriteOutputError";
      error: Error;
      reasonForWriting: WriteOutputErrorReasonForWriting;
    }
  | {
      tag: "WriteProxyOutputError";
      error: Error;
    };

export type WriteOutputErrorReasonForWriting =
  | "InjectWebSocketClient"
  | "Postprocess";

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
      tag: "DuplicateOutputs";
      duplicates: NonEmptyArray<{
        originalOutputPathStrings: NonEmptyArray<string>;
        absolutePath: AbsolutePath;
      }>;
    }
  | {
      tag: "NoCommonRoot";
      paths: NonEmptyArray<AbsolutePath>;
    }
  | {
      tag: "Project";
      project: Project;
    };

export function initProject({
  env,
  compilationMode,
  elmWatchJsonPath,
  config,
  enabledTargetsSubstrings,
  elmWatchStuffJsonPath,
  elmWatchStuffJson,
}: {
  env: Env;
  compilationMode: CompilationMode;
  elmWatchJsonPath: ElmWatchJsonPath;
  config: ElmWatchJson.Config;
  enabledTargetsSubstrings: NonEmptyArray<string>;
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath;
  elmWatchStuffJson: ElmWatchStuffJson | undefined;
}): InitProjectResult {
  const disabledOutputs = new HashSet<OutputPath>();
  const elmJsonsErrors: Array<{ outputPath: OutputPath; error: ElmJsonError }> =
    [];
  const elmJsons = new HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>();
  const potentialOutputDuplicates = new HashMap<
    AbsolutePath,
    NonEmptyArray<string>
  >();

  for (const [targetName, target] of Object.entries(config.targets)) {
    const outputPath: OutputPath = {
      tag: "OutputPath",
      theOutputPath: absolutePathFromString(
        absoluteDirname(elmWatchJsonPath.theElmWatchJsonPath),
        target.output
      ),
      originalString: target.output,
      targetName,
    };

    const previousOutput = potentialOutputDuplicates.get(
      outputPath.theOutputPath
    );
    if (previousOutput === undefined) {
      potentialOutputDuplicates.set(outputPath.theOutputPath, [
        outputPath.originalString,
      ]);
    } else {
      previousOutput.push(outputPath.originalString);
    }

    if (
      enabledTargetsSubstrings.some((substring) =>
        targetName.includes(substring)
      )
    ) {
      const resolveElmJsonResult = resolveElmJson(
        elmWatchJsonPath,
        target.inputs
      );

      switch (resolveElmJsonResult.tag) {
        case "Success": {
          const previous =
            elmJsons.get(resolveElmJsonResult.elmJsonPath) ??
            new HashMap<OutputPath, OutputState>();
          const persisted = elmWatchStuffJson?.targets[targetName];
          previous.set(outputPath, {
            inputs: resolveElmJsonResult.inputs,
            compilationMode:
              persisted === undefined
                ? compilationMode
                : persisted.compilationMode,
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

  const duplicateOutputs = Array.from(potentialOutputDuplicates)
    .filter(([_, outputPaths]) => outputPaths.length >= 2)
    .map(([absolutePath, originalOutputPathStrings]) => ({
      originalOutputPathStrings,
      absolutePath,
    }));

  if (isNonEmptyArray(duplicateOutputs)) {
    return {
      tag: "DuplicateOutputs",
      duplicates: duplicateOutputs,
    };
  }

  const paths = mapNonEmptyArray(
    [
      elmWatchJsonPath.theElmWatchJsonPath,
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

  const maxParallel = silentlyReadIntEnvValue(
    env.ELM_WATCH_MAX_PARALLEL,
    os.cpus().length
  );

  const postprocess: Postprocess =
    config.postprocess === undefined
      ? { tag: "NoPostprocess" }
      : { tag: "Postprocess", postprocessArray: config.postprocess };

  return {
    tag: "Project",
    project: {
      watchRoot,
      elmWatchJsonPath,
      elmWatchStuffJsonPath,
      disabledOutputs,
      elmJsonsErrors,
      elmJsons,
      maxParallel,
      postprocess,
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
  elmWatchJsonPath: ElmWatchJsonPath,
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
        absoluteDirname(elmWatchJsonPath.theElmWatchJsonPath),
        inputString
      ),
      originalString: inputString,
    };

    let realpath;
    try {
      realpath = absoluteRealpath(uncheckedInputPath.theUncheckedInputPath);
    } catch (unknownError) {
      const error = toError(unknownError);
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

  const duplicateInputs = Array.from(resolved)
    .filter(([_, inputPaths]) => inputPaths.length >= 2)
    .map(([resolvedPath, inputPaths]) => ({
      resolved: resolvedPath,
      inputs: inputPaths,
    }));

  if (isNonEmptyArray(duplicateInputs)) {
    return {
      tag: "DuplicateInputs",
      duplicates: duplicateInputs,
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

export function getFlatOutputs(project: Project): Array<{
  outputPath: OutputPath;
  outputState: OutputState;
}> {
  return Array.from(project.elmJsons.values()).flatMap((outputs) =>
    Array.from(outputs, ([outputPath, outputState]) => ({
      outputPath,
      outputState,
    }))
  );
}
