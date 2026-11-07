import * as fs from "fs";

import * as ElmWatchJson from "./ElmWatchJson";
import * as Errors from "./Errors";
import {
  ENTRYPOINT_NAMES,
  EntrypointLanguage,
  generateEntrypoint,
} from "./GenerateEntrypoint";
import { bold, toError } from "./Helpers";
import { Logger } from "./Logger";
import {
  absoluteDirname,
  absolutePathFromString,
  findClosest,
} from "./PathHelpers";
import {
  AbsolutePath,
  CliArg,
  Cwd,
  ElmWatchJsonPath,
  markAsElmWatchJsonPath,
} from "./Types";

const elmWatchJson = bold("elm-watch.json");

const JAVASCRIPT_API_DOCS_LINK =
  "https://lydell.github.io/elm-watch/javascript-api/";

type Language = EntrypointLanguage | "json";

// `elm-watch init 2>/dev/null` feels like a reasonable thing to do in a script.
// (Try to create an elm-watch.json and don’t care about errors.)
export function init(cwd: Cwd, logger: Logger, args: Array<CliArg>): number {
  const language = parseArgs(args);

  switch (language) {
    case undefined:
      logger.writeToStderrMakesALotOfSenseHere(
        `${bold("elm-watch init")} takes either no arguments, ${bold("--javascript")} or ${bold("--typescript")}.`,
      );
      return 1;

    case "json":
      return initElmWatchJson(cwd, logger);

    case "javascript":
    case "typescript":
      return initEntrypoint(cwd, logger, language);
  }
}

function parseArgs(args: Array<CliArg>): Language | undefined {
  // Using both flags is an error, just like `--debug` and `--optimize`.
  switch (args.join(" ")) {
    case "":
      return "json";
    case "--javascript":
      return "javascript";
    case "--typescript":
      return "typescript";
    default:
      return undefined;
  }
}

function initElmWatchJson(cwd: Cwd, logger: Logger): number {
  const existingElmWatchJson = findClosest("elm-watch.json", cwd);

  if (existingElmWatchJson !== undefined) {
    logger.writeToStderrMakesALotOfSenseHere(
      `${elmWatchJson} already exists:\n\n${existingElmWatchJson}`,
    );
    return 1;
  }

  const existingEntrypoint = findExistingEntrypoint(cwd);

  if (existingEntrypoint !== undefined) {
    logger.writeToStderrMakesALotOfSenseHere(
      alreadyUsingJavaScriptApi(existingEntrypoint),
    );
    return 1;
  }

  const elmWatchJsonPath: ElmWatchJsonPath = markAsElmWatchJsonPath(
    absolutePathFromString(cwd, "elm-watch.json"),
  );

  const example = ElmWatchJson.example(cwd, elmWatchJsonPath, {
    elmFiles: [],
    output: undefined,
  });

  try {
    fs.writeFileSync(elmWatchJsonPath, example);
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

// Creates elm-watch.mjs (or elm-watch.mts) for using the JavaScript API: From
// the closest elm-watch.json if there is one (which is then removed, since the
// new file replaces it), or from the same example as `elm-watch init`.
function initEntrypoint(
  cwd: Cwd,
  logger: Logger,
  language: EntrypointLanguage,
): number {
  const parseResult = ElmWatchJson.findReadAndParseWithLegacyPostprocess(cwd);

  let dir: AbsolutePath;
  let json: ElmWatchJson.ElmWatchJsonWithLegacyPostprocess;
  let migratedElmWatchJsonPath: ElmWatchJsonPath | undefined;

  switch (parseResult.tag) {
    case "ElmWatchJsonNotFound":
      dir = cwd;
      json = ElmWatchJson.exampleJson(
        cwd,
        markAsElmWatchJsonPath(absolutePathFromString(cwd, "elm-watch.json")),
        { elmFiles: [], output: undefined },
      );
      migratedElmWatchJsonPath = undefined;
      break;

    case "ReadError":
      logger.errorTemplate(
        Errors.readElmWatchJson(
          parseResult.elmWatchJsonPath,
          parseResult.error,
        ),
      );
      return 1;

    case "DecoderError":
      logger.errorTemplate(
        Errors.decodeElmWatchJson(
          parseResult.elmWatchJsonPath,
          parseResult.error,
        ),
      );
      return 1;

    case "Parsed":
      dir = absoluteDirname(parseResult.elmWatchJsonPath);
      json = parseResult.value;
      migratedElmWatchJsonPath = parseResult.elmWatchJsonPath;
      break;
  }

  const existingEntrypoint = findExistingEntrypoint(dir);

  if (existingEntrypoint !== undefined) {
    logger.writeToStderrMakesALotOfSenseHere(
      alreadyUsingJavaScriptApi(existingEntrypoint),
    );
    return 1;
  }

  const entrypointName = ENTRYPOINT_NAMES[language];
  const entrypointPath = absolutePathFromString(dir, entrypointName);

  try {
    fs.writeFileSync(entrypointPath, generateEntrypoint(json, language));
  } catch (unknownError) {
    const error = toError(unknownError);
    logger.writeToStderrMakesALotOfSenseHere(
      `Failed to write ${bold(entrypointName)}:\n\n${error.message}`,
    );
    return 1;
  }

  const runIt = `
Run it like so:

    node --watch ${entrypointName} hot
    node ${entrypointName} make --optimize
  `.trim();

  if (migratedElmWatchJsonPath === undefined) {
    logger.write(
      `
Created a minimal ${bold(entrypointName)} in the current directory to get you started.
Go check it out!

${runIt}

Documentation: ${JAVASCRIPT_API_DOCS_LINK}
      `.trim(),
    );
    return 0;
  }

  try {
    fs.unlinkSync(migratedElmWatchJsonPath);
  } catch (unknownError) {
    const error = toError(unknownError);
    logger.writeToStderrMakesALotOfSenseHere(
      `Created ${bold(entrypointPath)} from ${elmWatchJson}, but failed to remove ${elmWatchJson}:\n\n${error.message}\n\nPlease remove it yourself – it’s not used anymore.`,
    );
    return 1;
  }

  const postprocessNote =
    json.postprocess === undefined
      ? ""
      : `\nYour "postprocess" is now the ${bold("postprocessFor")} function at the bottom of the file.\n`;

  logger.write(
    `
Created ${bold(entrypointName)} from ${elmWatchJson}, and removed ${elmWatchJson}
(everything from it is in ${entrypointName} now):

${entrypointPath}
${postprocessNote}
${runIt}

Remember to update your package.json scripts and CI too.

Documentation: ${JAVASCRIPT_API_DOCS_LINK}
    `.trim(),
  );
  return 0;
}

function findExistingEntrypoint(dir: AbsolutePath): AbsolutePath | undefined {
  return Object.values(ENTRYPOINT_NAMES)
    .map((name) => absolutePathFromString(dir, name))
    .find((entrypointPath) => fs.existsSync(entrypointPath));
}

function alreadyUsingJavaScriptApi(existingEntrypoint: AbsolutePath): string {
  return `
You already use the JavaScript API (instead of ${elmWatchJson}):

${existingEntrypoint}

Documentation: ${JAVASCRIPT_API_DOCS_LINK}
  `.trim();
}
