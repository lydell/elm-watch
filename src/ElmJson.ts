import * as fs from "fs";

import * as Codec from "./Codec";
import { JsonError, toError, toJsonError } from "./Helpers";
import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { absoluteDirname, absolutePathFromString } from "./PathHelpers";
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
      error: JsonError;
    }
  | {
      tag: "ElmJsonReadAsJsonError";
      elmJsonPath: ElmJsonPath;
      error: Error;
    };

export function readAndParse(elmJsonPath: ElmJsonPath): ParseResult {
  let json: unknown = undefined;
  try {
    json = JSON.parse(
      fs.readFileSync(elmJsonPath.theElmJsonPath.absolutePath, "utf-8")
    );
  } catch (unknownError) {
    const error = toError(unknownError);
    return {
      tag: "ElmJsonReadAsJsonError",
      elmJsonPath,
      error,
    };
  }

  try {
    return {
      tag: "Parsed",
      elmJson: ElmJson.decoder(json),
    };
  } catch (unknownError) {
    const error = toJsonError(unknownError);
    return {
      tag: "ElmJsonDecodeError",
      elmJsonPath,
      error,
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
