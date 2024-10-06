import * as Codec from "tiny-decoders";

import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import {
  absoluteDirname,
  absolutePathFromString,
  readJsonFile,
} from "./PathHelpers";
import { ElmJsonPath, markAsSourceDirectory, SourceDirectory } from "./Types";

export type ElmJson = Codec.Infer<typeof ElmJson>;
export const ElmJson = Codec.taggedUnion("type", [
  {
    type: Codec.tag("application"),
    "source-directories": NonEmptyArray(Codec.string),
  },
  {
    type: Codec.tag("package"),
  },
]);

type ParseResult =
  | ParseError
  | {
      tag: "Parsed";
      sourceDirectories: NonEmptyArray<SourceDirectory>;
    };

export type ParseError =
  | {
      tag: "ElmJsonDecodeError";
      elmJsonPath: ElmJsonPath;
      error: Codec.DecoderError;
    }
  | {
      tag: "ElmJsonReadError";
      elmJsonPath: ElmJsonPath;
      error: Error;
    };

export function readSourceDirectories(elmJsonPath: ElmJsonPath): ParseResult {
  const parsed = readJsonFile(elmJsonPath, ElmJson);
  switch (parsed.tag) {
    case "DecoderError":
      return {
        tag: "ElmJsonDecodeError",
        elmJsonPath,
        error: parsed.error,
      };
    case "ReadError":
      return {
        tag: "ElmJsonReadError",
        elmJsonPath,
        error: parsed.error,
      };
    case "Valid":
      return {
        tag: "Parsed",
        sourceDirectories: getSourceDirectories(elmJsonPath, parsed.value),
      };
  }
}

function getSourceDirectories(
  elmJsonPath: ElmJsonPath,
  elmJson: ElmJson,
): NonEmptyArray<SourceDirectory> {
  const base = absoluteDirname(elmJsonPath);

  switch (elmJson.type) {
    case "application":
      return mapNonEmptyArray(elmJson["source-directories"], (dir) =>
        markAsSourceDirectory(absolutePathFromString(base, dir)),
      );

    case "package":
      return [markAsSourceDirectory(absolutePathFromString(base, "src"))];
  }
}
