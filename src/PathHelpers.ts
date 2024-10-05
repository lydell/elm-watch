import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";

import { getSetSingleton, join, toError } from "./Helpers";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { AbsolutePath, markAsAbsolutePath } from "./Types";

export function absolutePathFromString(
  from: AbsolutePath,
  ...pathStrings: NonEmptyArray<string>
): AbsolutePath {
  return markAsAbsolutePath(path.resolve(from, ...pathStrings));
}

export function absoluteDirname(absolutePath: AbsolutePath): AbsolutePath {
  return markAsAbsolutePath(path.dirname(absolutePath));
}

/**
 * Note that this can throw fs errors.
 */
export function absoluteRealpath(absolutePath: AbsolutePath): AbsolutePath {
  return markAsAbsolutePath(fs.realpathSync(absolutePath));
}

export function findClosest(
  name: string,
  absoluteDir: AbsolutePath,
): AbsolutePath | undefined {
  const entry = path.join(absoluteDir, name);
  return fs.existsSync(entry)
    ? markAsAbsolutePath(entry)
    : absoluteDir === path.parse(absoluteDir).root
      ? undefined
      : findClosest(name, absoluteDirname(absoluteDir));
}

export function longestCommonAncestorPath(
  paths: NonEmptyArray<AbsolutePath>,
): AbsolutePath | undefined {
  const pathArrays = mapNonEmptyArray(paths, (absolutePath) =>
    absolutePath.split(path.sep),
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

  /* v8 ignore start */
  return isNonEmptyArray(commonSegments)
    ? markAsAbsolutePath(join(commonSegments, path.sep))
    : // On Windows, a `C:` path and a `D:` path has no common ancestor.
      undefined;
  /* v8 ignore stop */
}

type ReadJsonFileResult<T> =
  | Codec.DecoderResult<T>
  | {
      tag: "ReadError";
      error: NodeJS.ErrnoException;
    };

export function readJsonFile<T>(
  file: AbsolutePath,
  codec: Codec.Codec<T>,
): ReadJsonFileResult<T> {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch (error) {
    return { tag: "ReadError", error: toError(error) };
  }
  return Codec.JSON.parse(codec, content);
}
