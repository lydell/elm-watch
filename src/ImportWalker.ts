/* eslint-disable no-labels */
import * as fs from "fs";
import * as path from "path";
import * as util from "util";

import { toError } from "./Helpers";
import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import * as Parser from "./Parser";
import { AbsolutePath, InputPath, SourceDirectory } from "./Types";

// NOTE: This module uses just `string` instead of `AbsolutePath` for performance!

export type WalkImportsResult =
  | WalkImportsError
  | {
      tag: "Success";
      allRelatedElmFilePaths: Set<string>;
    };

export type WalkImportsError = {
  tag: "ImportWalkerFileSystemError";
  error: NodeJS.ErrnoException;
  relatedElmFilePathsUntilError: Set<string>;
};

// Returns Elm file paths that if created, deleted or changed, `inputPath` needs
// to be recompiled.
export function walkImports(
  sourceDirectories: NonEmptyArray<SourceDirectory>,
  inputPaths: NonEmptyArray<InputPath>,
): WalkImportsResult {
  const allRelatedElmFilePaths = new Set(
    inputPaths.flatMap((inputPath) =>
      initialRelatedElmFilePaths(sourceDirectories, inputPath),
    ),
  );

  // Workaround for: https://github.com/nodejs/node/issues/42933
  // These sets can get super long in projects with many files.
  (
    allRelatedElmFilePaths as Set<string> & {
      [util.inspect.custom]: () => unknown;
    }
  )[util.inspect.custom] =
    /* v8 ignore next */
    () => Array.from(allRelatedElmFilePaths);

  // To avoid reading the same file twice, and to handle circular imports.
  const visitedModules = new Set<string>();

  try {
    for (const inputPath of inputPaths) {
      walkImportsHelper(
        mapNonEmptyArray(sourceDirectories, (sourceDirectory) => ({
          sourceDirectory,
          children: new Set(readdirSync(sourceDirectory.theSourceDirectory)),
        })),
        inputPath.realpath.absolutePath,
        allRelatedElmFilePaths,
        visitedModules,
      );
    }
  } catch (unknownError) {
    const error = toError(unknownError);
    return {
      tag: "ImportWalkerFileSystemError",
      error,
      relatedElmFilePathsUntilError: allRelatedElmFilePaths,
    };
  }

  return { tag: "Success", allRelatedElmFilePaths };
}

type SourceDirectoryWithChildren = {
  sourceDirectory: SourceDirectory;
  children: Set<string>;
};

function walkImportsHelper(
  sourceDirectories: NonEmptyArray<SourceDirectoryWithChildren>,
  elmFilePath: string,
  allRelatedElmFilePaths: Set<string>,
  visitedModules: Set<string>,
): void {
  // This is much faster than `try-catch` around `parse` and checking for ENOENT.
  if (!fs.existsSync(elmFilePath)) {
    // The file doesn’t exist now, but it might exist in the future. If it’s
    // created that triggers a recompile, but of course there’s no file to read
    // right now.
    return;
  }

  const importedModules = parse(elmFilePath);

  for (const importedModule of importedModules) {
    const relativePath = `${importedModule.join(path.sep)}.elm`;
    if (!visitedModules.has(relativePath)) {
      visitedModules.add(relativePath);
      for (const { sourceDirectory, children } of sourceDirectories) {
        const newElmFilePath =
          sourceDirectory.theSourceDirectory.absolutePath +
          path.sep +
          relativePath;
        allRelatedElmFilePaths.add(newElmFilePath);
        const child =
          importedModule.length === 1
            ? `${importedModule[0]}.elm`
            : importedModule[0];
        // This check is a cheap way to avoid many `fs.existsSync` calls,
        // which saves a lot of time.
        if (children.has(child)) {
          walkImportsHelper(
            sourceDirectories,
            newElmFilePath,
            allRelatedElmFilePaths,
            visitedModules,
          );
        }
      }
    }
  }
}

function parse(elmFilePath: string): Array<Parser.ModuleName> {
  const readState = Parser.initialReadState();
  const handle = fs.openSync(elmFilePath, "r");
  // Benchmarking has shown that synchronously reading around 2048 bytes at a
  // time is the fastest.
  const buffer = Buffer.alloc(2048);
  let bytesRead = 0;
  outer: while ((bytesRead = fs.readSync(handle, buffer)) > 0) {
    // The last read might contain less bytes than we asked for.
    for (const char of buffer.subarray(0, bytesRead)) {
      Parser.readChar(char, readState);
      if (Parser.isNonImport(readState)) {
        break outer;
      }
    }
  }
  fs.closeSync(handle);
  return Parser.finalize(readState);
}

// If the input is `src/Main.elm` and you have `"source-directories": ["src",
// "lib"]`, then creating `lib/Main.elm` will cause a compilation error, and
// should therefore trigger a recompile. The tricky part here is that we only
// have the absolute path to the input file, not its module name. It’s possible
// to figure out the module name: In a valid Elm project, exactly 1 source
// directory is a prefix of the input. In practice, 0 or more source directories
// can match. This function returns the original input path as well as all
// alternative paths in other source directories using all possible module names
// (valid or not). (Note: The `module` line cannot be trusted – it might contain
// a name not matching the file name (which of course is invalid, but still).)
function initialRelatedElmFilePaths(
  sourceDirectories: NonEmptyArray<SourceDirectory>,
  inputPath: InputPath,
): NonEmptyArray<string> {
  // Inputs are allowed to be symlinks. If there’s an error in the input, Elm
  // shows the resolved path in the error message rather than the original path
  // (the path where the symlink is located).
  const inputPathString = inputPath.realpath.absolutePath;

  return [
    inputPathString,
    ...sourceDirectories.flatMap((sourceDirectory) => {
      const prefix = sourceDirectory.theSourceDirectory.absolutePath + path.sep;
      return inputPathString.startsWith(prefix)
        ? sourceDirectories.map(
            (sourceDirectory2) =>
              sourceDirectory2.theSourceDirectory.absolutePath +
              path.sep +
              inputPathString.slice(prefix.length),
          )
        : [];
    }),
  ];
}

// This is only used in an optimization, so it shouldn’t affect the outcome –
// errors should not be considered at this point.
function readdirSync(dir: AbsolutePath): Array<string> {
  try {
    return fs.readdirSync(dir.absolutePath);
  } catch {
    return [];
  }
}
