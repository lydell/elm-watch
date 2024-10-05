import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";

import { toError } from "./Helpers";
import { NonEmptyArray } from "./NonEmptyArray";
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
