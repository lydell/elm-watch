import * as fs from "fs";
import * as path from "path";

import { NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath } from "./Types";

export function absolutePathFromString(
  from: AbsolutePath,
  ...pathStrings: NonEmptyArray<string>
): AbsolutePath {
  return {
    tag: "AbsolutePath",
    absolutePath: path.resolve(from.absolutePath, ...pathStrings),
  };
}

export function absoluteDirname({ absolutePath }: AbsolutePath): AbsolutePath {
  return {
    tag: "AbsolutePath",
    absolutePath: path.dirname(absolutePath),
  };
}

/**
 * Note that this can throw fs errors.
 */
export function absoluteRealpath({ absolutePath }: AbsolutePath): AbsolutePath {
  return {
    tag: "AbsolutePath",
    absolutePath: fs.realpathSync(absolutePath),
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

/**
 * Returns whether `child` is contained inside `parent`.
 */
export function pathContains(
  parent: AbsolutePath,
  child: AbsolutePath
): boolean {
  const relative = path.relative(child.absolutePath, parent.absolutePath);
  return relative.split(path.sep).every((piece) => piece === "..");
}
