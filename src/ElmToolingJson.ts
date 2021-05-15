import * as fs from "fs";
import * as path from "path";
import * as Decode from "tiny-decoders";

import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { Cwd, findClosest } from "./path-helpers";
import type { CliArg, ElmToolingJsonPath } from "./types";

// First char uppercase: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L263-L267
// Rest: https://github.com/elm/compiler/blob/2860c2e5306cb7093ba28ac7624e8f9eb8cbc867/compiler/src/Parse/Variable.hs#L328-L335
// https://hackage.haskell.org/package/base-4.14.0.0/docs/Data-Char.html#v:isLetter
const INPUT_NAME = /(^|[/\\])\p{Lu}[_\d\p{L}]*\.elm$/u;

export function isValidInputName(name: string): boolean {
  return INPUT_NAME.test(name);
}

export function isValidOutputName(name: string): boolean {
  // `elm make` doesn’t accept just `.js` but `a.js` and `a/.js`.
  return (name.endsWith(".js") && name !== ".js") || name === "/dev/null";
}

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
  },
  { exact: "throw" }
);

export type Config = ReturnType<typeof Config>;
const Config = Decode.fieldsAuto({
  outputs: Decode.chain(Decode.record(Output), (record) => {
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
  }),
});

export type ElmToolingJson = ReturnType<typeof ElmToolingJson>;
const ElmToolingJson = Decode.fieldsAuto({
  "x-elm-watch": Config,
});

export type ParseResult =
  | {
      tag: "DecodeError";
      elmToolingJsonPath: ElmToolingJsonPath;
      error: Decode.DecoderError;
    }
  | {
      tag: "ElmToolingJsonNotFound";
    }
  | {
      tag: "Parsed";
      elmToolingJsonPath: ElmToolingJsonPath;
      config: Config;
    }
  | {
      tag: "ReadAsJsonError";
      elmToolingJsonPath: ElmToolingJsonPath;
      error: Error;
    };

export function findReadAndParse(cwd: Cwd): ParseResult {
  const elmToolingJsonPathRaw = findClosest("elm-tooling.json", cwd.path);
  if (elmToolingJsonPathRaw === undefined) {
    return {
      tag: "ElmToolingJsonNotFound",
    };
  }

  const elmToolingJsonPath: ElmToolingJsonPath = {
    tag: "ElmToolingJsonPath",
    theElmToolingJsonPath: elmToolingJsonPathRaw,
  };

  let json: unknown = undefined;
  try {
    json = JSON.parse(
      fs.readFileSync(elmToolingJsonPathRaw.absolutePath, "utf-8")
    );
  } catch (errorAny) {
    const error = errorAny as Error;
    return {
      tag: "ReadAsJsonError",
      elmToolingJsonPath,
      error,
    };
  }

  try {
    return {
      tag: "Parsed",
      elmToolingJsonPath,
      config: ElmToolingJson(json)["x-elm-watch"],
    };
  } catch (errorAny) {
    const error = errorAny as Decode.DecoderError;
    return {
      tag: "DecodeError",
      elmToolingJsonPath,
      error,
    };
  }
}
export function example(
  cwd: Cwd,
  elmToolingJsonPath: ElmToolingJsonPath,
  args: Array<CliArg>
): string {
  const { elmFiles, output = "build/main.js" } = parseArgsLikeElmMake(args);

  const json: ElmToolingJson = {
    "x-elm-watch": {
      outputs: {
        [output]: {
          inputs: isNonEmptyArray(elmFiles)
            ? mapNonEmptyArray(elmFiles, (file) =>
                path.relative(
                  path.dirname(
                    elmToolingJsonPath.theElmToolingJsonPath.absolutePath
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
