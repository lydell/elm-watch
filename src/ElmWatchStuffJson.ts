import * as Codec from "tiny-decoders";

import { readJsonFile } from "./PathHelpers.ts";
import { Port } from "./Port.ts";
import {
  CompilationMode,
  type ElmWatchStuffJsonPath,
  WebSocketToken,
} from "./Types.ts";

// elm-stuff/elm-watch/stuff.json stores things between runs.
// Configuration is stored in elm-watch.json.
// There’s likely an elm-stuff/ folder next to elm-watch.json (but all
// elm.json could be at other levels and as such all elm-stuff folders too).
// Either way, it’s a good bet and people probably have `elm-stuff` in their
// .gitignore anyway.

export type Target = Codec.Infer<typeof Target>;
const Target = Codec.fields({
  compilationMode: Codec.field(CompilationMode, { optional: true }),
});

export type ElmWatchStuffJson = Codec.Infer<typeof ElmWatchStuffJson>;
export const ElmWatchStuffJson = Codec.fields({
  // Missing if elm-watch has only been run with a port from config.
  port: Codec.field(Port, { optional: true }),
  webSocketToken: Codec.field(WebSocketToken, { optional: true }),
  // The editor chosen in the browser UI or the terminal: A preset ID (see
  // `Editor.ts`). Not validated here, so that an unknown editor (from another
  // elm-watch version, for example) is just ignored.
  editor: Codec.field(Codec.string, { optional: true }),
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
      error: Codec.DecoderError;
    }
  | {
      tag: "ElmWatchStuffJsonReadError";
      errors: Error;
    };

export function readAndParse(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath,
): ParseResult {
  const parsed = readJsonFile(elmWatchStuffJsonPath, ElmWatchStuffJson);
  switch (parsed.tag) {
    case "DecoderError":
      return {
        tag: "ElmWatchStuffJsonDecodeError",
        error: parsed.error,
      };
    case "ReadError":
      return parsed.error.code === "ENOENT"
        ? {
            tag: "NoElmWatchStuffJson",
            elmWatchStuffJsonPath,
          }
        : {
            tag: "ElmWatchStuffJsonReadError",
            errors: parsed.error,
          };
    case "Valid":
      return {
        tag: "Parsed",
        elmWatchStuffJsonPath,
        elmWatchStuffJson: parsed.value,
      };
  }
}
