/* eslint-disable no-console */

import * as fs from "fs";
import * as Codec from "tiny-decoders";

import { inject } from "../src/Inject";
import { absolutePathFromString } from "../src/PathHelpers";
import {
  CompilationMode,
  Cwd,
  markAsAbsolutePath,
  markAsCwd,
  markAsTargetName,
} from "../src/Types";

class KnownError extends Error {}

function run(args: Array<string>): void {
  const [compilationModeRaw, elmFileRaw] = args;

  if (args.length !== 2 || elmFileRaw === undefined) {
    throw new KnownError(
      `You must pass the compilation mode as well as the path to a single JS file of compiled Elm code.`,
    );
  }

  const compilationModeResult = CompilationMode.decoder(compilationModeRaw);
  if (compilationModeResult.tag === "DecoderError") {
    throw new KnownError(Codec.format(compilationModeResult.error));
  }
  const compilationMode = compilationModeResult.value;

  const cwd: Cwd = markAsCwd(markAsAbsolutePath(process.cwd()));

  const elmFile = absolutePathFromString(cwd, elmFileRaw);
  const code = fs.readFileSync(elmFile, "utf8");

  console.time("Run");
  const newCode = inject(compilationMode, code, markAsTargetName("TargetName"));
  console.timeEnd("Run");

  const oldLines = code.split("\n").length;
  const newLines = newCode.split("\n").length;

  console.log(
    `
Success!
Lines before: ${oldLines}
Lines after:  ${newLines}
Diff: ${newLines - oldLines}`,
  );
}

new Promise(() => {
  run(process.argv.slice(2));
}).catch((error) => {
  console.error(error instanceof KnownError ? error.message : error);
});
