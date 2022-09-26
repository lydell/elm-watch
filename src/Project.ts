import * as os from "os";

import * as ElmJson from "./ElmJson";
import * as ElmWatchJson from "./ElmWatchJson";
import { ElmWatchStuffJson } from "./ElmWatchStuffJson";
import { __ELM_WATCH_MAX_PARALLEL, Env } from "./Env";
import { HashMap } from "./HashMap";
import { HashSet } from "./HashSet";
import { getSetSingleton, silentlyReadIntEnvValue, toError } from "./Helpers";
import { WalkImportsError } from "./ImportWalker";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import {
  absoluteDirname,
  absolutePathFromString,
  absoluteRealpath,
  findClosest,
  longestCommonAncestorPath,
} from "./PathHelpers";
import { Postprocess } from "./Postprocess";
import { PostprocessError } from "./PostprocessShared";
import { RunElmMakeError } from "./SpawnElm";
import type {
  AbsolutePath,
  BrowserUiPosition,
  CompilationMode,
  ElmJsonPath,
  ElmWatchJsonPath,
  ElmWatchStuffDir,
  ElmWatchStuffJsonPath,
  GetNow,
  InputPath,
  OutputPath,
  UncheckedInputPath,
  WriteOutputErrorReasonForWriting,
} from "./Types";

export type Project = {
  // Path to the longest ancestor of elm-watch.json and all elm.json.
  watchRoot: AbsolutePath;
  elmWatchJsonPath: ElmWatchJsonPath;
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath;
  disabledOutputs: HashSet<OutputPath>;
  elmJsonsErrors: Array<ElmJsonErrorWithMetadata>;
  elmJsons: HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>;
  maxParallel: number;
  postprocess: Postprocess;
};

// The code base leans towards pure functions, but this data structure is going
// to be mutated a lot.
export class OutputState {
  // Inputs never change.
  readonly inputs: NonEmptyArray<InputPath>;

  // This one has a method for mutating, for measuring how long time is spent in
  // different statuses.
  private _status: OutputStatus = { tag: "NotWrittenToDisk" };

  private _durations: Array<Duration> = [];

  private _lastStartTimestamp = 0;

  // The remaining properties are mutated from outside the class.

  compilationMode: CompilationMode;

  browserUiPosition: BrowserUiPosition;

  openErrorOverlay = false;

  allRelatedElmFilePaths = new Set<string>();

  // We only calculate `recordFields` in optimize mode. Having `| undefined`
  // makes that more clear.
  recordFields: Set<string> | undefined = undefined;

  dirty = true;

  constructor(
    inputs: NonEmptyArray<InputPath>,
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
    openErrorOverlay: boolean,
    private getNow: GetNow
  ) {
    this.inputs = inputs;
    this.compilationMode = compilationMode;
    this.browserUiPosition = browserUiPosition;
    this.openErrorOverlay = openErrorOverlay;
  }

  flushDurations(): Array<Duration> {
    // Clear the durations when getting them. This means that once we have have
    // printed them, we won’t print them again. This way we only show durations
    // for the targets that were affected by the latest compilation cycle.
    const durations = this._durations.slice();
    this._durations.length = 0;
    return durations;
  }

  get status(): OutputStatus {
    return this._status;
  }

  setStatus(status: OutputStatus): void {
    const lastStartTimestamp = this._lastStartTimestamp;
    this._lastStartTimestamp = this.getNow().getTime();

    switch (this._status.tag) {
      case "ElmMake":
        this._durations.push({
          tag: "ElmMake",
          elmDurationMs: this._status.elmDurationMs,
          walkerDurationMs: this._status.walkerDurationMs,
        });
        if (this._status.injectDurationMs !== -1) {
          this._durations.push({
            tag: "Inject",
            durationMs: this._status.injectDurationMs,
          });
        }
        break;

      case "ElmMakeTypecheckOnly":
        this._durations.push({
          tag: "ElmMakeTypecheckOnly",
          elmDurationMs: this._status.elmDurationMs,
          walkerDurationMs: this._status.walkerDurationMs,
        });
        break;

      case "Postprocess":
      case "QueuedForElmMake":
      case "QueuedForPostprocess":
        this._durations.push({
          tag: this._status.tag,
          durationMs: this._lastStartTimestamp - lastStartTimestamp,
        });
        break;

      default:
        this._durations.length = 0;
    }

    this._status = status;
  }
}

export type OutputStatus =
  | OutputError
  | {
      tag: "ElmMake";
      compilationMode: CompilationMode;
      elmDurationMs: number;
      walkerDurationMs: number;
      injectDurationMs: number;
      kill: (options: { force: boolean }) => void;
    }
  | {
      tag: "ElmMakeTypecheckOnly";
      elmDurationMs: number;
      walkerDurationMs: number;
      kill: (options: { force: boolean }) => void;
    }
  | {
      tag: "Interrupted";
    }
  | {
      tag: "NotWrittenToDisk";
    }
  | {
      tag: "Postprocess";
      kill: () => Promise<void> | void;
    }
  | {
      tag: "QueuedForElmMake";
    }
  | {
      tag: "QueuedForPostprocess";
      postprocessArray: NonEmptyArray<string>;
      code: Buffer | string;
      elmCompiledTimestamp: number;
      recordFields: Set<string> | undefined;
    }
  | {
      tag: "Success";
      elmFileSize: number;
      postprocessFileSize: number;
      elmCompiledTimestamp: number;
    };

export type OutputError =
  | ElmJson.ParseError
  | OutputFsError
  | PostprocessError
  | RunElmMakeError
  | WalkImportsError;

type OutputFsError =
  | {
      tag: "ReadOutputError";
      error: Error;
      triedPath: AbsolutePath;
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

export type ElmJsonErrorWithMetadata = {
  outputPath: OutputPath;
  compilationMode: CompilationMode;
  browserUiPosition: BrowserUiPosition;
  openErrorOverlay: boolean;
  error: ElmJsonError;
};

export type Duration =
  | {
      tag: "ElmMake";
      elmDurationMs: number;
      walkerDurationMs: number;
    }
  | {
      tag: "ElmMakeTypecheckOnly";
      elmDurationMs: number;
      walkerDurationMs: number;
    }
  | {
      tag: "Inject";
      durationMs: number;
    }
  | {
      tag: "Postprocess";
      durationMs: number;
    }
  | {
      tag: "QueuedForElmMake";
      durationMs: number;
    }
  | {
      tag: "QueuedForPostprocess";
      durationMs: number;
    };

type InitProjectResult =
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
  getNow,
  compilationMode,
  elmWatchJsonPath,
  config,
  enabledTargetsSubstrings,
  elmWatchStuffDir,
  elmWatchStuffJsonPath,
  elmWatchStuffJson,
}: {
  env: Env;
  getNow: GetNow;
  compilationMode: CompilationMode;
  elmWatchJsonPath: ElmWatchJsonPath;
  config: ElmWatchJson.Config;
  enabledTargetsSubstrings: NonEmptyArray<string>;
  elmWatchStuffDir: ElmWatchStuffDir;
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath;
  elmWatchStuffJson: ElmWatchStuffJson | undefined;
}): InitProjectResult {
  const disabledOutputs = new HashSet<OutputPath>();
  const elmJsonsErrors: Array<ElmJsonErrorWithMetadata> = [];
  const elmJsons = new HashMap<ElmJsonPath, HashMap<OutputPath, OutputState>>();
  const potentialOutputDuplicates = new HashMap<
    AbsolutePath,
    NonEmptyArray<string>
  >();

  for (const [index, [targetName, target]] of Object.entries(
    config.targets
  ).entries()) {
    const outputPath: OutputPath = {
      tag: "OutputPath",
      theOutputPath: absolutePathFromString(
        absoluteDirname(elmWatchJsonPath.theElmWatchJsonPath),
        target.output
      ),
      temporaryOutputPath: absolutePathFromString(
        elmWatchStuffDir.theElmWatchStuffDir,
        `${index}.js`
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

      const persisted = elmWatchStuffJson?.targets[targetName];
      const {
        compilationMode: thisCompilationMode = compilationMode,
        browserUiPosition = "BottomLeft",
        openErrorOverlay = false,
      } = persisted ?? {};

      switch (resolveElmJsonResult.tag) {
        case "Success": {
          const previous =
            elmJsons.get(resolveElmJsonResult.elmJsonPath) ??
            new HashMap<OutputPath, OutputState>();
          previous.set(
            outputPath,
            new OutputState(
              resolveElmJsonResult.inputs,
              thisCompilationMode,
              browserUiPosition,
              openErrorOverlay,
              getNow
            )
          );
          elmJsons.set(resolveElmJsonResult.elmJsonPath, previous);
          break;
        }

        default:
          elmJsonsErrors.push({
            outputPath,
            compilationMode: thisCompilationMode,
            browserUiPosition,
            openErrorOverlay,
            error: resolveElmJsonResult,
          });
          break;
      }
    } else {
      disabledOutputs.add(outputPath);
    }
  }

  const duplicateOutputs = Array.from(potentialOutputDuplicates)
    .filter(([, outputPaths]) => outputPaths.length >= 2)
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
    env[__ELM_WATCH_MAX_PARALLEL],
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
    .filter(([, inputPaths]) => inputPaths.length >= 2)
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
  elmJsonPath: ElmJsonPath;
  outputPath: OutputPath;
  outputState: OutputState;
}> {
  return Array.from(project.elmJsons.entries()).flatMap(
    ([elmJsonPath, outputs]) =>
      Array.from(outputs, ([outputPath, outputState]) => ({
        elmJsonPath,
        outputPath,
        outputState,
      }))
  );
}

export function projectToDebug(project: Project): unknown {
  return {
    watchRoot: project.watchRoot.absolutePath,
    elmWatchJson: project.elmWatchJsonPath.theElmWatchJsonPath.absolutePath,
    elmWatchStuffJson:
      project.elmWatchStuffJsonPath.theElmWatchStuffJsonPath.absolutePath,
    maxParallel: project.maxParallel,
    postprocess: project.postprocess,
    enabledTargets: Array.from(project.elmJsons.entries()).flatMap(
      ([elmJsonPath, outputs]) =>
        Array.from(outputs.entries(), ([outputPath, outputState]) => ({
          ...outputPathToDebug(outputPath),
          compilationMode: outputState.compilationMode,
          elmJson: elmJsonPath.theElmJsonPath.absolutePath,
          inputs: outputState.inputs.map(inputPathToDebug),
        }))
    ),
    disabledTargets: Array.from(project.disabledOutputs, outputPathToDebug),
    erroredTargets: project.elmJsonsErrors.map(
      ({ outputPath, compilationMode, error }) => ({
        error: error.tag,
        ...outputPathToDebug(outputPath),
        compilationMode,
      })
    ),
  };
}

function outputPathToDebug(outputPath: OutputPath): Record<string, unknown> {
  return {
    targetName: outputPath.targetName,
    output: outputPath.theOutputPath.absolutePath,
    temporaryOutput: outputPath.temporaryOutputPath.absolutePath,
    originalString: outputPath.originalString,
  };
}

function inputPathToDebug(inputPath: InputPath): Record<string, unknown> {
  return {
    input: inputPath.theInputPath.absolutePath,
    realpath: inputPath.realpath.absolutePath,
    originalString: inputPath.originalString,
  };
}
