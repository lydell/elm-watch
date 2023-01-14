import * as Codec from "./Codec";
import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import {
  absoluteDirname,
  absolutePathFromString,
  readJsonFile,
} from "./PathHelpers";
import { ElmJsonPath, SourceDirectory } from "./Types";

export type ElmJson = Codec.Infer<typeof ElmJson>;
export const ElmJson = Codec.fieldsUnion("type", (tag) => [
  {
    tag: tag("Application", "application"),
    "source-directories": NonEmptyArray(Codec.string),
  },
  {
    tag: tag("Package", "package"),
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
  const parsed = readJsonFile(elmJsonPath.theElmJsonPath, ElmJson);
  return parsed instanceof Codec.DecoderError
    ? {
        tag: "ElmJsonDecodeError",
        elmJsonPath,
        error: parsed,
      }
    : parsed instanceof Error
    ? {
        tag: "ElmJsonReadError",
        elmJsonPath,
        error: parsed,
      }
    : {
        tag: "Parsed",
        elmJson: parsed,
      };
}

export function getSourceDirectories(
  elmJsonPath: ElmJsonPath,
  elmJson: ElmJson
): NonEmptyArray<SourceDirectory> {
  const base = absoluteDirname(elmJsonPath.theElmJsonPath);

  switch (elmJson.tag) {
    case "Application":
      return mapNonEmptyArray(elmJson["source-directories"], (dir) => ({
        tag: "SourceDirectory",
        theSourceDirectory: absolutePathFromString(base, dir),
      }));

    case "Package":
      return [
        {
          tag: "SourceDirectory",
          theSourceDirectory: absolutePathFromString(base, "src"),
        },
      ];
  }
}
