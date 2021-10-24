// In production this file is replaced with a simple one that just reads
// pre-compiled JS from a file.

import * as esbuild from "esbuild";

import { clientEsbuildOptions } from "../scripts/Build";
import { isNonEmptyArray } from "./NonEmptyArray";

const result = esbuild.buildSync(clientEsbuildOptions);

if (!isNonEmptyArray(result.outputFiles) || result.outputFiles.length > 1) {
  throw new Error(
    `ClientCode: Expected 1 output from esbuild, but got: ${result.outputFiles.length}`
  );
}

export const code = result.outputFiles[0].text;
