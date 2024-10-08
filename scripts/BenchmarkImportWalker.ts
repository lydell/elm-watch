/* eslint-disable no-console */

import * as Codec from "tiny-decoders";

import * as ElmJson from "../src/ElmJson";
import { getSetSingleton } from "../src/Helpers";
import { walkImports } from "../src/ImportWalker";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "../src/NonEmptyArray";
import {
  absoluteDirname,
  absolutePathFromString,
  findClosest,
} from "../src/PathHelpers";
import {
  AbsolutePath,
  Cwd,
  ElmJsonPath,
  InputPath,
  markAsAbsolutePath,
  markAsCwd,
  markAsElmJsonPath,
} from "../src/Types";

function run(args: Array<string>): void {
  if (!isNonEmptyArray(args)) {
    console.error("You must pass at least one Elm file as the first argument.");
    process.exit(1);
  }

  const cwd: Cwd = markAsCwd(markAsAbsolutePath(process.cwd()));

  const inputPaths: NonEmptyArray<InputPath> = mapNonEmptyArray(
    args,
    (elmFilePathRaw) => ({
      tag: "InputPath",
      theInputPath: absolutePathFromString(cwd, elmFilePathRaw),
      originalString: elmFilePathRaw,
      realpath: absolutePathFromString(cwd, elmFilePathRaw),
    }),
  );

  const elmJsonPathsRaw = new Set<AbsolutePath>(
    mapNonEmptyArray(
      inputPaths,
      (inputPath) =>
        findClosest("elm.json", absoluteDirname(inputPath.theInputPath)) ??
        inputPath.theInputPath,
    ),
  );

  const uniqueElmJsonPathRaw = getSetSingleton(elmJsonPathsRaw);

  if (uniqueElmJsonPathRaw === undefined) {
    console.error(
      "Could not find (a unique) elm.json for all of the input paths:",
      inputPaths,
    );
    process.exit(1);
  }

  if (!uniqueElmJsonPathRaw.endsWith("elm.json")) {
    console.error("Could not find elm.json for:", uniqueElmJsonPathRaw);
    process.exit(1);
  }

  const elmJsonPath: ElmJsonPath = markAsElmJsonPath(uniqueElmJsonPathRaw);

  const elmJsonResult = ElmJson.readSourceDirectories(elmJsonPath);
  switch (elmJsonResult.tag) {
    case "ElmJsonDecodeError":
      console.error(Codec.format(elmJsonResult.error));
      process.exit(1);
    case "ElmJsonReadError":
      console.error(elmJsonResult.error.message);
      process.exit(1);
    case "Parsed":
    // Keep going.
  }

  console.log(
    "Elm file(s):",
    mapNonEmptyArray(inputPaths, (inputPath) => inputPath.theInputPath),
  );
  console.log("elm.json:", elmJsonPath);
  console.time("Run");
  const result = walkImports(elmJsonResult.sourceDirectories, inputPaths);
  console.timeEnd("Run");
  switch (result.tag) {
    case "Success":
      console.log("allRelatedElmFilePaths", result.allRelatedElmFilePaths.size);
      process.exit(0);
    case "ImportWalkerFileSystemError":
      console.error(result.error.message);
      process.exit(1);
  }
}
run(process.argv.slice(2));
