/* eslint-disable no-labels */
import * as fs from "fs";
import * as path from "path";

import { HashSet } from "./HashSet";
import { NonEmptyArray } from "./NonEmptyArray";
import * as Parser from "./Parser";
import { AbsolutePath, absolutePathFromString } from "./PathHelpers";
import { InputPath, SourceDirectory } from "./Types";

export type WalkImportsResult =
  | {
      tag: "FileSystemError";
      error: Error & { code?: string };
    }
  | {
      tag: "Success";
      allRelatedElmFilePaths: HashSet<AbsolutePath>;
    };

export function walkImports(
  sourceDirectories: NonEmptyArray<SourceDirectory>,
  inputPath: InputPath
): WalkImportsResult {
  const allRelatedElmFilePaths = initialRelatedElmFilePaths(
    sourceDirectories,
    inputPath
  );
  const visitedModules = new Set<string>();

  try {
    walkImportsHelper(
      sourceDirectories,
      inputPath.theInputPath,
      allRelatedElmFilePaths,
      visitedModules
    );
  } catch (errorAny) {
    const error = errorAny as Error & { code?: string };
    return { tag: "FileSystemError", error };
  }

  return { tag: "Success", allRelatedElmFilePaths };
}

function walkImportsHelper(
  sourceDirectories: NonEmptyArray<SourceDirectory>,
  elmFilePath: AbsolutePath,
  allRelatedElmFilePaths: HashSet<AbsolutePath>,
  visitedModules: Set<string>
): void {
  let importedModules;
  try {
    importedModules = parse(elmFilePath);
  } catch (errorAny) {
    const error = errorAny as Error & { code?: string };
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const importedModule of importedModules) {
    const relativePath = `${path.join(...importedModule)}.elm`;
    if (!visitedModules.has(relativePath)) {
      visitedModules.add(relativePath);
      for (const sourceDirectory of sourceDirectories) {
        const newElmFilePath = absolutePathFromString(
          sourceDirectory.theSourceDirectory,
          relativePath
        );
        allRelatedElmFilePaths.add(newElmFilePath);
        walkImportsHelper(
          sourceDirectories,
          newElmFilePath,
          allRelatedElmFilePaths,
          visitedModules
        );
      }
    }
  }
}

function parse(elmFilePath: AbsolutePath): Array<Parser.ModuleName> {
  const readState = Parser.initialReadState();
  const handle = fs.openSync(elmFilePath.absolutePath, "r");
  const buffer = Buffer.alloc(2048);
  let bytesRead = 0;
  outer: while ((bytesRead = fs.readSync(handle, buffer)) > 0) {
    for (const char of buffer.slice(0, bytesRead)) {
      Parser.readChar(char, readState);
      if (Parser.isNonImport(readState)) {
        break outer;
      }
    }
  }
  fs.closeSync(handle);
  return Parser.finalize(readState);
}

function initialRelatedElmFilePaths(
  sourceDirectories: NonEmptyArray<SourceDirectory>,
  inputPath: InputPath
): HashSet<AbsolutePath> {
  const inputPathString = inputPath.theInputPath.absolutePath;

  return new HashSet([
    inputPath.theInputPath,
    ...sourceDirectories.flatMap((sourceDirectory) => {
      const prefix = `${sourceDirectory.theSourceDirectory.absolutePath}${path.sep}`;
      return inputPathString.startsWith(prefix)
        ? sourceDirectories.map((sourceDirectory2) =>
            absolutePathFromString(
              sourceDirectory2.theSourceDirectory,
              inputPathString.slice(prefix.length)
            )
          )
        : [];
    }),
  ]);
}
