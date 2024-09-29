// In production this file is replaced with a simple one that just reads
// pre-compiled JS from a file.

import * as esbuild from "esbuild";
import * as path from "path";

import { clientEsbuildOptions } from "../scripts/Build";
import { join, quote } from "./Helpers";

const result = esbuild.buildSync(clientEsbuildOptions);

function getOutput(name: string): string {
  const match = result.outputFiles.find(
    (output) => path.basename(output.path) === name,
  );
  // istanbul ignore if
  if (match === undefined) {
    throw new Error(
      `ClientCode: Found no output from esbuild matching ${quote(
        name,
      )} in ${join(
        result.outputFiles.map((output) => quote(output.path)),
        ", ",
      )}`,
    );
  }
  return match.text;
}

export const client = getOutput("client.js");
export const proxy = getOutput("proxy.js");
