// This file is available as `elm-watch-lib` on npm and contains exactly the things needed by:
//
// - https://github.com/ryan-haskell/vite-plugin-elm-watch
//
// No more, no less. There is no documentation of the library – you’ll need to read the types and source code.
//
// If you use `elm-watch-lib` in a project not listed above, please let me know!

import { Env } from "./Env";
import { mapNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray";
import { make, type RunElmMakeResult } from "./SpawnElm";
import {
  type CompilationMode,
  markAsAbsolutePath,
  markAsElmJsonPath,
} from "./Types";

export { readSourceDirectories } from "./ElmJson";
export { walkImports } from "./ImportWalker";
export { inject } from "./Inject";

export function elmMake({
  elmJsonPath,
  compilationMode,
  inputs,
  outputPath,
  env,
}: {
  elmJsonPath: string;
  compilationMode: CompilationMode;
  inputs: NonEmptyArray<string>;
  outputPath: string;
  env: Env;
}): {
  promise: Promise<RunElmMakeResult>;
  kill: (options: { force: boolean }) => void;
} {
  return make({
    elmJsonPath: markAsElmJsonPath(markAsAbsolutePath(elmJsonPath)),
    compilationMode,
    inputs: mapNonEmptyArray(inputs, (rawInput) => ({
      tag: "InputPath",
      theInputPath: markAsAbsolutePath(rawInput),
    })),
    outputPath:
      outputPath === "/dev/null"
        ? { tag: "NullOutputPath" }
        : {
            tag: "OutputPath",
            theOutputPath: markAsAbsolutePath(outputPath),
            temporaryOutputPath: markAsAbsolutePath(outputPath),
            writeToTemporaryDir: false,
          },
    env,
    getNow: () => new Date(),
  });
}
