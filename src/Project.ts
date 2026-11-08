import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  type AllowedHost,
  allowedHostFromUrl,
  getAllowedHostsFromEnv,
} from "./AllowedHosts.ts";
import type { Config, ConfigSource, OpenEditorFunction } from "./Config.ts";
import * as ElmJson from "./ElmJson.ts";
import type { ElmWatchStuffJson } from "./ElmWatchStuffJson.ts";
import {
  __ELM_WATCH_MAX_PARALLEL,
  ELM_WATCH_OPEN_EDITOR,
  ELM_WATCH_WEBSOCKET_URL,
  type Env,
} from "./Env.ts";
import { silentlyReadIntEnvValue, toError } from "./Helpers.ts";
import { DEFAULT_HOST, getHostFromEnv, type Host } from "./Host.ts";
import type { WalkImportsError } from "./ImportWalker.ts";
import { isNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray.ts";
import {
  absoluteDirname,
  absolutePathFromString,
  absoluteRealpath,
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
  type PackageTarget,
  type StaticFilesDir,
  type TargetName,
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
  disabledOutputs: Array<OutputPath | PackageTarget>;
  targetsErrors: Array<TargetErrorWithMetadata>;
  // Applications.
  elmJsons: Map<ElmJsonPath, Array<[OutputPath, OutputState]>>;
  // There can only be one package target per elm.json.
  packages: Map<ElmJsonPath, [PackageTarget, PackageState]>;
  maxParallel: number;
  host: Host;
  webSocketUrl: WebSocketUrl | undefined;
  allowedHosts: Array<AllowedHost>;
  openEditor: OpenEditor;
};

export type OpenEditor =
  | { tag: "NotSet" }
  // From the ELM_WATCH_OPEN_EDITOR environment variable (elm-watch.json only).
  | { tag: "Command"; command: string }
  | { tag: "Function"; openEditor: OpenEditorFunction };

// The code base leans towards pure functions, but these data structures are
// going to be mutated a lot.
export class TargetState<Status extends OutputStatus = OutputStatus> {
  // This one has a method for mutating, for measuring how long time is spent in
  // different statuses.
  private _status: Status;

  private _durations: Array<Duration> = [];

  private _lastStartTimestamp = 0;

  dirty = true;

  private getNow: GetNow;

  constructor(initialStatus: Status, getNow: GetNow) {
    this._status = initialStatus;
    this.getNow = getNow;
  }

  flushDurations(): Array<Duration> {
    // Clear the durations when getting them. This means that once we have have
    // printed them, we won’t print them again. This way we only show durations
    // for the targets that were affected by the latest compilation cycle.
    const durations = this._durations.slice();
    this._durations.length = 0;
    return durations;
  }

  get status(): Status {
    return this._status;
  }

  setStatus(status: Status): void {
    const lastStartTimestamp = this._lastStartTimestamp;
    this._lastStartTimestamp = this.getNow().getTime();

    // `Status` is a subset of `OutputStatus`.
    const previousStatus: OutputStatus = this._status;

    switch (previousStatus.tag) {
      case "ElmMake":
        this._durations.push({
          tag: "ElmMake",
          elmDurationMs: previousStatus.elmDurationMs,
          walkerDurationMs: previousStatus.walkerDurationMs,
        });
        if (previousStatus.injectDurationMs !== -1) {
          this._durations.push({
            tag: "Inject",
            durationMs: previousStatus.injectDurationMs,
          });
        }
        break;

      case "ElmMakeTypecheckOnly":
        this._durations.push({
          tag: "ElmMakeTypecheckOnly",
          elmDurationMs: previousStatus.elmDurationMs,
          walkerDurationMs: previousStatus.walkerDurationMs,
        });
        break;

      case "Postprocess":
      case "QueuedForElmMake":
      case "QueuedForPostprocess":
        this._durations.push({
          tag: previousStatus.tag,
          durationMs: this._lastStartTimestamp - lastStartTimestamp,
        });
        break;

      default:
        this._durations.length = 0;
    }

    this._status = status;
  }
}

export class OutputState extends TargetState {
  // Inputs never change.
  readonly inputs: NonEmptyArray<InputPath>;

  readonly postprocess: Postprocess;

  // The remaining properties are mutated from outside the class.

  compilationMode: CompilationMode;

  browserUiPosition: BrowserUiPosition;

  openErrorOverlay = false;

  allRelatedElmFilePaths = new Set<AbsolutePath>();

  // We only calculate `recordFields` in optimize mode. Having `| undefined`
  // makes that more clear.
  recordFields: Set<string> | undefined = undefined;

  constructor(
    inputs: NonEmptyArray<InputPath>,
    postprocess: Postprocess,
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
    openErrorOverlay: boolean,
    getNow: GetNow,
  ) {
    super({ tag: "NotWrittenToDisk" }, getNow);
    this.inputs = inputs;
    this.postprocess = postprocess;
    this.compilationMode = compilationMode;
    this.browserUiPosition = browserUiPosition;
    this.openErrorOverlay = openErrorOverlay;
  }
}

// Packages are only typechecked, so they have fewer statuses. A successful
// typecheck is "NotWrittenToDisk", like for applications.
export type PackageStatus =
  | Extract<
      OutputStatus,
      {
        tag:
          | "ElmMakeTypecheckOnly"
          | "Interrupted"
          | "NotWrittenToDisk"
          | "QueuedForElmMake";
      }
    >
  | RunElmMakeError;

export type PackageState = TargetState<PackageStatus>;

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

type TargetError =
  | {
      tag: "DuplicateInputs";
      duplicates: NonEmptyArray<{
        inputs: NonEmptyArray<InputPath>;
        resolved: AbsolutePath;
      }>;
    }
  | {
      tag: "ElmJsonNotFound";
    }
  | {
      tag: "ElmJsonTypeMismatch";
      expected: ElmJson.ElmJsonType;
      actual: ElmJson.ElmJsonType;
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
    };

export type TargetErrorWithMetadata = {
  outputPath: OutputPath | PackageTarget;
  elmJsonPath: ElmJsonPath;
  compilationMode: CompilationMode;
  browserUiPosition: BrowserUiPosition;
  openErrorOverlay: boolean;
  error: TargetError;
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
      tag: "NonUniquePackageElmJsons";
      nonUniquePackageElmJsons: NonEmptyArray<{
        elmJsonPath: ElmJsonPath;
        usages: NonEmptyArray<{
          type: ElmJson.ElmJsonType;
          targetName: TargetName;
        }>;
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
  const disabledOutputs: Array<OutputPath | PackageTarget> = [];
  const targetsErrors: Array<TargetErrorWithMetadata> = [];
  const elmJsons = new Map<ElmJsonPath, Array<[OutputPath, OutputState]>>();
  const packages = new Map<ElmJsonPath, [PackageTarget, PackageState]>();
  const enabledInputPaths: Array<AbsolutePath> = [];
  const potentialOutputDuplicates = new Map<
    AbsolutePath,
    NonEmptyArray<string>
  >();
  const elmJsonUsages = new Map<
    ElmJsonPath,
    NonEmptyArray<{ type: ElmJson.ElmJsonType; targetName: TargetName }>
  >();

  for (const [index, target] of config.targets.entries()) {
    const targetName = markAsTargetName(target.name);
    const elmJsonPath = markAsElmJsonPath(
      absolutePathFromString(config.root, target.elmJson),
    );
    const isEnabled = enabledTargetsSubstrings.some((substring) =>
      target.name.includes(substring),
    );

    const usage = { type: target.type, targetName };
    const previousUsages = elmJsonUsages.get(elmJsonPath);
    if (previousUsages === undefined) {
      elmJsonUsages.set(elmJsonPath, [usage]);
    } else {
      previousUsages.push(usage);
    }

    switch (target.type) {
      case "application": {
        const outputPath: OutputPath = {
          tag: "OutputPath",
          theOutputPath: absolutePathFromString(config.root, target.output),
          temporaryOutputPath: absolutePathFromString(
            elmWatchStuffDir,
            `${index}.js`,
          ),
          originalString: target.output,
          targetName,
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

        if (!isEnabled) {
          disabledOutputs.push(outputPath);
          break;
        }

        const resolveResult = resolveTarget(
          config.root,
          elmJsonPath,
          target.inputs,
        );
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

        switch (resolveResult.tag) {
          case "Success": {
            const previous = elmJsons.get(elmJsonPath) ?? [];
            previous.push([
              outputPath,
              new OutputState(
                resolveResult.inputs,
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
            elmJsons.set(elmJsonPath, previous);
            break;
          }

          default:
            targetsErrors.push({
              outputPath,
              elmJsonPath,
              compilationMode: thisCompilationMode,
              browserUiPosition,
              openErrorOverlay,
              error: resolveResult,
            });
            break;
        }
        break;
      }

      case "package": {
        const packageTarget: PackageTarget = {
          tag: "PackageTarget",
          targetName,
        };

        if (!isEnabled) {
          disabledOutputs.push(packageTarget);
          break;
        }

        const error = checkElmJsonType(elmJsonPath, "package");
        if (error === undefined) {
          packages.set(elmJsonPath, [
            packageTarget,
            new TargetState<PackageStatus>({ tag: "NotWrittenToDisk" }, getNow),
          ]);
        } else {
          targetsErrors.push({
            outputPath: packageTarget,
            elmJsonPath,
            // These are only used for applications (in the browser UI).
            compilationMode,
            browserUiPosition: "BottomLeft",
            openErrorOverlay: false,
            error,
          });
        }
        break;
      }
    }
  }

  const nonUniquePackageElmJsons = Array.from(elmJsonUsages).flatMap(
    ([elmJsonPath, usages]) =>
      usages.length >= 2 && usages.some(({ type }) => type === "package")
        ? [{ elmJsonPath, usages }]
        : [],
  );

  if (isNonEmptyArray(nonUniquePackageElmJsons)) {
    return {
      tag: "NonUniquePackageElmJsons",
      nonUniquePackageElmJsons,
    };
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
    elmJsonPaths: [...elmJsons.keys(), ...packages.keys()],
    erroredElmJsonPaths: targetsErrors.map(({ elmJsonPath }) => elmJsonPath),
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

  const openEditorCommand = isElmWatchJson
    ? env[ELM_WATCH_OPEN_EDITOR]
    : undefined;
  const openEditor: OpenEditor =
    config.openEditor !== undefined
      ? { tag: "Function", openEditor: config.openEditor }
      : openEditorCommand !== undefined
        ? { tag: "Command", command: openEditorCommand }
        : { tag: "NotSet" };

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
      targetsErrors,
      elmJsons,
      packages,
      maxParallel,
      host,
      webSocketUrl,
      allowedHosts,
      openEditor,
    },
  };
}

// Only source directories (and the static files directory) are watched
// recursively. Other directories are only watched shallowly, to avoid watching
// lots of irrelevant files: https://github.com/lydell/elm-watch/issues/106
function getWatchDirs({
  configSource,
  elmJsonPaths,
  erroredElmJsonPaths,
  inputPaths,
  staticFilesDir,
}: {
  configSource: ConfigSource;
  elmJsonPaths: Array<ElmJsonPath>;
  erroredElmJsonPaths: Array<ElmJsonPath>;
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
    // The elm.json of a target with errors might be missing, or have the
    // wrong "type". Restart when it changes.
    ...erroredElmJsonPaths.map((elmJsonPath) =>
      shallow(absoluteDirname(elmJsonPath)),
    ),
    // Inputs might not be in a source directory, or might not exist (yet).
    ...inputPaths.map((inputPath) => shallow(absoluteDirname(inputPath))),
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

type ResolveTargetResult =
  | TargetError
  | {
      tag: "Success";
      inputs: NonEmptyArray<InputPath>;
    };

function resolveTarget(
  root: AbsolutePath,
  elmJsonPath: ElmJsonPath,
  inputStrings: NonEmptyArray<string>,
): ResolveTargetResult {
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

  const elmJsonError = checkElmJsonType(elmJsonPath, "application");
  if (elmJsonError !== undefined) {
    return elmJsonError;
  }

  return {
    tag: "Success",
    // At this point we know for sure that `inputs` must be non-empty.
    inputs: inputs as NonEmptyArray<InputPath>,
  };
}

function checkElmJsonType(
  elmJsonPath: ElmJsonPath,
  type: ElmJson.ElmJsonType,
): TargetError | undefined {
  const result = ElmJson.readElmJsonType(elmJsonPath);
  switch (result.tag) {
    case "NotFound":
      return { tag: "ElmJsonNotFound" };
    case "Found":
      return result.type === type
        ? undefined
        : { tag: "ElmJsonTypeMismatch", expected: type, actual: result.type };
    case "Unknown":
      // Let Elm report the problem with elm.json.
      return undefined;
  }
}

export type ApplicationTargetErrorWithMetadata = TargetErrorWithMetadata & {
  outputPath: OutputPath;
};

// Only application targets can be connected to from the browser.
export function getApplicationTargetsErrors(
  project: Project,
): Array<ApplicationTargetErrorWithMetadata> {
  return project.targetsErrors.flatMap((targetError) =>
    targetError.outputPath.tag === "OutputPath"
      ? [{ ...targetError, outputPath: targetError.outputPath }]
      : [],
  );
}

export function getPackageStates(project: Project): Array<PackageState> {
  return Array.from(
    project.packages.values(),
    ([, packageState]) => packageState,
  );
}

export function getAllTargetStates(project: Project): Array<TargetState> {
  return [
    ...getFlatOutputs(project).map(({ outputState }) => outputState),
    ...getPackageStates(project),
  ];
}

// Packages always use src/ – see `ElmJson.readSourceDirectories`.
export function getPackageSourceDirectory(
  elmJsonPath: ElmJsonPath,
): AbsolutePath {
  return absolutePathFromString(absoluteDirname(elmJsonPath), "src");
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
    enabledPackageTargets: Array.from(
      project.packages,
      ([elmJsonPath, [packageTarget]]) => ({
        ...outputPathToDebug(packageTarget),
        elmJson: elmJsonPath,
      }),
    ),
    disabledTargets: Array.from(project.disabledOutputs, outputPathToDebug),
    erroredTargets: project.targetsErrors.map(
      ({ outputPath, compilationMode, error }) => ({
        error: error.tag,
        ...outputPathToDebug(outputPath),
        compilationMode,
      }),
    ),
  };
}

function outputPathToDebug(
  outputPath: OutputPath | PackageTarget,
): Record<string, unknown> {
  if (outputPath.tag === "PackageTarget") {
    return { targetName: outputPath.targetName };
  }
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
