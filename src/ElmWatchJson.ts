import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";

import { AllowedHost } from "./AllowedHosts.ts";
import type { Config, Target as ConfigTarget } from "./Config.ts";
import { readElmJsonType, readSourceDirectories } from "./ElmJson.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray.ts";
import { MODULE_NAME_PART } from "./Parser.ts";
import {
  absoluteDirname,
  absolutePathFromString,
  findClosest,
  readJsonFile,
} from "./PathHelpers.ts";
import { Port } from "./Port.ts";
import {
  type AbsolutePath,
  type CliArg,
  Compiler,
  type Cwd,
  type ElmJsonPath,
  type ElmWatchJsonPath,
  markAsElmJsonPath,
  markAsElmWatchJsonPath,
} from "./Types.ts";
import { WebSocketUrl } from "./WebSocketUrl.ts";

// First char uppercase: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L263-L267
// Rest: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L328-L335
// https://hackage.haskell.org/package/base-4.14.0.0/docs/Data-Char.html#v:isLetter
const INPUT_NAME = /(^|[/\\])\p{Lu}[_\d\p{L}]*\.elm$/u;

function isValidInputName(name: string): boolean {
  return INPUT_NAME.test(name);
}

function isValidOutputName(name: string): boolean {
  // `elm make` doesn’t accept just `.js` but `a.js` and `a/.js`.
  // Disallow stuff starting with `-` so output CLI args don’t look like flags.
  return !name.startsWith("-") && name.endsWith(".js") && name !== ".js";
}

const TARGET_NAME = /^[^\s-](?:.*\S)?$/;

function isValidTargetName(name: string): boolean {
  return TARGET_NAME.test(name);
}

export const Inputs = NonEmptyArray(
  Codec.flatMap(Codec.string, {
    decoder: (string) =>
      isValidInputName(string)
        ? { tag: "Valid", value: string }
        : {
            tag: "DecoderError",
            error: {
              tag: "custom",
              message: "Inputs must have a valid module name and end with .elm",
              got: string,
              path: [],
            },
          },
    encoder: (value) => value,
  }),
);

export const Output = Codec.flatMap(Codec.string, {
  decoder: (output) =>
    isValidOutputName(output)
      ? { tag: "Valid", value: output }
      : {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: "Outputs must end with .js",
            got: output,
            path: [],
          },
        },
  encoder: (value) => value,
});

const TARGET_NAME_ERROR_MESSAGE =
  "Target names must start with a non-whitespace character except `-`,\ncannot contain newlines and must end with a non-whitespace character";

export const TargetName = Codec.flatMap(Codec.string, {
  decoder: (name) =>
    isValidTargetName(name)
      ? { tag: "Valid", value: name }
      : {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: TARGET_NAME_ERROR_MESSAGE,
            got: name,
            path: [],
          },
        },
  // Encoding is never used.
  encoder: (value) => value,
});

export const ElmJsonPathString = Codec.flatMap(Codec.string, {
  decoder: (string) =>
    path.basename(string) === "elm.json"
      ? { tag: "Valid", value: string }
      : {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: "Expected a path to a file called elm.json",
            got: string,
            path: [],
          },
        },
  encoder: (value) => value,
});

type Target = Codec.Infer<typeof Target>;
const Target = Codec.taggedUnion(
  "type",
  [
    {
      type: Codec.tag("application"),
      elmJson: ElmJsonPathString,
      compiler: Codec.field(Compiler, { optional: true }),
      inputs: Inputs,
      output: Output,
    },
    {
      type: Codec.tag("package"),
      elmJson: ElmJsonPathString,
      compiler: Codec.field(Compiler, { optional: true }),
    },
  ],
  { allowExtraFields: false },
);

// elm-watch 1 found the elm.json for each target automatically, and only
// supported applications. Give a helpful error for people upgrading.
const TargetWithMigrationHint: Codec.Codec<Target> = {
  decoder: (value) =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !("type" in value) &&
    !("elmJson" in value)
      ? {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: `Targets now need "type" and "elmJson" fields, for example:
"type": "application",
"elmJson": "elm.json",
Run \`elm-watch init\` to add them automatically.`,
            got: value,
            path: [],
          },
        }
      : Target.decoder(value),
  // Encoding is never used.
  encoder: (value) => value,
};

const TargetRecordHelper = {
  decoder: (
    record: Record<string, Target>,
  ): Codec.DecoderResult<Record<string, Target>> => {
    const keys = Object.keys(record);
    for (const key of keys) {
      if (!isValidTargetName(key)) {
        return {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: TARGET_NAME_ERROR_MESSAGE,
            got: key,
            path: [key],
          },
        };
      }
    }

    return isNonEmptyArray(keys)
      ? { tag: "Valid", value: record }
      : {
          tag: "DecoderError",
          error: {
            tag: "custom",
            message: "Expected a non-empty object",
            got: record,
            path: [],
          },
        };
  },
  encoder: (value: Record<string, Target>) => value,
};

// elm-watch 1 supported "postprocess" in elm-watch.json. Give a helpful error
// for people upgrading.
const PostprocessNoLongerSupported: Codec.Codec<undefined> = {
  decoder: (value) => ({
    tag: "DecoderError",
    error: {
      tag: "custom",
      message: `"postprocess" is no longer supported in elm-watch.json.
Instead, create a JavaScript file that imports elm-watch and calls \`elmWatch()\`
with your targets, and give each target a \`postprocess\` function.
Run \`elm-watch init --javascript\` to create such a file from your
elm-watch.json.
Learn more: https://lydell.github.io/elm-watch/postprocess/`,
      got: value,
      path: [],
    },
  }),
  // Encoding is never used.
  encoder: (value) => value,
};

const elmWatchJsonFields = {
  targets: Codec.flatMap(
    Codec.record(TargetWithMigrationHint),
    TargetRecordHelper,
  ),
  port: Codec.field(Port, { optional: true }),
  webSocketUrl: Codec.field(WebSocketUrl("elm-watch.json"), {
    optional: true,
  }),
  serve: Codec.field(Codec.string, { optional: true }),
  allowedHosts: Codec.field(Codec.array(AllowedHost), { optional: true }),
};

export type ElmWatchJson = Codec.Infer<typeof ElmWatchJson>;
const ElmWatchJson = Codec.fields(
  {
    ...elmWatchJsonFields,
    postprocess: Codec.field(PostprocessNoLongerSupported, { optional: true }),
  },
  { allowExtraFields: false },
);

// Used by `elm-watch init --javascript`, which migrates "postprocess" to the
// JavaScript API.
export type ElmWatchJsonWithLegacyPostprocess = Codec.Infer<
  typeof ElmWatchJsonWithLegacyPostprocess
>;
const ElmWatchJsonWithLegacyPostprocess = Codec.fields(
  {
    ...elmWatchJsonFields,
    postprocess: Codec.field(NonEmptyArray(Codec.string), { optional: true }),
  },
  { allowExtraFields: false },
);

type ParseResult<T> =
  | {
      tag: "DecoderError";
      elmWatchJsonPath: ElmWatchJsonPath;
      error: Codec.DecoderError;
    }
  | {
      tag: "ElmWatchJsonNotFound";
    }
  | {
      tag: "Parsed";
      elmWatchJsonPath: ElmWatchJsonPath;
      value: T;
    }
  | {
      tag: "ReadError";
      elmWatchJsonPath: ElmWatchJsonPath;
      error: Error;
    };

export function findReadAndParse(cwd: Cwd): ParseResult<Config> {
  const result = findReadAndDecode(cwd, ElmWatchJson);
  return result.tag === "Parsed"
    ? { ...result, value: toConfig(cwd, result.elmWatchJsonPath, result.value) }
    : result;
}

// Used by `elm-watch init --javascript`, which also upgrades targets from
// elm-watch 1 (see `upgradeTargets`).
export function findReadAndParseWithLegacyPostprocess(cwd: Cwd): ParseResult<{
  json: ElmWatchJsonWithLegacyPostprocess;
  upgradedTargets: Array<UpgradedTarget>;
}> {
  let upgradedTargets: Array<UpgradedTarget> = [];
  const result = findReadAndDecode(
    cwd,
    ElmWatchJsonWithLegacyPostprocess,
    (elmWatchJsonPath, json) => {
      const upgraded = upgradeTargets(elmWatchJsonPath, json);
      ({ upgradedTargets } = upgraded);
      return upgraded.json;
    },
  );
  return result.tag === "Parsed"
    ? { ...result, value: { json: result.value, upgradedTargets } }
    : result;
}

function findReadAndDecode<T>(
  cwd: Cwd,
  codec: Codec.Codec<T>,
  transform: (elmWatchJsonPath: ElmWatchJsonPath, json: unknown) => unknown = (
    _,
    json,
  ) => json,
): ParseResult<T> {
  const elmWatchJsonPathRaw = findClosest("elm-watch.json", cwd);
  if (elmWatchJsonPathRaw === undefined) {
    return {
      tag: "ElmWatchJsonNotFound",
    };
  }

  const elmWatchJsonPath: ElmWatchJsonPath =
    markAsElmWatchJsonPath(elmWatchJsonPathRaw);

  const read = readJsonFile(elmWatchJsonPath, Codec.unknown);
  const parsed =
    read.tag === "Valid"
      ? codec.decoder(transform(elmWatchJsonPath, read.value))
      : read;

  switch (parsed.tag) {
    case "DecoderError":
      return {
        tag: "DecoderError",
        elmWatchJsonPath,
        error: parsed.error,
      };
    case "ReadError":
      return {
        tag: "ReadError",
        elmWatchJsonPath,
        error: parsed.error,
      };
    case "Valid":
      return {
        tag: "Parsed",
        elmWatchJsonPath,
        value: parsed.value,
      };
  }
}

export type UpgradedTarget = {
  name: string;
  elmJson: string;
  // If no elm.json was found, "elmJson" is set to "elm.json". If the elm.json
  // is a package, the target won't work (it becomes an application target).
  elmJsonStatus: "Found" | "NotFound" | "Package";
};

// elm-watch 1 found the elm.json for each target automatically, and only
// supported applications. Add "type" and "elmJson" to targets that have
// neither, using the elm.json closest to the first input. If the elm.json is
// a package, the target still becomes an application: elm-watch then reports
// the mismatch.
export function upgradeTargets(
  elmWatchJsonPath: ElmWatchJsonPath,
  json: unknown,
): { json: unknown; upgradedTargets: Array<UpgradedTarget> } {
  if (!isRecord(json) || !isRecord(json["targets"])) {
    return { json, upgradedTargets: [] };
  }

  const upgradedTargets: Array<UpgradedTarget> = [];

  const targets = Object.fromEntries(
    Object.entries(json["targets"]).map(([name, target]) => {
      if (!isRecord(target) || "type" in target || "elmJson" in target) {
        return [name, target];
      }

      const { inputs } = target;
      const firstInput =
        Array.isArray(inputs) && typeof inputs[0] === "string"
          ? inputs[0]
          : undefined;
      const elmWatchJsonDir = absoluteDirname(elmWatchJsonPath);
      const elmJsonPath = findClosest(
        "elm.json",
        firstInput === undefined
          ? elmWatchJsonDir
          : absoluteDirname(
              absolutePathFromString(elmWatchJsonDir, firstInput),
            ),
      );
      const elmJson =
        elmJsonPath === undefined
          ? "elm.json"
          : toUnixPath(path.relative(elmWatchJsonDir, elmJsonPath));

      upgradedTargets.push({
        name,
        elmJson,
        elmJsonStatus:
          elmJsonPath === undefined
            ? "NotFound"
            : isPackageElmJson(markAsElmJsonPath(elmJsonPath))
              ? "Package"
              : "Found",
      });

      return [name, { type: "application", elmJson, ...target }];
    }),
  );

  return { json: { ...json, targets }, upgradedTargets };
}

function isPackageElmJson(elmJsonPath: ElmJsonPath): boolean {
  const result = readElmJsonType(elmJsonPath);
  return result.tag === "Found" && result.type === "package";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toConfig(
  cwd: Cwd,
  elmWatchJsonPath: ElmWatchJsonPath,
  json: ElmWatchJson,
): Config {
  return {
    root: absoluteDirname(elmWatchJsonPath),
    source: { tag: "ElmWatchJson", elmWatchJsonPath, cwd },
    // The decoder validates that there’s at least one target.
    targets: Object.entries(json.targets).map(
      ([name, target]): ConfigTarget => {
        switch (target.type) {
          case "application":
            return {
              type: target.type,
              name,
              elmJson: target.elmJson,
              compiler: target.compiler ?? "elm",
              inputs: target.inputs,
              output: target.output,
              postprocess: undefined,
            };
          case "package":
            return {
              type: target.type,
              name,
              elmJson: target.elmJson,
              compiler: target.compiler ?? "elm",
            };
        }
      },
    ) as NonEmptyArray<ConfigTarget>,
    port: json.port,
    host: undefined,
    webSocketUrl: json.webSocketUrl,
    staticFilesDir: json.serve,
    allowedHosts: json.allowedHosts ?? [],
    openEditor: undefined,
  };
}

export function example(
  cwd: Cwd,
  elmWatchJsonPath: ElmWatchJsonPath,
  elmMakeParsed: ElmMakeParsed,
): string {
  return Codec.JSON.stringify(
    ElmWatchJson,
    exampleJson(cwd, elmWatchJsonPath, elmMakeParsed),
    4,
  );
}

// More `main` files than this are probably not all entrypoints (scratch files,
// generated code), so we use the example then instead.
const MAX_DISCOVERED_MAINS = 10;

// For `elm-watch init` (when there is no elm-watch.json): Like `exampleJson`,
// but with a target for each Elm file with `main` in the source directories of
// the closest (application) elm.json, if any.
export function initJson(
  cwd: Cwd,
  elmWatchJsonPath: ElmWatchJsonPath,
): { json: Pick<ElmWatchJson, "targets">; discoveredInputs: Array<string> } {
  const fallback = {
    json: exampleJson(cwd, elmWatchJsonPath, {
      elmFiles: [],
      output: undefined,
    }),
    discoveredInputs: [],
  };

  const elmJsonPathRaw = findClosest("elm.json", cwd);
  if (elmJsonPathRaw === undefined) {
    return fallback;
  }
  const elmJsonPath = markAsElmJsonPath(elmJsonPathRaw);

  // Packages get a package target (see `exampleJson`).
  if (isPackageElmJson(elmJsonPath)) {
    return fallback;
  }

  const sourceDirectoriesResult = readSourceDirectories(elmJsonPath);
  if (sourceDirectoriesResult.tag !== "Parsed") {
    return fallback;
  }

  // Source directories can overlap, and two source directories can contain the
  // same module name. Elm complains about the latter, so just pick the first.
  const mains = new Map<string, AbsolutePath>();
  for (const sourceDirectory of sourceDirectoriesResult.sourceDirectories) {
    for (const file of findElmFilesWithMain(sourceDirectory)) {
      const moduleName = path
        .relative(sourceDirectory, file)
        .slice(0, -".elm".length)
        .split(path.sep)
        .join(".");
      if (!mains.has(moduleName)) {
        mains.set(moduleName, file);
      }
    }
  }

  if (mains.size === 0 || mains.size > MAX_DISCOVERED_MAINS) {
    return fallback;
  }

  const elmWatchJsonDir = path.dirname(elmWatchJsonPath);
  const relative = (file: string): string =>
    toUnixPath(path.relative(elmWatchJsonDir, file));

  const targets = Object.fromEntries(
    Array.from(mains, ([moduleName, file]) => [
      moduleName,
      {
        type: "application" as const,
        elmJson: relative(elmJsonPath),
        inputs: [relative(file)] as NonEmptyArray<string>,
        output: `build/${moduleName}.js`,
      },
    ]),
  );

  return {
    json: { targets },
    discoveredInputs: Array.from(mains.values(), relative),
  };
}

// Only looks at files and directories that are valid module names, which rules
// out things like `elm-stuff` and `node_modules`. Top-level definitions in Elm
// must start at the beginning of the line, so `^main\b` is precise enough (it
// matches both `main =` and `main :`).
function findElmFilesWithMain(dir: AbsolutePath): Array<AbsolutePath> {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .flatMap((entry) => {
      const entryPath = absolutePathFromString(dir, entry.name);
      if (entry.isDirectory()) {
        return MODULE_NAME_PART.test(entry.name)
          ? findElmFilesWithMain(entryPath)
          : [];
      }
      if (
        entry.isFile() &&
        entry.name.endsWith(".elm") &&
        MODULE_NAME_PART.test(entry.name.slice(0, -".elm".length))
      ) {
        try {
          return /^main\b/m.test(fs.readFileSync(entryPath, "utf8"))
            ? [entryPath]
            : [];
        } catch {
          return [];
        }
      }
      return [];
    });
}

export function exampleJson(
  cwd: Cwd,
  elmWatchJsonPath: ElmWatchJsonPath,
  elmMakeParsed: ElmMakeParsed,
): Pick<ElmWatchJson, "targets"> {
  const { elmFiles, output = "build/main.js" } = elmMakeParsed;

  const [firstElmFile] = elmFiles;
  const elmJsonPath = findClosest(
    "elm.json",
    firstElmFile === undefined
      ? cwd
      : absoluteDirname(absolutePathFromString(cwd, firstElmFile)),
  );
  const elmJson =
    elmJsonPath === undefined
      ? "elm.json"
      : // Use slashes in all paths since they work everywhere (including
        // Windows), while backslashes only work on Windows.
        toUnixPath(path.relative(path.dirname(elmWatchJsonPath), elmJsonPath));

  if (
    elmJsonPath !== undefined &&
    !isNonEmptyArray(elmFiles) &&
    isPackageElmJson(markAsElmJsonPath(elmJsonPath))
  ) {
    return {
      targets: {
        "My package": { type: "package", elmJson },
      },
    };
  }

  return {
    targets: {
      "My target name": {
        type: "application",
        elmJson,
        inputs: isNonEmptyArray(elmFiles)
          ? mapNonEmptyArray(elmFiles, (file) =>
              toUnixPath(
                path.relative(
                  path.dirname(elmWatchJsonPath),
                  path.resolve(cwd, file),
                ),
              ),
            )
          : ["src/Main.elm"],
        output,
      },
    },
  };
}

function toUnixPath(filePath: string): string {
  return IS_WINDOWS ? filePath.split(path.sep).join(path.posix.sep) : filePath;
}

type ElmMakeParsed = {
  elmFiles: Array<string>;
  output: string | undefined;
};

type IntermediateElmMakeParsed = ElmMakeParsed & { justSawOutputFlag: boolean };

export function parseArgsLikeElmMake(args: Array<CliArg>): ElmMakeParsed {
  return args.reduce<IntermediateElmMakeParsed>(
    (passedParsed, arg): IntermediateElmMakeParsed => {
      const parsed = { ...passedParsed, justSawOutputFlag: false };
      switch (arg) {
        case "--debug":
        case "--optimize":
          return parsed;

        case "--output":
          return { ...parsed, justSawOutputFlag: true };

        default: {
          if (passedParsed.justSawOutputFlag) {
            return isValidOutputName(arg) ? { ...parsed, output: arg } : parsed;
          }

          const outputPrefix = "--output=";
          if (arg.startsWith(outputPrefix)) {
            const file = arg.slice(outputPrefix.length);
            return isValidOutputName(file)
              ? { ...parsed, output: file }
              : parsed;
          }

          return isValidInputName(arg)
            ? { ...parsed, elmFiles: parsed.elmFiles.concat(arg) }
            : parsed;
        }
      }
    },
    {
      elmFiles: [],
      output: undefined,
      justSawOutputFlag: false,
    },
  );
}
