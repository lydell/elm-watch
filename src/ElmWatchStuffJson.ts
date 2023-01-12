import * as fs from "fs";

import * as Codec from "./Codec";
import { JsonError, toError, toJsonError } from "./Helpers";
import { Port } from "./Port";
import {
  BrowserUiPosition,
  CompilationMode,
  ElmWatchStuffJsonPath,
} from "./Types";

// elm-stuff/elm-watch/stuff.json stores things between runs.
// Configuration is stored in elm-watch.json.
// There’s likely an elm-stuff/ folder next to elm-watch.json (but all
// elm.json could be at other levels and as such all elm-stuff folders too).
// Either way, it’s a good bet and people probably have `elm-stuff` in their
// .gitignore anyway.

export type Target = Codec.Infer<typeof Target>;
const Target = Codec.fields({
  compilationMode: Codec.optional(CompilationMode),
  browserUiPosition: Codec.optional(BrowserUiPosition),
  openErrorOverlay: Codec.optional(Codec.boolean),
});

export type ElmWatchStuffJson = Codec.Infer<typeof ElmWatchStuffJson>;
export const ElmWatchStuffJson = Codec.fields({
  port: Port,
  targets: Codec.record(Target),
});

type ParseResult =
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

type ParseError =
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
      elmWatchStuffJson: ElmWatchStuffJson.decoder(json),
    };
  } catch (unknownError) {
    const error = toJsonError(unknownError);
    return {
      tag: "ElmWatchStuffJsonDecodeError",
      error,
    };
  }
}
