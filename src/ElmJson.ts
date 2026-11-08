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
    // Decoded separately (leniently) by `getTooOldPackages`.
    dependencies: Codec.field(Codec.unknown, { optional: true }),
  },
  {
    type: Codec.tag("package"),
  },
]);

export type ElmJsonType = ElmJson["type"];

const Dependencies = Codec.fields(
  {
    direct: Codec.record(Codec.string),
    indirect: Codec.record(Codec.string),
  },
  { allowExtraFields: true },
);

// elm-watch replaces some functions in the compiled JS (see Inject.ts). Those
// replacements rely on other functions that only exist in these versions and
// later. For example, elm/core before 1.0.3 lacks `_Platform_enqueueEffects`.
// All versions of elm/browser and elm/virtual-dom work.
const MINIMUM_PATCHED_PACKAGE_VERSIONS: Record<string, string> = {
  "elm/core": "1.0.3",
};

export type TooOldPackage = {
  name: string;
  version: string;
  minimumVersion: string;
};

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
      // Only for applications (packages use version ranges).
      tooOldPackages: Array<TooOldPackage>;
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

export type ElmJsonTooOldPackagesError = {
  tag: "ElmJsonTooOldPackages";
  elmJsonPath: ElmJsonPath;
  tooOldPackages: NonEmptyArray<TooOldPackage>;
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
        tooOldPackages: getTooOldPackages(parsed.value),
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

// Invalid "dependencies" are ignored here – `elm make` reports them nicely.
function getTooOldPackages(elmJson: ElmJson): Array<TooOldPackage> {
  if (elmJson.type === "package") {
    return [];
  }

  const decoded = Dependencies.decoder(elmJson.dependencies);
  if (decoded.tag === "DecoderError") {
    return [];
  }

  const { direct, indirect } = decoded.value;
  return Object.entries(MINIMUM_PATCHED_PACKAGE_VERSIONS).flatMap(
    ([name, minimumVersion]) => {
      const version = direct[name] ?? indirect[name];
      return version !== undefined && isOlderVersion(version, minimumVersion)
        ? [{ name, version, minimumVersion }]
        : [];
    },
  );
}

// Versions in application elm.json files are exact, like "1.0.5".
function isOlderVersion(version: string, other: string): boolean {
  const a = version.split(".").map(Number);
  const b = other.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) {
      return x < y;
    }
  }
  return false;
}
