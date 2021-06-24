/* eslint-disable no-console */

import * as fs from "fs";
import * as Decode from "tiny-decoders";

import { ElmJson, getSourceDirectories } from "../src/ElmJson";
import { HashSet } from "../src/HashSet";
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
  Cwd,
  findClosest,
} from "../src/PathHelpers";
import { InputPath } from "../src/Types";

function run(args: Array<string>): void {
  if (!isNonEmptyArray(args)) {
    console.error("You must pass at least one Elm file as the first argument.");
    process.exit(1);
  }

  const cwd: Cwd = {
    tag: "Cwd",
    path: { tag: "AbsolutePath", absolutePath: process.cwd() },
  };

  const inputPaths: NonEmptyArray<InputPath> = mapNonEmptyArray(
    args,
    (elmFilePathRaw) => ({
      tag: "InputPath",
      theInputPath: absolutePathFromString(cwd.path, elmFilePathRaw),
      originalString: elmFilePathRaw,
      realpath: absolutePathFromString(cwd.path, elmFilePathRaw),
    })
  );

  const elmJsonPathsRaw = new HashSet(
    mapNonEmptyArray(
      inputPaths,
      (inputPath) =>
        findClosest("elm.json", absoluteDirname(inputPath.theInputPath)) ?? {
          tag: "NotFound" as const,
          inputPath,
        }
    )
  );

  const uniqueElmJsonPathRaw = getSetSingleton(elmJsonPathsRaw);

  if (uniqueElmJsonPathRaw === undefined) {
    console.error(
      "Could not find (a unique) elm.json for all of the input paths:",
      inputPaths
    );
    process.exit(1);
  }

  if (uniqueElmJsonPathRaw.tag === "NotFound") {
    console.error(
      "Could not find elm.json for:",
      uniqueElmJsonPathRaw.inputPath
    );
    process.exit(1);
  }

  const elmJsonPath = {
    tag: "ElmJsonPath" as const,
    theElmJsonPath: uniqueElmJsonPathRaw,
  };

  let elmJson;
  try {
    elmJson = ElmJson(
      JSON.parse(
        fs.readFileSync(elmJsonPath.theElmJsonPath.absolutePath, "utf8")
      )
    );
  } catch (error) {
    console.error(
      error instanceof Decode.DecoderError
        ? error.format()
        : error instanceof Error
        ? error.message
        : error
    );
    process.exit(1);
  }

  const sourceDirectories = getSourceDirectories(elmJsonPath, elmJson);

  console.log(
    "Elm file(s):",
    mapNonEmptyArray(
      inputPaths,
      (inputPath) => inputPath.theInputPath.absolutePath
    )
  );
  console.log("elm.json:", elmJsonPath.theElmJsonPath.absolutePath);
  console.time("Run");
  const result = walkImports(sourceDirectories, inputPaths);
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
