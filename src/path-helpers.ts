import * as fs from "fs";
import * as path from "path";

import { getSetSingleton } from "./helpers";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";

export type AbsolutePath = { tag: "AbsolutePath"; absolutePath: string };

export type Cwd = { tag: "Cwd"; path: AbsolutePath };

export function absolutePathFromString(
  from: AbsolutePath,
  pathString: string
): AbsolutePath {
  return {
    tag: "AbsolutePath",
    absolutePath: path.resolve(from.absolutePath, pathString),
  };
}

export function absoluteDirname({ absolutePath }: AbsolutePath): AbsolutePath {
  return {
    tag: "AbsolutePath",
    absolutePath: path.dirname(absolutePath),
  };
}

export function findClosest(
  name: string,
  absoluteDir: AbsolutePath
): AbsolutePath | undefined {
  const dir = absoluteDir.absolutePath;
  const entry = path.join(dir, name);
  return fs.existsSync(entry)
    ? { tag: "AbsolutePath", absolutePath: entry }
    : dir === path.parse(dir).root
    ? undefined
    : findClosest(name, absoluteDirname(absoluteDir));
}

export function longestCommonAncestorPath(
  paths: NonEmptyArray<AbsolutePath>
): AbsolutePath | undefined {
  const pathArrays = mapNonEmptyArray(paths, ({ absolutePath }) =>
    absolutePath.split(path.sep)
  );

  const length = Math.min(...pathArrays.map((array) => array.length));
  const commonSegments = [];

  for (let index = 0; index < length; index++) {
    const segmentsAtIndex = new Set(pathArrays.map((array) => array[index]));
    const uniqueSegment = getSetSingleton(segmentsAtIndex);
    if (uniqueSegment === undefined) {
      break;
    }
    commonSegments.push(uniqueSegment);
  }

  return isNonEmptyArray(commonSegments)
    ? { tag: "AbsolutePath", absolutePath: commonSegments.join(path.sep) }
    : // On Windows, a `C:` path and a `D:` path has no common ancestor.
      undefined;
}
