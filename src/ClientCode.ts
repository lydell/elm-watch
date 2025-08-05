// In production this file is replaced with a simple one that just reads
// pre-compiled JS from a file.

import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

import { clientEsbuildOptions, PROXY_SRC_PATH } from "../scripts/Build";
import { quote } from "./Helpers";

const result = esbuild.buildSync(clientEsbuildOptions);

function getOutput(name: string): string {
  const match = result.outputFiles.find(
    (output) => path.basename(output.path) === name,
  );
  /* v8 ignore start */
  if (match === undefined) {
    throw new Error(
      `ClientCode: Found no output from esbuild matching ${quote(
        name,
      )} in ${result.outputFiles.map((output) => quote(output.path)).join(", ")}`,
    );
  }
  /* v8 ignore stop */
  return match.text;
}

export const client = getOutput("client.js");
export const proxy = fs.readFileSync(PROXY_SRC_PATH, "utf8");
