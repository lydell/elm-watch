// In production this file is replaced with a simple one that just reads
// pre-compiled JS from a file.

import * as esbuild from "esbuild";
import * as path from "path";

import { clientEsbuildOptions } from "../scripts/Build";

const result = esbuild.buildSync(clientEsbuildOptions);

function getOutput(name: string): string {
  const match = result.outputFiles.find(
    (output) => path.basename(output.path) === name
  );
  /* v8 ignore start */
  if (match === undefined) {
    throw new Error(
      `ClientCode: Found no output from esbuild matching ${JSON.stringify(
        name
      )} in ${JSON.stringify(result.outputFiles.map((output) => output.path))}`
    );
  }
  /* v8 ignore stop */
  return match.text;
}

export const client = getOutput("client.js");
export const proxy = getOutput("proxy.js");
