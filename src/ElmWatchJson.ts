import * as fs from "fs";
import * as Decode from "tiny-decoders";

import { absoluteDirname, absolutePathFromString } from "./PathHelpers";
import { Port } from "./Port";
import { ElmToolingJsonPath, ElmWatchJsonPath } from "./Types";

// elm-stuff/elm-watch.json stores things between runs.
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

export type ElmWatchJson = ReturnType<typeof ElmWatchJson>;
export const ElmWatchJson = Decode.fieldsAuto({
  port: Port,
  outputs: Decode.record(Output),
});

export type ParseResult =
  | ParseError
  | {
      tag: "NoElmWatchJson";
      elmWatchJsonPath: ElmWatchJsonPath;
    }
  | {
      tag: "Parsed";
      elmWatchJsonPath: ElmWatchJsonPath;
      elmWatchJson: ElmWatchJson;
    };

export type ParseError =
  | {
      tag: "ElmWatchJsonDecodeError";
      elmWatchJsonPath: ElmWatchJsonPath;
      error: Decode.DecoderError;
    }
  | {
      tag: "ElmWatchJsonReadAsJsonError";
      elmWatchJsonPath: ElmWatchJsonPath;
      error: Error;
    };

export function readAndParse(
  elmToolingJsonPath: ElmToolingJsonPath
): ParseResult {
  const elmStuff = absolutePathFromString(
    absoluteDirname(elmToolingJsonPath.theElmToolingJsonPath),
    "elm-stuff"
  );

  const elmWatchJsonPath: ElmWatchJsonPath = {
    tag: "ElmWatchJsonPath",
    theElmWatchJsonPath: absolutePathFromString(elmStuff, "elm-watch.json"),
  };

  let json: unknown = undefined;
  try {
    json = JSON.parse(
      fs.readFileSync(
        elmWatchJsonPath.theElmWatchJsonPath.absolutePath,
        "utf-8"
      )
    );
  } catch (errorAny) {
    const error = errorAny as Error & { code?: string };
    return error.code === "ENOENT"
      ? {
          tag: "NoElmWatchJson",
          elmWatchJsonPath,
        }
      : {
          tag: "ElmWatchJsonReadAsJsonError",
          elmWatchJsonPath,
          error,
        };
  }

  try {
    return {
      tag: "Parsed",
      elmWatchJsonPath,
      elmWatchJson: ElmWatchJson(json),
    };
  } catch (errorAny) {
    const error = errorAny as Decode.DecoderError;
    return {
      tag: "ElmWatchJsonDecodeError",
      elmWatchJsonPath,
      error,
    };
  }
}
