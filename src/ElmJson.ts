import * as fs from "fs";
import * as Decode from "tiny-decoders";

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

export type ParseResult =
  | ParseError
  | {
      tag: "Parsed";
      elmJson: ElmJson;
    };

export type ParseError =
  | {
      tag: "ElmJsonDecodeError";
      elmJsonPath: ElmJsonPath;
      error: Decode.DecoderError;
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
  } catch (errorAny) {
    const error = errorAny as Error;
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
  } catch (errorAny) {
    const error = errorAny as Decode.DecoderError;
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
