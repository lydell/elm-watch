/* eslint-disable no-console */

import * as fs from "fs";
import * as Decode from "tiny-decoders";

import { ElmJson, getSourceDirectories } from "../src/ElmJson";
import { walkImports } from "../src/ImportWalker";
import { isNonEmptyArray } from "../src/NonEmptyArray";
import {
  absoluteDirname,
  absolutePathFromString,
  Cwd,
  findClosest,
} from "../src/PathHelpers";
import { InputPath } from "../src/Types";

function run(args: Array<string>): void {
  const [elmFilePathRaw, ...rest] = args;

  if (elmFilePathRaw === undefined || !elmFilePathRaw.endsWith(".elm")) {
    console.error(
      "You must pass an Elm file as the first argument. Got:",
      elmFilePathRaw
    );
    process.exit(1);
  }

  if (isNonEmptyArray(rest)) {
    console.error(`Expected a single argument, but got ${rest.length} extra.`);
    process.exit(1);
  }

  const cwd: Cwd = {
    tag: "Cwd",
    path: { tag: "AbsolutePath", absolutePath: process.cwd() },
  };

  const inputPath: InputPath = {
    tag: "InputPath",
    theInputPath: absolutePathFromString(cwd.path, elmFilePathRaw),
    originalString: elmFilePathRaw,
    realpath: absolutePathFromString(cwd.path, elmFilePathRaw),
  };

  const elmJsonPathRaw = findClosest(
    "elm.json",
    absoluteDirname(inputPath.theInputPath)
  );

  if (elmJsonPathRaw === undefined) {
    console.error(
      "No elm.json found for:",
      inputPath.theInputPath.absolutePath
    );
    process.exit(1);
  }

  const elmJsonPath = {
    tag: "ElmJsonPath" as const,
    theElmJsonPath: elmJsonPathRaw,
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

  console.log("Elm file:", inputPath.theInputPath.absolutePath);
  console.log("elm.json:", elmJsonPath.theElmJsonPath.absolutePath);
  console.time("Run");
  const result = walkImports(sourceDirectories, inputPath);
  console.timeEnd("Run");
  switch (result.tag) {
    case "Success":
      console.log("allRelatedElmFilePaths", result.allRelatedElmFilePaths.size);
      process.exit(0);
    case "FileSystemError":
      console.error(result.error.message);
      process.exit(1);
  }
}
run(process.argv.slice(2));
