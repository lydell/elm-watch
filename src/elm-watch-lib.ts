// This file is available as `elm-watch-lib` on npm and contains exactly the things needed by:
//
// - https://github.com/ryan-haskell/vite-plugin-elm-watch
//
// No more, no less. There is no documentation of the library – you’ll need to read the types and source code.
//
// If you use `elm-watch-lib` in a project not listed above, please let me know!

import type { Env } from "./Env.ts";
import { mapNonEmptyArray, type NonEmptyArray } from "./NonEmptyArray.ts";
import { make, type RunElmMakeResult } from "./SpawnElm.ts";
import {
  type CompilationMode,
  type Compiler,
  markAsAbsolutePath,
  markAsElmJsonPath,
} from "./Types.ts";

export { readSourceDirectories } from "./ElmJson.ts";
export { walkImports } from "./ImportWalker.ts";
export { inject } from "./Inject.ts";

export function elmMake({
  compiler = "elm",
  elmJsonPath,
  compilationMode,
  inputs,
  outputPath,
  env,
}: {
  compiler?: Compiler;
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
    compiler,
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
