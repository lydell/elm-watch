import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  type AllowedHost,
  allowedHostFromUrl,
  getAllowedHostsFromEnv,
} from "./AllowedHosts.ts";
import type { Config, ConfigSource } from "./Config.ts";
import * as ElmJson from "./ElmJson.ts";
import type { ElmWatchStuffJson } from "./ElmWatchStuffJson.ts";
import {
  __ELM_WATCH_MAX_PARALLEL,
  ELM_WATCH_WEBSOCKET_URL,
  type Env,
} from "./Env.ts";
import {
  getSetSingleton,
  silentlyReadIntEnvValue,
  toError,
} from "./Helpers.ts";
import { DEFAULT_HOST, getHostFromEnv, type Host } from "./Host.ts";
import type { WalkImportsError } from "./ImportWalker.ts";
import { isNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray.ts";
import {
  absoluteDirname,
  absolutePathFromString,
  absoluteRealpath,
  findClosest,
} from "./PathHelpers.ts";
import type {
  Postprocess,
  PostprocessError,
  PostprocessToRun,
} from "./Postprocess.ts";
import type { RunElmMakeError } from "./SpawnElm.ts";
import {
  type AbsolutePath,
  type BrowserUiPosition,
  type CompilationMode,
  type ElmJsonPath,
  type ElmWatchStuffDir,
  type ElmWatchStuffJsonPath,
  type GetNow,
  type InputPath,
  markAsElmJsonPath,
  markAsStaticFilesDir,
  markAsTargetName,
  type OutputPath,
  type StaticFilesDir,
  type UncheckedInputPath,
  type WriteOutputErrorReasonForWriting,
} from "./Types.ts";
import type { WatchDir } from "./Watcher.ts";
import { WebSocketUrl } from "./WebSocketUrl.ts";

export type Project = {
  watchDirs: Array<WatchDir>;
  // Source directories that did not exist when the project was initialized.
  missingSourceDirectories: Set<AbsolutePath>;
  root: AbsolutePath;
  staticFilesDir: StaticFilesDir | undefined;
  configSource: ConfigSource;
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath;
  disabledOutputs: Array<OutputPath>;
  elmJsonsErrors: Array<ElmJsonErrorWithMetadata>;
  elmJsons: Map<ElmJsonPath, Array<[OutputPath, OutputState]>>;
  maxParallel: number;
  host: Host;
  webSocketUrl: WebSocketUrl | undefined;
  allowedHosts: Array<AllowedHost>;
};

// The code base leans towards pure functions, but this data structure is going
// to be mutated a lot.
export class OutputState {
  // Inputs never change.
  readonly inputs: NonEmptyArray<InputPath>;

  readonly postprocess: Postprocess;

  // This one has a method for mutating, for measuring how long time is spent in
  // different statuses.
  private _status: OutputStatus = { tag: "NotWrittenToDisk" };

  private _durations: Array<Duration> = [];

  private _lastStartTimestamp = 0;

  // The remaining properties are mutated from outside the class.

  compilationMode: CompilationMode;

  browserUiPosition: BrowserUiPosition;

  openErrorOverlay = false;

  allRelatedElmFilePaths = new Set<AbsolutePath>();

  // We only calculate `recordFields` in optimize mode. Having `| undefined`
  // makes that more clear.
  recordFields: Set<string> | undefined = undefined;

  dirty = true;

  private getNow: GetNow;

  constructor(
    inputs: NonEmptyArray<InputPath>,
    postprocess: Postprocess,
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
    openErrorOverlay: boolean,
    getNow: GetNow,
  ) {
    this.getNow = getNow;
    this.inputs = inputs;
    this.postprocess = postprocess;
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
      kill: () => void;
    }
  | {
      tag: "QueuedForElmMake";
    }
  | {
      tag: "QueuedForPostprocess";
      postprocess: PostprocessToRun;
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
  | ElmJson.ElmJsonParseError
  | OutputFsError
  | PostprocessError
  | RunElmMakeError
  | WalkImportsError;

type OutputFsError =
  | {
      tag: "NeedsToWriteProxyFileReadError";
      error: Error;
      triedPath: AbsolutePath;
    }
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
      tag: "Project";
      project: Project;
    };

export function initProject({
  env,
  getNow,
  compilationMode,
  config,
  enabledTargetsSubstrings,
  elmWatchStuffDir,
  elmWatchStuffJsonPath,
  elmWatchStuffJson,
}: {
  env: Env;
  getNow: GetNow;
  compilationMode: CompilationMode;
  config: Config;
  enabledTargetsSubstrings: NonEmptyArray<string>;
  elmWatchStuffDir: ElmWatchStuffDir;
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath;
  elmWatchStuffJson: ElmWatchStuffJson | undefined;
}): InitProjectResult {
  const disabledOutputs: Array<OutputPath> = [];
  const elmJsonsErrors: Array<ElmJsonErrorWithMetadata> = [];
  const elmJsons = new Map<ElmJsonPath, Array<[OutputPath, OutputState]>>();
  const enabledInputPaths: Array<AbsolutePath> = [];
  const potentialOutputDuplicates = new Map<
    AbsolutePath,
    NonEmptyArray<string>
  >();

  for (const [index, target] of config.targets.entries()) {
    const targetName = target.name;
    const outputPath: OutputPath = {
      tag: "OutputPath",
      theOutputPath: absolutePathFromString(config.root, target.output),
      temporaryOutputPath: absolutePathFromString(
        elmWatchStuffDir,
        `${index}.js`,
      ),
      originalString: target.output,
      targetName: markAsTargetName(targetName),
    };

    const previousOutput = potentialOutputDuplicates.get(
      outputPath.theOutputPath,
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
        targetName.includes(substring),
      )
    ) {
      const resolveElmJsonResult = resolveElmJson(config.root, target.inputs);
      enabledInputPaths.push(
        ...target.inputs.map((inputString) =>
          absolutePathFromString(config.root, inputString),
        ),
      );

      const persisted = elmWatchStuffJson?.targets[targetName];
      const {
        compilationMode: thisCompilationMode = compilationMode,
        browserUiPosition = "BottomLeft",
        openErrorOverlay = false,
      } = persisted ?? {};

      switch (resolveElmJsonResult.tag) {
        case "Success": {
          const previous = elmJsons.get(resolveElmJsonResult.elmJsonPath) ?? [];
          previous.push([
            outputPath,
            new OutputState(
              resolveElmJsonResult.inputs,
              target.postprocess === undefined
                ? { tag: "NoPostprocess" }
                : {
                    tag: "Postprocess",
                    postprocessFunction: target.postprocess,
                  },
              thisCompilationMode,
              browserUiPosition,
              openErrorOverlay,
              getNow,
            ),
          ]);
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
      disabledOutputs.push(outputPath);
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

  const staticFilesDir: StaticFilesDir | undefined =
    config.staticFilesDir === undefined
      ? undefined
      : markAsStaticFilesDir(
          absolutePathFromString(config.root, config.staticFilesDir),
        );

  const watchDirs = getWatchDirs({
    configSource: config.source,
    elmJsonPaths: Array.from(elmJsons.keys()),
    inputPaths: enabledInputPaths,
    staticFilesDir,
  });

  const maxParallel = silentlyReadIntEnvValue(
    env[__ELM_WATCH_MAX_PARALLEL],
    os.cpus().length,
  );

  // The environment variables are for elm-watch.json. With the JavaScript API,
  // you can read environment variables yourself.
  const isElmWatchJson = config.source.tag === "ElmWatchJson";

  const host =
    config.host ??
    (isElmWatchJson ? getHostFromEnv(env) : undefined) ??
    DEFAULT_HOST;

  const webSocketUrl =
    (isElmWatchJson ? getWebSocketUrlFromEnv(env) : undefined) ??
    config.webSocketUrl;

  // If you connect the WebSocket via some custom host, that host should be
  // allowed. It’s typically also the host of the page.
  const allowedHosts = Array.from(
    new Set([
      ...config.allowedHosts,
      ...(isElmWatchJson ? getAllowedHostsFromEnv(env) : []),
      ...(webSocketUrl === undefined
        ? []
        : [allowedHostFromUrl(webSocketUrl.url)]),
    ]),
  );

  return {
    tag: "Project",
    project: {
      watchDirs,
      missingSourceDirectories: new Set(
        watchDirs.flatMap(({ tag, dir }) =>
          tag === "SourceDirectory" && !fs.existsSync(dir) ? [dir] : [],
        ),
      ),
      root: config.root,
      staticFilesDir,
      configSource: config.source,
      elmWatchStuffJsonPath,
      disabledOutputs,
      elmJsonsErrors,
      elmJsons,
      maxParallel,
      host,
      webSocketUrl,
      allowedHosts,
    },
  };
}

// Only source directories (and the static files directory) are watched
// recursively. Other directories are only watched shallowly, to avoid watching
// lots of irrelevant files: https://github.com/lydell/elm-watch/issues/106
function getWatchDirs({
  configSource,
  elmJsonPaths,
  inputPaths,
  staticFilesDir,
}: {
  configSource: ConfigSource;
  elmJsonPaths: Array<ElmJsonPath>;
  inputPaths: Array<AbsolutePath>;
  staticFilesDir: StaticFilesDir | undefined;
}): Array<WatchDir> {
  const shallow = (dir: AbsolutePath): WatchDir => ({ tag: "Shallow", dir });
  return [
    ...elmJsonPaths.flatMap((elmJsonPath): Array<WatchDir> => {
      // The directory with elm.json also contains elm-stuff, which we want to
      // know if it is removed. Same thing for elm-stuff/0.19.1 (see Hot.ts).
      const elmJsonDir = absoluteDirname(elmJsonPath);
      const elmJsonDirs = [
        shallow(elmJsonDir),
        shallow(absolutePathFromString(elmJsonDir, "elm-stuff")),
      ];
      // This is a bit weird, but we can actually ignore errors here. Some facts:
      // - We want to run Elm even if the elm.json is invalid, because Elm has
      //   really nice error messages.
      // - We run `ElmJson.readSourceDirectories` again later and do report the errors then.
      //   (But in practice you won’t see them because we show Elm’s errors instead.)
      // - Regardless of whether we report the errors here we can’t know the
      //   source directories until elm.json becomes valid. Once it is, we
      //   restart and watch them.
      const result = ElmJson.readSourceDirectories(elmJsonPath);
      switch (result.tag) {
        case "Parsed":
          return [
            ...elmJsonDirs,
            ...result.sourceDirectories.map((dir): WatchDir => ({
              tag: "SourceDirectory",
              dir,
            })),
          ];

        case "ElmJsonReadError":
        case "ElmJsonDecodeError":
          return elmJsonDirs;
      }
    }),
    // Inputs might not be in a source directory, or might not exist (yet).
    // Also, an elm.json might be added closer to an input, or be missing.
    ...inputPaths.flatMap((inputPath) =>
      ancestorsUntilContaining("elm.json", absoluteDirname(inputPath)).map(
        shallow,
      ),
    ),
    // An elm-watch.json might be added closer to cwd.
    ...(configSource.tag === "ElmWatchJson"
      ? ancestorsUntilContaining("elm-watch.json", configSource.cwd).map(
          shallow,
        )
      : []),
    ...(staticFilesDir === undefined
      ? []
      : [{ tag: "StaticFilesDir", dir: staticFilesDir } satisfies WatchDir]),
  ];
}

// Returns `dir` and its ancestors, up to and including the first one that
// contains `name`. If none does, all the way up to the root.
function ancestorsUntilContaining(
  name: string,
  dir: AbsolutePath,
): Array<AbsolutePath> {
  const result: Array<AbsolutePath> = [];
  let current = dir;
  for (;;) {
    result.push(current);
    const parent = absoluteDirname(current);
    if (fs.existsSync(path.join(current, name)) || parent === current) {
      return result;
    }
    current = parent;
  }
}

function getWebSocketUrlFromEnv(env: Env): WebSocketUrl | undefined {
  const envWebSocketUrlString = env[ELM_WATCH_WEBSOCKET_URL];

  if (envWebSocketUrlString === undefined) {
    return undefined;
  }

  const decoderResult = WebSocketUrl("Env").decoder(envWebSocketUrlString);
  switch (decoderResult.tag) {
    case "Valid":
      return decoderResult.value;
    case "DecoderError":
      // Invalid environment variables are silently ignored.
      return undefined;
  }
}

type ResolveElmJsonResult =
  | ElmJsonError
  | {
      tag: "Success";
      elmJsonPath: ElmJsonPath;
      inputs: NonEmptyArray<InputPath>;
    };

function resolveElmJson(
  root: AbsolutePath,
  inputStrings: NonEmptyArray<string>,
): ResolveElmJsonResult {
  const inputs: Array<InputPath> = [];
  const inputsNotFound: Array<UncheckedInputPath> = [];
  const inputsFailedToResolve: Array<{
    inputPath: UncheckedInputPath;
    error: Error;
  }> = [];
  const resolved = new Map<AbsolutePath, NonEmptyArray<InputPath>>();

  for (const inputString of inputStrings) {
    const uncheckedInputPath: UncheckedInputPath = {
      tag: "UncheckedInputPath",
      theUncheckedInputPath: absolutePathFromString(root, inputString),
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
      absoluteDirname(inputPath.theInputPath),
    );
    if (elmJsonPathRaw === undefined) {
      elmJsonNotFound.push(inputPath);
    } else {
      elmJsonPaths.push({
        inputPath,
        elmJsonPath: markAsElmJsonPath(elmJsonPathRaw),
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

  const elmJsonPathsSet = new Set(
    elmJsonPaths.map(({ elmJsonPath }) => elmJsonPath),
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
      outputs.map(([outputPath, outputState]) => ({
        elmJsonPath,
        outputPath,
        outputState,
      })),
  );
}

// This needs to be kept in sync with `Errors.fancyToPlainErrorLocation`.
export function projectHasFilePathThatCanBeOpenedInEditor(
  project: Project,
  filePath: AbsolutePath,
): boolean {
  return (
    (project.configSource.tag === "ElmWatchJson" &&
      filePath === project.configSource.elmWatchJsonPath) ||
    filePath === project.elmWatchStuffJsonPath ||
    getFlatOutputs(project).some(
      ({ elmJsonPath, outputState }) =>
        filePath === elmJsonPath ||
        outputState.allRelatedElmFilePaths.has(filePath),
    )
  );
}

export function projectToDebug(project: Project): unknown {
  return {
    watchDirs: project.watchDirs,
    staticFilesDir: project.staticFilesDir,
    webSocketUrl: project.webSocketUrl,
    allowedHosts: project.allowedHosts,
    elmWatchJson:
      project.configSource.tag === "ElmWatchJson"
        ? project.configSource.elmWatchJsonPath
        : undefined,
    elmWatchStuffJson: project.elmWatchStuffJsonPath,
    maxParallel: project.maxParallel,
    enabledTargets: Array.from(project.elmJsons.entries()).flatMap(
      ([elmJsonPath, outputs]) =>
        outputs.map(([outputPath, outputState]) => ({
          ...outputPathToDebug(outputPath),
          compilationMode: outputState.compilationMode,
          postprocess: outputState.postprocess.tag === "Postprocess",
          elmJson: elmJsonPath,
          inputs: outputState.inputs.map(inputPathToDebug),
        })),
    ),
    disabledTargets: Array.from(project.disabledOutputs, outputPathToDebug),
    erroredTargets: project.elmJsonsErrors.map(
      ({ outputPath, compilationMode, error }) => ({
        error: error.tag,
        ...outputPathToDebug(outputPath),
        compilationMode,
      }),
    ),
  };
}

function outputPathToDebug(outputPath: OutputPath): Record<string, unknown> {
  return {
    targetName: outputPath.targetName,
    output: outputPath.theOutputPath,
    temporaryOutput: outputPath.temporaryOutputPath,
    originalString: outputPath.originalString,
  };
}

function inputPathToDebug(inputPath: InputPath): Record<string, unknown> {
  return {
    input: inputPath.theInputPath,
    realpath: inputPath.realpath,
    originalString: inputPath.originalString,
  };
}
