import * as path from "path";
import * as Codec from "tiny-decoders";

import { AllowedHost } from "./AllowedHosts";
import type { Config, Target as ConfigTarget } from "./Config";
import { IS_WINDOWS } from "./IsWindows";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { absoluteDirname, findClosest, readJsonFile } from "./PathHelpers";
import { Port } from "./Port";
import {
  type CliArg,
  type Cwd,
  type ElmWatchJsonPath,
  markAsElmWatchJsonPath,
} from "./Types";
import { WebSocketUrl } from "./WebSocketUrl";

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
  encoder: (value) => value,
});

type Target = Codec.Infer<typeof Target>;
const Target = Codec.fields(
  {
    inputs: Inputs,
    output: Output,
  },
  { allowExtraFields: false },
);

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

export type ElmWatchJson = Codec.Infer<typeof ElmWatchJson>;
const ElmWatchJson = Codec.fields(
  {
    targets: Codec.flatMap(Codec.record(Target), TargetRecordHelper),
    postprocess: Codec.field(NonEmptyArray(Codec.string), { optional: true }),
    port: Codec.field(Port, { optional: true }),
    webSocketUrl: Codec.field(WebSocketUrl("elm-watch.json"), {
      optional: true,
    }),
    serve: Codec.field(Codec.string, { optional: true }),
    allowedHosts: Codec.field(Codec.array(AllowedHost), { optional: true }),
  },
  { allowExtraFields: false },
);

type ParseResult =
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
      config: Config;
    }
  | {
      tag: "ReadError";
      elmWatchJsonPath: ElmWatchJsonPath;
      error: Error;
    };

export function findReadAndParse(cwd: Cwd): ParseResult {
  const elmWatchJsonPathRaw = findClosest("elm-watch.json", cwd);
  if (elmWatchJsonPathRaw === undefined) {
    return {
      tag: "ElmWatchJsonNotFound",
    };
  }

  const elmWatchJsonPath: ElmWatchJsonPath =
    markAsElmWatchJsonPath(elmWatchJsonPathRaw);

  const parsed = readJsonFile(elmWatchJsonPathRaw, ElmWatchJson);

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
        config: toConfig(elmWatchJsonPath, parsed.value),
      };
  }
}

function toConfig(
  elmWatchJsonPath: ElmWatchJsonPath,
  json: ElmWatchJson,
): Config {
  return {
    root: absoluteDirname(elmWatchJsonPath),
    source: { tag: "ElmWatchJson", elmWatchJsonPath },
    // The decoder validates that there’s at least one target.
    targets: Object.entries(json.targets).map(([name, target]) => ({
      name,
      inputs: target.inputs,
      output: target.output,
      postprocess: undefined,
    })) as NonEmptyArray<ConfigTarget>,
    postprocess: json.postprocess,
    port: json.port,
    webSocketUrl: json.webSocketUrl,
    staticFilesDir: json.serve,
    allowedHosts: json.allowedHosts ?? [],
  };
}

export function example(
  cwd: Cwd,
  elmWatchJsonPath: ElmWatchJsonPath,
  elmMakeParsed: ElmMakeParsed,
): string {
  const { elmFiles, output = "build/main.js" } = elmMakeParsed;

  const json: ElmWatchJson = {
    targets: {
      "My target name": {
        inputs: isNonEmptyArray(elmFiles)
          ? mapNonEmptyArray(elmFiles, (file) =>
              // Use slashes in all paths since they work everywhere (including
              // Windows), while backslashes only work on Windows.
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

  return Codec.JSON.stringify(ElmWatchJson, json, 4);
}

function toUnixPath(filePath: string): string {
  /* v8 ignore next -- @preserve */
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
