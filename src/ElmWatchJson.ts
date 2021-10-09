import * as fs from "fs";
import * as path from "path";
import * as Decode from "tiny-decoders";

import { JsonError, toError, toJsonError } from "./Helpers";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { Cwd, findClosest } from "./PathHelpers";
import { Port } from "./Port";
import type { CliArg, ElmWatchJsonPath } from "./Types";

// First char uppercase: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L263-L267
// Rest: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L328-L335
// https://hackage.haskell.org/package/base-4.14.0.0/docs/Data-Char.html#v:isLetter
const INPUT_NAME = /(^|[/\\])\p{Lu}[_\d\p{L}]*\.elm$/u;

export function isValidInputName(name: string): boolean {
  return INPUT_NAME.test(name);
}

export function isValidOutputName(name: string): boolean {
  // `elm make` doesn’t accept just `.js` but `a.js` and `a/.js`.
  // Disallow stuff starting with `-` so output CLI args don’t look like flags.
  return (
    (!name.startsWith("-") && name.endsWith(".js") && name !== ".js") ||
    name === "/dev/null"
  );
}

type Output = ReturnType<typeof Output>;
const Output = Decode.fieldsAuto(
  {
    inputs: NonEmptyArray(
      Decode.chain(Decode.string, (string) => {
        if (isValidInputName(string)) {
          return string;
        }
        throw new Decode.DecoderError({
          message: "Inputs must have a valid module name and end with .elm",
          value: string,
        });
      })
    ),
    postprocess: Decode.optional(NonEmptyArray(Decode.string)),
  },
  { exact: "throw" }
);

function outputRecordHelper(
  record: Record<string, Output>
): Record<string, Output> {
  const entries = Object.entries(record);
  if (!isNonEmptyArray(entries)) {
    throw new Decode.DecoderError({
      message: "Expected a non-empty object",
      value: record,
    });
  }
  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (isValidOutputName(key)) {
        return [key, value];
      }
      throw new Decode.DecoderError({
        message: "Outputs must end with .js or be /dev/null",
        value: Decode.DecoderError.MISSING_VALUE,
        key,
      });
    })
  );
}

export type Config = ReturnType<typeof Config>;
const Config = Decode.fieldsAuto(
  {
    outputs: Decode.chain(Decode.record(Output), outputRecordHelper),
    port: Decode.optional(Port),
  },
  { exact: "throw" }
);

export type ElmWatchJson = ReturnType<typeof ElmWatchJson>;
const ElmWatchJson = Decode.fieldsAuto({
  "x-elm-watch": Config,
});

export type ParseResult =
  | {
      tag: "DecodeError";
      elmWatchJsonPath: ElmWatchJsonPath;
      error: JsonError;
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
      tag: "ReadAsJsonError";
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

  let json: unknown = undefined;
  try {
    json = JSON.parse(
      fs.readFileSync(elmWatchJsonPathRaw.absolutePath, "utf-8")
    );
  } catch (unknownError) {
    const error = toError(unknownError);
    return {
      tag: "ReadAsJsonError",
      elmWatchJsonPath,
      error,
    };
  }

  try {
    return {
      tag: "Parsed",
      elmWatchJsonPath,
      config: ElmWatchJson(json)["x-elm-watch"],
    };
  } catch (unknownError) {
    const error = toJsonError(unknownError);
    return {
      tag: "DecodeError",
      elmWatchJsonPath,
      error,
    };
  }
}

export function example(
  cwd: Cwd,
  elmWatchJsonPath: ElmWatchJsonPath,
  args: Array<CliArg>
): string {
  const { elmFiles, output = "build/main.js" } = parseArgsLikeElmMake(args);

  const json: ElmWatchJson = {
    "x-elm-watch": {
      outputs: {
        [output]: {
          inputs: isNonEmptyArray(elmFiles)
            ? mapNonEmptyArray(elmFiles, (file) =>
                path.relative(
                  path.dirname(
                    elmWatchJsonPath.theElmWatchJsonPath.absolutePath
                  ),
                  path.resolve(cwd.path.absolutePath, file)
                )
              )
            : ["src/Main.elm"],
        },
      },
    },
  };

  return JSON.stringify(json, null, 4);
}

type ElmMakeParsed = {
  elmFiles: Array<string>;
  output: string | undefined;
};

type IntermediaElmMakeParsed = ElmMakeParsed & { justSawOutputFlag: boolean };

function parseArgsLikeElmMake(args: Array<CliArg>): ElmMakeParsed {
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
