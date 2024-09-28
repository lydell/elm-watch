import * as fs from "fs";
import * as Decode from "tiny-decoders";

import { JsonError, toError, toJsonError } from "./Helpers";
import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { absoluteDirname, absolutePathFromString } from "./PathHelpers";
import { ElmJsonPath, SourceDirectory } from "./Types";

export type ElmJson = ReturnType<typeof ElmJson>;
export const ElmJson = Decode.fieldsUnion("type", {
  application: Decode.fieldsAuto({
    tag: () => "Application" as const,
    "source-directories": NonEmptyArray(Decode.string),
  }),
  package: () => ({
    tag: "Package" as const,
  }),
});

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
      fs.readFileSync(elmJsonPath.theElmJsonPath.absolutePath, "utf-8"),
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
      elmJson: ElmJson(json),
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
  elmJson: ElmJson,
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
