import * as fs from "fs";
import * as Codec from "tiny-decoders";

import * as ElmWatchJson from "./ElmWatchJson.ts";
import * as Errors from "./Errors.ts";
import {
  ENTRYPOINT_NAMES,
  type EntrypointLanguage,
  generateEntrypoint,
} from "./GenerateEntrypoint.ts";
import { bold, toError } from "./Helpers.ts";
import type { Logger } from "./Logger.ts";
import { isNonEmptyArray } from "./NonEmptyArray.ts";
import {
  absoluteDirname,
  absolutePathFromString,
  findClosest,
} from "./PathHelpers.ts";
import {
  type AbsolutePath,
  type CliArg,
  type Cwd,
  type ElmWatchJsonPath,
  markAsElmWatchJsonPath,
} from "./Types.ts";

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
    return upgradeElmWatchJson(
      logger,
      markAsElmWatchJsonPath(existingElmWatchJson),
    );
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

  const { json, discoveredInputs } = ElmWatchJson.initJson(
    cwd,
    elmWatchJsonPath,
  );

  try {
    fs.writeFileSync(
      elmWatchJsonPath,
      `${Codec.JSON.stringify(Codec.unknown, json, 4)}\n`,
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
${createdMessage(elmWatchJson, discoveredInputs)}

Documentation: https://lydell.github.io/elm-watch/elm-watch.json/
  `.trim(),
  );
  return 0;
}

function createdMessage(
  fileName: string,
  discoveredInputs: Array<string>,
): string {
  return isNonEmptyArray(discoveredInputs)
    ? `
Created ${fileName} in the current directory to get you started, with a
target for each of these Elm files with \`main\`:

${discoveredInputs.join("\n")}

Go check it out, and adjust the outputs to where you want them!
      `.trim()
    : `
Created a minimal ${fileName} in the current directory to get you started.
Go check it out!
      `.trim();
}

// Upgrades an elm-watch.json from elm-watch 1 (see `ElmWatchJson.upgradeTargets`).
function upgradeElmWatchJson(
  logger: Logger,
  elmWatchJsonPath: ElmWatchJsonPath,
): number {
  let content: string;
  try {
    content = fs.readFileSync(elmWatchJsonPath, "utf8");
  } catch (unknownError) {
    const error = toError(unknownError);
    logger.errorTemplate(Errors.readElmWatchJson(elmWatchJsonPath, error));
    return 1;
  }

  const parsed = Codec.JSON.parse(Codec.unknown, content);
  if (parsed.tag === "DecoderError") {
    logger.errorTemplate(
      Errors.decodeElmWatchJson(elmWatchJsonPath, parsed.error),
    );
    return 1;
  }

  const { json, upgradedTargets } = ElmWatchJson.upgradeTargets(
    elmWatchJsonPath,
    parsed.value,
  );

  if (!isNonEmptyArray(upgradedTargets)) {
    logger.writeToStderrMakesALotOfSenseHere(
      `${elmWatchJson} already exists (and has nothing to upgrade):\n\n${elmWatchJsonPath}`,
    );
    return 1;
  }

  // Keep the indentation and trailing newline of the file.
  const indent = /^([ \t]+)"/m.exec(content)?.[1] ?? "    ";
  const newline = content.endsWith("\n") ? "\n" : "";

  try {
    fs.writeFileSync(
      elmWatchJsonPath,
      `${Codec.JSON.stringify(Codec.unknown, json, indent)}${newline}`,
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
Upgraded ${elmWatchJson}:

${elmWatchJsonPath}

${upgradedTargetsReport(upgradedTargets)}

Documentation: https://lydell.github.io/elm-watch/elm-watch.json/
  `.trim(),
  );
  return 0;
}

function upgradedTargetsReport(
  upgradedTargets: Array<ElmWatchJson.UpgradedTarget>,
): string {
  const hasStatus = (
    status: ElmWatchJson.UpgradedTarget["elmJsonStatus"],
  ): boolean =>
    upgradedTargets.some(({ elmJsonStatus }) => elmJsonStatus === status);

  const notFoundNote = hasStatus("NotFound")
    ? `\n\n${bold("(not found)")} means that I couldn’t find an elm.json for the target.\nPlease update "elmJson" yourself!`
    : "";

  const packageNote = hasStatus("Package")
    ? `\n\n${bold("(package)")} means that the elm.json has "type": "package". Targets with inputs
and output need an elm.json with "type": "application" now. To typecheck the
package, change the target to "type": "package" (and remove "inputs" and
"output"). To compile an example using the package, give the example its own
elm.json: https://lydell.github.io/elm-watch/elm-watch.json/#package-targets`
    : "";

  return `
Targets now need "type" and "elmJson". I added them to these targets:

${upgradedTargets
  .map(({ name, elmJson, elmJsonStatus }) => {
    switch (elmJsonStatus) {
      case "Found":
        return `${name}: ${elmJson}`;
      case "NotFound":
        return `${name}: ${elmJson} ${bold("(not found)")}`;
      case "Package":
        return `${name}: ${elmJson} ${bold("(package)")}`;
    }
  })
  .join("\n")}${notFoundNote}${packageNote}
  `.trim();
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
  let upgradedTargets: Array<ElmWatchJson.UpgradedTarget>;
  let discoveredInputs: Array<string> = [];
  let migratedElmWatchJsonPath: ElmWatchJsonPath | undefined;

  switch (parseResult.tag) {
    case "ElmWatchJsonNotFound":
      dir = cwd;
      ({ json, discoveredInputs } = ElmWatchJson.initJson(
        cwd,
        markAsElmWatchJsonPath(absolutePathFromString(cwd, "elm-watch.json")),
      ));
      upgradedTargets = [];
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
      ({ json, upgradedTargets } = parseResult.value);
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
${createdMessage(bold(entrypointName), discoveredInputs)}

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

  const upgradeNote = isNonEmptyArray(upgradedTargets)
    ? `\n${upgradedTargetsReport(upgradedTargets)}\n`
    : "";

  logger.write(
    `
Created ${bold(entrypointName)} from ${elmWatchJson}, and removed ${elmWatchJson}
(everything from it is in ${entrypointName} now):

${entrypointPath}
${postprocessNote}${upgradeNote}
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
