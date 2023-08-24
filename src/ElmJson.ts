import * as Codec from "./Codec";
import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import {
  absoluteDirname,
  absolutePathFromString,
  readJsonFile,
} from "./PathHelpers";
import { ElmJsonPath, SourceDirectory } from "./Types";

export type ElmJson = Codec.Infer<typeof ElmJson>;
export const ElmJson = Codec.fieldsUnion("tag", [
  {
    tag: Codec.field("type", Codec.tag("Application", "application")),
    "source-directories": NonEmptyArray(Codec.string),
  },
  {
    tag: Codec.field("type", Codec.tag("Package", "package")),
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
      errors: NonEmptyArray<Codec.DecoderError>;
    }
  | {
      tag: "ElmJsonReadError";
      elmJsonPath: ElmJsonPath;
      error: Error;
    };

export function readAndParse(elmJsonPath: ElmJsonPath): ParseResult {
  const parsed = readJsonFile(elmJsonPath.theElmJsonPath, ElmJson);
  switch (parsed.tag) {
    case "DecodeError":
      return {
        tag: "ElmJsonDecodeError",
        elmJsonPath,
        errors: parsed.errors,
      };
    case "ReadError":
      return {
        tag: "ElmJsonReadError",
        elmJsonPath,
        error: parsed.error,
      };
    case "Success":
      return {
        tag: "Parsed",
        elmJson: parsed.value,
      };
  }
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
