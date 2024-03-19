/* eslint-disable no-console */

import * as fs from "fs";
import * as Codec from "tiny-decoders";

import { inject } from "../src/Inject";
import { absolutePathFromString } from "../src/PathHelpers";
import { CompilationMode, Cwd } from "../src/Types";

class KnownError extends Error {}

function run(args: Array<string>): void {
  const [compilationModeRaw, elmFileRaw] = args;

  if (args.length !== 2 || elmFileRaw === undefined) {
    throw new KnownError(
      `You must pass the compilation mode as well as the path to a single Elm file.`
    );
  }

  const compilationModeResult = CompilationMode.decoder(compilationModeRaw);
  if (compilationModeResult.tag === "DecoderError") {
    throw new KnownError(Codec.format(compilationModeResult.error));
  }
  const compilationMode = compilationModeResult.value;

  const cwd: Cwd = {
    tag: "Cwd",
    path: { tag: "AbsolutePath", absolutePath: process.cwd() },
  };

  const elmFile = absolutePathFromString(cwd.path, elmFileRaw);
  const code = fs.readFileSync(elmFile.absolutePath, "utf8");

  console.time("Run");
  const newCode = inject(compilationMode, code);
  console.timeEnd("Run");

  console.log(
    `Success! Before: ${code.length}. After: ${newCode.length}. Diff: ${
      newCode.length - code.length
    }`
  );
}

new Promise(() => {
  run(process.argv.slice(2));
}).catch((error) => {
  console.error(error instanceof KnownError ? error.message : error);
});
