import * as Codec from "tiny-decoders";

import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import {
  absoluteDirname,
  absolutePathFromString,
  readJsonFile,
} from "./PathHelpers";
import { ElmJsonPath, markAsSourceDirectory, SourceDirectory } from "./Types";

export type ElmJson = Codec.Infer<typeof ElmJson>;
export const ElmJson = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("Application", {
      renameTagFrom: "application",
      renameFieldFrom: "type",
    }),
    "source-directories": NonEmptyArray(Codec.string),
  },
  {
    tag: Codec.tag("Package", {
      renameTagFrom: "package",
      renameFieldFrom: "type",
    }),
  },
]);

type ParseResult =
  | ParseError
  | {
      tag: "Parsed";
      elmJson: ElmJson;
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

export function readAndParse(elmJsonPath: ElmJsonPath): ParseResult {
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
        elmJson: parsed.value,
      };
  }
}

export function getSourceDirectories(
  elmJsonPath: ElmJsonPath,
  elmJson: ElmJson,
): NonEmptyArray<SourceDirectory> {
  const base = absoluteDirname(elmJsonPath);

  switch (elmJson.tag) {
    case "Application":
      return mapNonEmptyArray(elmJson["source-directories"], (dir) =>
        markAsSourceDirectory(absolutePathFromString(base, dir)),
      );

    case "Package":
      return [markAsSourceDirectory(absolutePathFromString(base, "src"))];
  }
}
