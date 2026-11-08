import * as Codec from "tiny-decoders";

import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray.ts";
import {
  absoluteDirname,
  absolutePathFromString,
  readJsonFile,
} from "./PathHelpers.ts";
import {
  type ElmJsonPath,
  markAsSourceDirectory,
  type SourceDirectory,
} from "./Types.ts";

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

export type ElmJsonType = ElmJson["type"];

// Only looks at "type", so that we can tell it even if other fields are invalid.
const ElmJsonTypeOnly = Codec.fields(
  { type: Codec.primitiveUnion(["application", "package"]) },
  { allowExtraFields: true },
);

export type ReadElmJsonTypeResult =
  | { tag: "NotFound" }
  // Unreadable or invalid. We let Elm report that, since it has nice errors.
  | { tag: "Unknown" }
  | { tag: "Found"; type: ElmJsonType };

export function readElmJsonType(
  elmJsonPath: ElmJsonPath,
): ReadElmJsonTypeResult {
  const parsed = readJsonFile(elmJsonPath, ElmJsonTypeOnly);
  switch (parsed.tag) {
    case "ReadError":
      return parsed.error.code === "ENOENT" || parsed.error.code === "ENOTDIR"
        ? { tag: "NotFound" }
        : { tag: "Unknown" };
    case "DecoderError":
      return { tag: "Unknown" };
    case "Valid":
      return { tag: "Found", type: parsed.value.type };
  }
}

type ElmJsonParseResult =
  | ElmJsonParseError
  | {
      tag: "Parsed";
      sourceDirectories: NonEmptyArray<SourceDirectory>;
    };

export type ElmJsonParseError =
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

export function readSourceDirectories(
  elmJsonPath: ElmJsonPath,
): ElmJsonParseResult {
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
