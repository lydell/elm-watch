import * as fs from "fs";

import * as ElmWatchJson from "./ElmWatchJson";
import { bold, toError } from "./Helpers";
import { Logger } from "./Logger";
import { isNonEmptyArray } from "./NonEmptyArray";
import { absolutePathFromString } from "./PathHelpers";
import { CliArg, Cwd, ElmWatchJsonPath } from "./Types";

const elmWatchJson = bold("elm-watch.json");

export function init(cwd: Cwd, logger: Logger, args: Array<CliArg>): number {
  if (isNonEmptyArray(args)) {
    logger.error(`${bold("elm-watch init")} takes no arguments.`);
    return 1;
  }

  const elmWatchJsonPath: ElmWatchJsonPath = {
    tag: "ElmWatchJsonPath",
    theElmWatchJsonPath: absolutePathFromString(cwd.path, "elm-watch.json"),
  };

  if (fs.existsSync(elmWatchJsonPath.theElmWatchJsonPath.absolutePath)) {
    logger.error(`${elmWatchJson} already exists in the current directory!`);
    return 1;
  }

  const example = ElmWatchJson.example(cwd, elmWatchJsonPath, {
    elmFiles: [],
    output: undefined,
  });

  try {
    fs.writeFileSync(
      elmWatchJsonPath.theElmWatchJsonPath.absolutePath,
      example
    );
  } catch (unknownError) {
    const error = toError(unknownError);
    logger.error(`Failed to write ${elmWatchJson}:\n\n${error.message}`);
    return 1;
  }

  logger.log(
    `
Created a minimal ${elmWatchJson} in the current directory to get you started.
Go check it out!

Documentation: https://github.com/lydell/elm-watch/#readme
  `.trim()
  );
  return 0;
}
