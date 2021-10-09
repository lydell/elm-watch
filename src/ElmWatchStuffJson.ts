import * as fs from "fs";
import * as Decode from "tiny-decoders";

import { JsonError, toError, toJsonError } from "./Helpers";
import { absoluteDirname, absolutePathFromString } from "./PathHelpers";
import { Port } from "./Port";
import { ElmToolingJsonPath, ElmWatchStuffJsonPath } from "./Types";

// elm-stuff/elm-watch-stuff.json stores things between runs.
// Configuration is stored in elm-tooling.json.
// There’s likely an elm-stuff/ folder next to elm-tooling.json (but all
// elm.json could be at other levels and as such all elm-stuff folders too).
// Either way, it’s a good bet and people probably have `elm-stuff` in their
// .gitignore anyway.

const CompilationMode = Decode.stringUnion({
  debug: null,
  optimize: null,
});

const Output = Decode.fieldsAuto({
  compilationMode: CompilationMode,
});

export type ElmWatchStuffJson = ReturnType<typeof ElmWatchStuffJson>;
export const ElmWatchStuffJson = Decode.fieldsAuto({
  port: Port,
  outputs: Decode.record(Output),
});

export type ElmWatchStuffJsonWritable = Omit<ElmWatchStuffJson, "port"> & {
  port: number;
};

export function getPath(
  elmToolingJsonPath: ElmToolingJsonPath
): ElmWatchStuffJsonPath {
  const elmStuff = absolutePathFromString(
    absoluteDirname(elmToolingJsonPath.theElmToolingJsonPath),
    "elm-stuff"
  );

  return {
    tag: "ElmWatchStuffJsonPath",
    theElmWatchStuffJsonPath: absolutePathFromString(
      elmStuff,
      "elm-watch-stuff.json"
    ),
  };
}

export type ParseResult =
  | ParseError
  | {
      tag: "NoElmWatchStuffJson";
      elmWatchStuffJsonPath: ElmWatchStuffJsonPath;
    }
  | {
      tag: "Parsed";
      elmWatchStuffJsonPath: ElmWatchStuffJsonPath;
      elmWatchStuffJson: ElmWatchStuffJson;
    };

export type ParseError =
  | {
      tag: "ElmWatchStuffJsonDecodeError";
      error: JsonError;
    }
  | {
      tag: "ElmWatchStuffJsonReadAsJsonError";
      error: Error;
    };

export function readAndParse(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath
): ParseResult {
  let json: unknown = undefined;
  try {
    json = JSON.parse(
      fs.readFileSync(
        elmWatchStuffJsonPath.theElmWatchStuffJsonPath.absolutePath,
        "utf-8"
      )
    );
  } catch (unknownError) {
    const error = toError(unknownError);
    return error.code === "ENOENT"
      ? {
          tag: "NoElmWatchStuffJson",
          elmWatchStuffJsonPath,
        }
      : {
          tag: "ElmWatchStuffJsonReadAsJsonError",
          error,
        };
  }

  try {
    return {
      tag: "Parsed",
      elmWatchStuffJsonPath,
      elmWatchStuffJson: ElmWatchStuffJson(json),
    };
  } catch (unknownError) {
    const error = toJsonError(unknownError);
    return {
      tag: "ElmWatchStuffJsonDecodeError",
      error,
    };
  }
}
