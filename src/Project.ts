import * as ElmJson from "./ElmJson";
import * as ElmToolingJson from "./ElmToolingJson";
import { ElmWatchJson } from "./ElmWatchJson";
import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import { getSetSingleton } from "./Helpers";
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
import { PostprocessError } from "./Postprocess";
import { RunElmMakeError } from "./SpawnElm";
import type {
  CompilationMode,
  ElmJsonPath,
  ElmToolingJsonPath,
  ElmWatchJsonPath,
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
  readonly elmWatchJsonPath: ElmWatchJsonPath;
  readonly disabledOutputs: HashSet<OutputPath>;
  readonly elmJsonsErrors: Array<{
    outputPath: OutputPath;
    error: ElmJsonError;
  }>;
  readonly elmJsons: HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>;
};

export type OutputState = {
  readonly inputs: NonEmptyArray<InputPath>;
  compilationMode: CompilationMode;
  readonly postprocess?: NonEmptyArray<string>;
  status: OutputStatus;
  allRelatedElmFilePaths: Set<string>;
  dirty: boolean;
};

export type OutputStatus =
  | OutputError
  | {
      tag: "Success";
      newOutputPath: OutputPath | undefined;
      compiledTimestamp: number;
    }
  | { tag: "ElmMake"; compilationMode: CompilationMode }
  | { tag: "ElmMakeTypecheckOnly" }
  | { tag: "Interrupted" }
  | { tag: "NotWrittenToDisk" }
  | { tag: "Postprocess" }
  | { tag: "QueuedForElmMake" }
  | { tag: "QueuedForPostprocess" };

export type OutputError =
  | ElmJson.ParseError
  | PostprocessError
  | RunElmMakeError
  | WalkImportsError;

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
  compilationMode,
  elmToolingJsonPath,
  config,
  enabledOutputs,
  elmWatchJsonPath,
  elmWatchJson,
}: {
  compilationMode: CompilationMode;
  elmToolingJsonPath: ElmToolingJsonPath;
  config: ElmToolingJson.Config;
  enabledOutputs: Set<string>;
  elmWatchJsonPath: ElmWatchJsonPath;
  elmWatchJson: ElmWatchJson | undefined;
}): InitProjectResult {
  const disabledOutputs = new HashSet<OutputPath>();
  const elmJsonsErrors: Array<{ outputPath: OutputPath; error: ElmJsonError }> =
    [];
  const elmJsons = new HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>();
  const potentialOutputDuplicates = new HashMap<
    AbsolutePath,
    NonEmptyArray<string>
  >();

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

    switch (outputPath.tag) {
      case "NullOutputPath":
        break;

      case "OutputPath": {
        const previous = potentialOutputDuplicates.get(
          outputPath.theOutputPath
        );
        if (previous === undefined) {
          potentialOutputDuplicates.set(outputPath.theOutputPath, [
            outputPath.originalString,
          ]);
        } else {
          previous.push(outputPath.originalString);
        }
        break;
      }
    }

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
          const persisted = elmWatchJson?.outputs[outputPathString];
          previous.set(outputPath, {
            inputs: resolveElmJsonResult.inputs,
            compilationMode:
              persisted === undefined
                ? compilationMode
                : persisted.compilationMode,
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
      elmWatchJsonPath,
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

export function isExecuting(outputState: OutputState): boolean {
  switch (outputState.status.tag) {
    case "ElmMake":
    case "ElmMakeTypecheckOnly":
    case "Postprocess":
      return true;

    default:
      return false;
  }
}

type FlatOutput = {
  index: number;
  elmJsonPath: ElmJsonPath;
  outputPath: OutputPath;
  outputState: OutputState;
};

export function getFlatOutputs(project: Project): Array<FlatOutput> {
  let index = 0;
  const result = [];
  for (const [elmJsonPath, outputs] of project.elmJsons) {
    for (const [outputPath, outputState] of outputs) {
      result.push({ index, elmJsonPath, outputPath, outputState });
      index++;
    }
  }
  return result;
}

type OutputAction =
  | NeedsElmMakeOutputAction
  | NeedsPostprocessOutputAction
  | QueueOutputAction;

type NeedsElmMakeOutputAction = {
  tag: "NeedsElmMake";
  output: FlatOutput;
  source: "Dirty" | "Queued";
};

type NeedsPostprocessOutputAction = {
  tag: "NeedsPostprocess";
  output: FlatOutput;
};

type QueueOutputAction =
  | {
      tag: "QueueForElmMake";
      output: FlatOutput;
    }
  | {
      tag: "QueueForPostprocess";
      output: FlatOutput;
    };

export function getOutputActions(
  project: Project,
  runMode: RunMode,
  maxParallel: number
): {
  total: number;
  actions: Array<OutputAction>;
  outputsWithoutAction: Array<FlatOutput>;
} {
  let index = 0;
  let numExecuting = 0;
  const elmMakeActions: Array<NeedsElmMakeOutputAction> = [];
  const postprocessActions: Array<NeedsPostprocessOutputAction> = [];
  const queueActions: Array<QueueOutputAction> = [];
  const outputsWithoutAction: Array<FlatOutput> = [];

  for (const [elmJsonPath, outputs] of project.elmJsons) {
    let elmMakeBusy = Array.from(outputs.values()).some((outputState) => {
      switch (outputState.status.tag) {
        case "ElmMake":
        case "ElmMakeTypecheckOnly":
          return true;
        default:
          return false;
      }
    });

    for (const [outputPath, outputState] of outputs) {
      const flatOutput: FlatOutput = {
        index,
        elmJsonPath,
        outputPath,
        outputState,
      };
      index++;

      if (isExecuting(outputState)) {
        numExecuting++;
        outputsWithoutAction.push(flatOutput);
      } else if (!outputState.dirty) {
        outputsWithoutAction.push(flatOutput);
      } else {
        switch (outputState.status.tag) {
          case "QueuedForElmMake":
            if (elmMakeBusy) {
              outputsWithoutAction.push(flatOutput);
            } else {
              elmMakeActions.push({
                tag: "NeedsElmMake",
                output: flatOutput,
                source: "Queued",
              });
              elmMakeBusy = true;
            }
            break;

          case "QueuedForPostprocess":
            postprocessActions.push({
              tag: "NeedsPostprocess",
              output: flatOutput,
            });
            break;

          default:
            if (elmMakeBusy) {
              queueActions.push({
                tag: "QueueForElmMake",
                output: flatOutput,
              });
            } else {
              elmMakeActions.push({
                tag: "NeedsElmMake",
                output: flatOutput,
                source: "Dirty",
              });
              elmMakeBusy = true;
            }
            break;
        }
      }
    }
  }

  const prioritizedActions = prioritizeActions(
    runMode,
    elmMakeActions,
    postprocessActions
  );

  const threadsLeft = Math.max(0, maxParallel - numExecuting);

  const actions = prioritizedActions.slice(0, threadsLeft);

  for (const action of prioritizedActions.slice(threadsLeft)) {
    switch (action.tag) {
      case "NeedsElmMake":
        switch (action.source) {
          case "Dirty":
            queueActions.push({
              tag: "QueueForElmMake",
              output: action.output,
            });
            break;

          case "Queued":
            outputsWithoutAction.push(action.output);
            break;
        }
        break;

      case "NeedsPostprocess":
        outputsWithoutAction.push(action.output);
        break;
    }
  }

  return {
    total: index,
    actions: [...actions, ...queueActions],
    outputsWithoutAction,
  };
}

function prioritizeActions(
  runMode: RunMode,
  elmMakeActions: Array<NeedsElmMakeOutputAction>,
  postprocessActions: Array<NeedsPostprocessOutputAction>
): Array<NeedsElmMakeOutputAction | NeedsPostprocessOutputAction> {
  switch (runMode) {
    // In `make` mode, you want to find type errors as quickly as possible (the
    // most likely CI failure). Don’t let slow postprocessing delay that.
    case "make":
      return [...elmMakeActions, ...postprocessActions];

    // In `hot` mode, try to finish each output as fast as possible, rather than
    // make all of them “evenly slow”.
    case "hot":
      return [...postprocessActions, ...elmMakeActions];
  }
}
