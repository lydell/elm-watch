import { DEFAULT_HOST } from "../src/Host.ts";
import {
  type OutputStatus,
  OutputState,
  type PackageState,
  type PackageStatus,
  type Project,
  TargetState,
} from "../src/Project.ts";
import {
  type AbsolutePath,
  type Compiler,
  type ElmJsonPath,
  type GetNow,
  markAsAbsolutePath,
  markAsElmJsonPath,
  markAsElmWatchStuffJsonPath,
  markAsTargetName,
  type OutputPath,
  type PackageTarget,
} from "../src/Types.ts";

// Builds a `Project` by hand (without reading any files), for unit testing
// code that decides what to do based on the state of all targets.

const getNow: GetNow = () => new Date(0);

const noop = (): void => {
  // Do nothing.
};

// Shorthands for statuses.
export const S = {
  dirty: {
    tag: "Success",
    elmFileSize: 0,
    postprocessFileSize: 0,
    elmCompiledTimestamp: 0,
  },
  clean: {
    tag: "Success",
    elmFileSize: 0,
    postprocessFileSize: 0,
    elmCompiledTimestamp: 0,
  },
  elmMake: {
    tag: "ElmMake",
    compilationMode: "standard",
    elmDurationMs: 0,
    walkerDurationMs: 0,
    injectDurationMs: 0,
    kill: noop,
  },
  typecheckOnly: {
    tag: "ElmMakeTypecheckOnly",
    elmDurationMs: 0,
    walkerDurationMs: 0,
    kill: noop,
  },
  postprocess: { tag: "Postprocess", kill: noop },
  queuedForElmMake: { tag: "QueuedForElmMake" },
  queuedForPostprocess: {
    tag: "QueuedForPostprocess",
    postprocess: { tag: "Postprocess", postprocessFunction: () => "" },
    code: "",
    elmCompiledTimestamp: 0,
    recordFields: undefined,
  },
  interrupted: { tag: "Interrupted" },
  error: {
    tag: "ReadOutputError",
    error: new Error("Test"),
    triedPath: markAsAbsolutePath("/project/build/Error.js"),
  },
} satisfies Record<string, OutputStatus>;

export type StatusName = keyof typeof S;

export type TargetSpec = [
  name: string,
  status: StatusName,
  compiler?: Compiler,
];

export function elmJsonPath(name: string): ElmJsonPath {
  return markAsElmJsonPath(markAsAbsolutePath(`/project/${name}/elm.json`));
}

export function elmFilePath(name: string): AbsolutePath {
  return markAsAbsolutePath(`/project/src/${name}.elm`);
}

export function makeProject({
  maxParallel = 2,
  elmJsons,
  packages = {},
}: {
  maxParallel?: number;
  // elm.json name -> targets using it.
  elmJsons: Record<string, Array<TargetSpec>>;
  // elm.json name -> package target using it.
  packages?: Record<string, TargetSpec>;
}): Project {
  return {
    watchDirs: [],
    missingSourceDirectories: new Set(),
    root: markAsAbsolutePath("/project"),
    staticFilesDir: undefined,
    configSource: { tag: "Options" },
    elmWatchStuffJsonPath: markAsElmWatchStuffJsonPath(
      markAsAbsolutePath("/project/elm-stuff/elm-watch/stuff.json"),
    ),
    disabledOutputs: [],
    targetsErrors: [],
    elmJsons: new Map(
      Object.entries(elmJsons).map(([elmJsonName, targets]) => [
        elmJsonPath(elmJsonName),
        targets.map(
          ([name, statusName, compiler = "elm"]): [OutputPath, OutputState] => {
            const outputPath: OutputPath = {
              tag: "OutputPath",
              theOutputPath: markAsAbsolutePath(`/project/build/${name}.js`),
              temporaryOutputPath: markAsAbsolutePath(
                `/project/elm-stuff/elm-watch/${name}.js`,
              ),
              originalString: `build/${name}.js`,
              targetName: markAsTargetName(name),
            };
            const inputPath = elmFilePath(name);
            const outputState = new OutputState(
              [
                {
                  tag: "InputPath",
                  theInputPath: inputPath,
                  originalString: `src/${name}.elm`,
                  realpath: inputPath,
                },
              ],
              { tag: "NoPostprocess" },
              "standard",
              compiler,
              getNow,
            );
            // Pretend that every target imports Shared.elm.
            outputState.allRelatedElmFilePaths = new Set([
              inputPath,
              elmFilePath("Shared"),
            ]);
            outputState.setStatus(S[statusName]);
            outputState.dirty = statusName === "dirty";
            return [outputPath, outputState];
          },
        ),
      ]),
    ),
    packages: new Map(
      Object.entries(packages).map(
        ([elmJsonName, [name, statusName, compiler = "elm"]]) => {
          const packageTarget: PackageTarget = {
            tag: "PackageTarget",
            targetName: markAsTargetName(name),
          };
          const packageState: PackageState = new TargetState<PackageStatus>(
            { tag: "NotWrittenToDisk" },
            compiler,
            getNow,
          );
          if (statusName !== "dirty" && statusName !== "clean") {
            packageState.setStatus(S[statusName] as PackageStatus);
          }
          packageState.dirty = statusName === "dirty";
          return [elmJsonPath(elmJsonName), [packageTarget, packageState]];
        },
      ),
    ),
    maxParallel,
    host: DEFAULT_HOST,
    webSocketUrl: undefined,
    allowedHosts: [],
    openEditor: { tag: "NotSet" },
  };
}
