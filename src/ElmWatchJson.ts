import * as path from "path";

import * as Codec from "./Codec";
import { IS_WINDOWS } from "./IsWindows";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { findClosest, readJsonFile } from "./PathHelpers";
import { Port } from "./Port";
import type { CliArg, Cwd, ElmWatchJsonPath } from "./Types";

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

type Target = Codec.Infer<typeof Target>;
const Target = Codec.fields(
  {
    inputs: NonEmptyArray(
      Codec.chain(Codec.string, {
        decoder(string) {
          if (isValidInputName(string)) {
            return string;
          }
          throw new Codec.DecoderError({
            message: "Inputs must have a valid module name and end with .elm",
            value: string,
          });
        },
        encoder: (value) => value,
      })
    ),
    output: Codec.chain(Codec.string, {
      decoder(output) {
        if (isValidOutputName(output)) {
          return output;
        }
        throw new Codec.DecoderError({
          message: "Outputs must end with .js",
          value: Codec.DecoderError.MISSING_VALUE,
        });
      },
      encoder: (value) => value,
    }),
  },
  { exact: "throw" }
);

const TargetRecordHelper = {
  decoder(record: Record<string, Target>): Record<string, Target> {
    const entries = Object.entries(record);
    if (!isNonEmptyArray(entries)) {
      throw new Codec.DecoderError({
        message: "Expected a non-empty object",
        value: record,
      });
    }
    return Object.fromEntries(
      entries.map(([key, value]) => {
        if (isValidTargetName(key)) {
          return [key, value];
        }
        throw new Codec.DecoderError({
          message:
            "Target names must start with a non-whitespace character except `-`,\ncannot contain newlines and must end with a non-whitespace character",
          value: Codec.DecoderError.MISSING_VALUE,
          key,
        });
      })
    );
  },
  encoder: (value: Record<string, Target>) => value,
};

export type Config = Codec.Infer<typeof Config>;
const Config = Codec.fields(
  {
    targets: Codec.chain(Codec.record(Target), TargetRecordHelper),
    postprocess: Codec.optional(NonEmptyArray(Codec.string)),
    port: Codec.optional(Port),
  },
  { exact: "throw" }
);

type ParseResult =
  | {
      tag: "DecodeError";
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
  const elmWatchJsonPathRaw = findClosest("elm-watch.json", cwd.path);
  if (elmWatchJsonPathRaw === undefined) {
    return {
      tag: "ElmWatchJsonNotFound",
    };
  }

  const elmWatchJsonPath: ElmWatchJsonPath = {
    tag: "ElmWatchJsonPath",
    theElmWatchJsonPath: elmWatchJsonPathRaw,
  };

  const parsed = readJsonFile(elmWatchJsonPathRaw, Config);
  return parsed instanceof Codec.DecoderError
    ? {
        tag: "DecodeError",
        elmWatchJsonPath,
        error: parsed,
      }
    : parsed instanceof Error
    ? {
        tag: "ReadError",
        elmWatchJsonPath,
        error: parsed,
      }
    : {
        tag: "Parsed",
        elmWatchJsonPath,
        config: parsed,
      };
}

export function example(
  cwd: Cwd,
  elmWatchJsonPath: ElmWatchJsonPath,
  elmMakeParsed: ElmMakeParsed
): string {
  const { elmFiles, output = "build/main.js" } = elmMakeParsed;

  const json: Config = {
    targets: {
      "My target name": {
        inputs: isNonEmptyArray(elmFiles)
          ? mapNonEmptyArray(elmFiles, (file) =>
              // Use slashes in all paths since they work everywhere (including
              // Windows), while backslashes only work on Windows.
              toUnixPath(
                path.relative(
                  path.dirname(
                    elmWatchJsonPath.theElmWatchJsonPath.absolutePath
                  ),
                  path.resolve(cwd.path.absolutePath, file)
                )
              )
            )
          : ["src/Main.elm"],
        output,
      },
    },
  };

  return Codec.stringify(Config, json, 4);
}

function toUnixPath(filePath: string): string {
  return IS_WINDOWS
    ? /* istanbul ignore next */ filePath.split(path.sep).join(path.posix.sep)
    : filePath;
}

type ElmMakeParsed = {
  elmFiles: Array<string>;
  output: string | undefined;
};

type IntermediaElmMakeParsed = ElmMakeParsed & { justSawOutputFlag: boolean };

export function parseArgsLikeElmMake(args: Array<CliArg>): ElmMakeParsed {
  return args.reduce<IntermediaElmMakeParsed>(
    (passedParsed, { theArg: arg }): IntermediaElmMakeParsed => {
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
    }
  );
}
