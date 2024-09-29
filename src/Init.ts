import * as fs from "fs";

import * as ElmWatchJson from "./ElmWatchJson";
import { bold, toError } from "./Helpers";
import { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { absolutePathFromString } from "./PathHelpers";
import { CliArg, Cwd, ElmWatchJsonPath } from "./Types";

const elmWatchJson = bold("elm-watch.json");

// `elm-watch init 2>/dev/null` feels like a reasonable thing to do in a script.
// (Try to create an elm-watch.json and don’t care about errors.)
export function init(cwd: Cwd, logger: Logger, args: Array<CliArg>): number {
  if (isNonEmptyArray(args)) {
    logger.writeToStderrMakesALotOfSenseHere(
      `${bold("elm-watch init")} takes no arguments.`,
    );
    return 1;
  }

  const elmWatchJsonPath: ElmWatchJsonPath = {
    tag: "ElmWatchJsonPath",
    theElmWatchJsonPath: absolutePathFromString(cwd.path, "elm-watch.json"),
  };

  if (fs.existsSync(elmWatchJsonPath.theElmWatchJsonPath.absolutePath)) {
    logger.writeToStderrMakesALotOfSenseHere(
      `${elmWatchJson} already exists in the current directory!`,
    );
    return 1;
  }

  const example = ElmWatchJson.example(cwd, elmWatchJsonPath, {
    elmFiles: [],
    output: undefined,
  });

  try {
    fs.writeFileSync(
      elmWatchJsonPath.theElmWatchJsonPath.absolutePath,
      example,
    );
  } catch (unknownError) {
    const error = toError(unknownError);
    logger.writeToStderrMakesALotOfSenseHere(
      `Failed to write ${elmWatchJson}:\n\n${error.message}`,
    );
    return 1;
  }

  logger.write(
    `
Created a minimal ${elmWatchJson} in the current directory to get you started.
Go check it out!

Documentation: https://lydell.github.io/elm-watch/elm-watch.json/
  `.trim(),
  );
  return 0;
}
