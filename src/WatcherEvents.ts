import * as path from "path";
import * as url from "url";

import * as Compile from "./Compile.ts";
import {
  type LatestEvent,
  makeWatcherEvent,
  type TaggedAbsolutePath,
  type WatcherEvent,
  type WatcherEventName,
} from "./LatestEvent.ts";
import { isNonEmptyArray } from "./NonEmptyArray.ts";
import {
  getFlatOutputs,
  getPackageSourceDirectory,
  type OutputState,
  type PackageState,
  type Project,
} from "./Project.ts";
import type {
  AbsolutePath,
  ElmJsonPath,
  InputPath,
  OutputPath,
} from "./Types.ts";

// Decides what a file change means for the project. This doesn’t look at the
// file system: Whether a path was removed is checked beforehand.

export type DirtyOutput = {
  outputPath: OutputPath;
  outputState: OutputState;
};

export type WatcherEventEffect =
  // Restart elm-watch, re-reading elm-watch.json and elm.json files.
  | { tag: "Restart" }
  // Recompile these outputs and packages.
  | {
      tag: "MarkAsDirty";
      outputs: Array<DirtyOutput>;
      packages: Array<PackageState>;
    }
  // The event is printed, but nothing needs to be compiled.
  | { tag: "NoEffect" };

export type ClassifiedWatcherEvent = {
  event: Extract<LatestEvent, { tag: "WatcherEvent" }>;
  effect: WatcherEventEffect;
};

function restart(event: WatcherEvent): ClassifiedWatcherEvent {
  return {
    event: { ...event, affectsAnyTarget: true },
    effect: { tag: "Restart" },
  };
}

// Returns `undefined` for irrelevant events (not even worth printing).
export function classifyWatcherEvent(
  project: Project,
  eventName: WatcherEventName,
  absolutePath: AbsolutePath,
): ClassifiedWatcherEvent | undefined {
  if (absolutePath.endsWith(".elm")) {
    return onElmFileWatcherEvent(
      project,
      makeWatcherEvent(eventName, absolutePath),
    );
  }

  const basename = path.basename(absolutePath);

  switch (basename) {
    case "elm-watch.json":
      // elm-watch.json files are irrelevant when not using elm-watch.json.
      if (project.configSource.tag !== "ElmWatchJson") {
        return undefined;
      }
      // We don’t know if an elm-watch.json other than the current one was
      // added or changed. Adding one could change which one is used, so
      // restart to be safe.
      if (
        absolutePath === project.configSource.elmWatchJsonPath ||
        eventName === "changed"
      ) {
        return restart(makeWatcherEvent(eventName, absolutePath));
      }
      return undefined;

    case "elm.json":
      if (getAllElmJsonPaths(project).some((p) => absolutePath === p)) {
        return restart(makeWatcherEvent(eventName, absolutePath));
      }
      return undefined;

    // Some compiler error messages suggest removing elm-stuff to fix the error.
    // Restart when that happens. Note: This could be a totally unrelated
    // elm-stuff directory, but I don’t think it’s worth the trouble trying to
    // check if it affects the project, and possibly logging if it isn’t.
    // See also `isElmStuffCompilerDir` below.
    case "elm-stuff":
      switch (eventName) {
        case "removed":
          return restart(makeWatcherEvent(eventName, absolutePath));

        default:
          return undefined;
      }

    default:
      if (eventName === "removed" && isElmStuffCompilerDir(absolutePath)) {
        return restart(makeWatcherEvent(eventName, absolutePath));
      }

      if (project.staticFilesDir !== undefined) {
        const prefix = project.staticFilesDir + path.sep;
        if (
          absolutePath.startsWith(prefix) &&
          !getFlatOutputs(project).some(
            ({ outputPath }) => absolutePath === outputPath.theOutputPath,
          )
        ) {
          // Browsers are told about changed static files, but there is
          // nothing to compile.
          return {
            event: {
              ...makeWatcherEvent(eventName, absolutePath),
              affectsAnyTarget: true,
              file: {
                tag: "StaticFilesDirPath",
                urlPath: url.pathToFileURL(
                  path.sep + absolutePath.slice(prefix.length),
                ).pathname,
              },
            },
            effect: { tag: "NoEffect" },
          };
        }
      }

      // A directory might have been moved, added or removed. We only get an
      // event for the directory itself, not for every file inside it.
      return onDirectoryWatcherEvent(
        project,
        makeWatcherEvent(eventName, absolutePath),
      );
  }
}

// Removing just the compiler’s directory, like elm-stuff/0.19.1/ (or
// elm-stuff/lamdera-1.5.0-0.19.3/ for Lamdera), is enough to get rid of a
// corrupt cache. That preserves files from other tools in elm-stuff/, like
// elm-watch, elm-review and elm-test.
function isElmStuffCompilerDir(absolutePath: AbsolutePath): boolean {
  return (
    path.basename(path.dirname(absolutePath)) === "elm-stuff" &&
    /^(?:lamdera-\d+\.\d+\.\d+-)?\d+\.\d+\.\d+$/.test(
      path.basename(absolutePath),
    )
  );
}

function onDirectoryWatcherEvent(
  project: Project,
  event: WatcherEvent<TaggedAbsolutePath>,
): ClassifiedWatcherEvent | undefined {
  const prefix = event.file.absolutePath + path.sep;
  const isInside = (absolutePath: AbsolutePath): boolean =>
    absolutePath.startsWith(prefix);

  if (
    (project.configSource.tag === "ElmWatchJson" &&
      isInside(project.configSource.elmWatchJsonPath)) ||
    getAllElmJsonPaths(project).some(isInside) ||
    isElmFileRelatedToTargetsErrors(isInside, project.targetsErrors)
  ) {
    return restart(event);
  }

  const result = onElmFilesWatcherEvent(project, event, isInside);
  // Ignore other types of files.
  return result.event.affectsAnyTarget ? result : undefined;
}

function onElmFileWatcherEvent(
  project: Project,
  event: WatcherEvent<TaggedAbsolutePath>,
): ClassifiedWatcherEvent {
  const elmFile = event.file.absolutePath;
  const isElmFile = (absolutePath: AbsolutePath): boolean =>
    absolutePath === elmFile;

  if (isElmFileRelatedToTargetsErrors(isElmFile, project.targetsErrors)) {
    return restart(event);
  }

  return onElmFilesWatcherEvent(project, event, isElmFile);
}

// `matches` is either an exact match for an .elm file, or checks if a path is
// inside a directory.
function onElmFilesWatcherEvent(
  project: Project,
  event: WatcherEvent<TaggedAbsolutePath>,
  matches: (absolutePath: AbsolutePath) => boolean,
): ClassifiedWatcherEvent {
  const matchesInputPath = (inputPath: InputPath): boolean =>
    matches(inputPath.theInputPath) || matches(inputPath.realpath);

  const dirtyOutputs: Array<DirtyOutput> = [];
  const dirtyPackages: Array<PackageState> = [];

  for (const [elmJsonPath, outputs] of project.elmJsons) {
    for (const [outputPath, outputState] of outputs) {
      if (
        event.eventName === "removed" &&
        outputState.inputs.some(matchesInputPath)
      ) {
        return restart(event);
      }
      Compile.ensureAllRelatedElmFilePaths(elmJsonPath, outputState);
      if (
        outputState.allRelatedElmFilePaths.has(event.file.absolutePath) ||
        Array.from(outputState.allRelatedElmFilePaths).some(matches)
      ) {
        dirtyOutputs.push({ outputPath, outputState });
      }
    }
  }

  // Packages typecheck everything in their source directory (src/). The event
  // can be for a file inside it, the directory itself, or a directory
  // containing it.
  for (const [elmJsonPath, [, packageState]] of project.packages) {
    const sourceDirectory = getPackageSourceDirectory(elmJsonPath);
    if (
      event.file.absolutePath === sourceDirectory ||
      event.file.absolutePath.startsWith(sourceDirectory + path.sep) ||
      matches(sourceDirectory)
    ) {
      dirtyPackages.push(packageState);
    }
  }

  return isNonEmptyArray(dirtyOutputs) || isNonEmptyArray(dirtyPackages)
    ? {
        event: { ...event, affectsAnyTarget: true },
        effect: {
          tag: "MarkAsDirty",
          outputs: dirtyOutputs,
          packages: dirtyPackages,
        },
      }
    : {
        event: { ...event, affectsAnyTarget: false },
        effect: { tag: "NoEffect" },
      };
}

// `matches` is either an exact match for an .elm file, or checks if a path is
// inside a directory.
function isElmFileRelatedToTargetsErrors(
  matches: (absolutePath: AbsolutePath) => boolean,
  targetsErrors: Project["targetsErrors"],
): boolean {
  const matchesInputPath = (inputPath: InputPath): boolean =>
    matches(inputPath.theInputPath) || matches(inputPath.realpath);
  return targetsErrors.some(({ error }) => {
    switch (error.tag) {
      case "DuplicateInputs":
        return error.duplicates.some(
          ({ inputs, resolved }) =>
            matches(resolved) || inputs.some(matchesInputPath),
        );

      // elm.json is watched separately.
      case "ElmJsonNotFound":
      case "ElmJsonTypeMismatch":
        return false;

      // The only way I’ve found to trigger this is by a symlink loop.
      case "InputsFailedToResolve":
        return error.inputsFailedToResolve.some(({ inputPath }) =>
          matches(inputPath.theUncheckedInputPath),
        );

      case "InputsNotFound":
        return error.inputsNotFound.some((inputPath) =>
          matches(inputPath.theUncheckedInputPath),
        );
    }
  });
}

// Including the elm.json files of targets with errors: The elm.json might be
// missing, or have the wrong "type".
function getAllElmJsonPaths(project: Project): Array<ElmJsonPath> {
  return [
    ...project.elmJsons.keys(),
    ...project.packages.keys(),
    ...project.targetsErrors.map(({ elmJsonPath }) => elmJsonPath),
  ];
}
