import * as Codec from "tiny-decoders";

export type Brand<T extends string, Name extends string> = T & {
  readonly [_ in Name]: never;
};

function brand<T extends string>(): Codec.Codec<T, string> {
  // @ts-expect-error This works and does what I want, but doesn’t type check for some reason.
  return Codec.string;
}

export type AbsolutePath = Brand<string, "AbsolutePath">;
export const AbsolutePath = brand<AbsolutePath>();
export function markAsAbsolutePath(string: string): AbsolutePath {
  return string as AbsolutePath;
}

export type Cwd = Brand<AbsolutePath, "Cwd">;
export function markAsCwd(absolutePath: AbsolutePath): Cwd {
  return absolutePath as Cwd;
}

export type RunMode = "hot" | "make";

export type CompilationMode = Codec.Infer<typeof CompilationMode>;
export const CompilationMode = Codec.primitiveUnion([
  "debug",
  "standard",
  "optimize",
]);

export type CompilationModeWithProxy = CompilationMode | "proxy";

export type BrowserUiPosition = Codec.Infer<typeof BrowserUiPosition>;
export const BrowserUiPosition = Codec.primitiveUnion([
  "TopLeft",
  "TopRight",
  "BottomLeft",
  "BottomRight",
]);

// elm-watch.json
export type ElmWatchJsonPath = Brand<AbsolutePath, "ElmWatchJsonPath">;
export function markAsElmWatchJsonPath(
  absolutePath: AbsolutePath,
): ElmWatchJsonPath {
  return absolutePath as ElmWatchJsonPath;
}

// elm.json
export type ElmJsonPath = Brand<AbsolutePath, "ElmJsonPath">;
export function markAsElmJsonPath(absolutePath: AbsolutePath): ElmJsonPath {
  return absolutePath as ElmJsonPath;
}

// elm-stuff/elm-watch/
export type ElmWatchStuffDir = Brand<AbsolutePath, "ElmWatchStuffDir">;
export function markAsElmWatchStuffDir(
  absolutePath: AbsolutePath,
): ElmWatchStuffDir {
  return absolutePath as ElmWatchStuffDir;
}

// elm-stuff/elm-watch/stuff.json
export type ElmWatchStuffJsonPath = Brand<
  AbsolutePath,
  "ElmWatchStuffJsonPath"
>;
export function markAsElmWatchStuffJsonPath(
  absolutePath: AbsolutePath,
): ElmWatchStuffJsonPath {
  return absolutePath as ElmWatchStuffJsonPath;
}

// applications: "source-directories": [...]
// packages: src
export type SourceDirectory = Brand<AbsolutePath, "SourceDirectory">;
export function markAsSourceDirectory(
  absolutePath: AbsolutePath,
): SourceDirectory {
  return absolutePath as SourceDirectory;
}

// src/Main.elm
export type InputPath = {
  tag: "InputPath";
  theInputPath: AbsolutePath;
  originalString: string;
  // The Elm compiler even resolves symlinks when looking for duplicate inputs.
  realpath: AbsolutePath;
};

// src/Main.elm, but unchecked
export type UncheckedInputPath = {
  tag: "UncheckedInputPath";
  theUncheckedInputPath: AbsolutePath;
  originalString: string;
};

// build/main.js
export type OutputPath = {
  tag: "OutputPath";
  theOutputPath: AbsolutePath;
  temporaryOutputPath: AbsolutePath;
  originalString: string;
  targetName: TargetName;
};

// "targets": {
//   "My Target Name": {}
//    ^^^^^^^^^^^^^^
// }
export type TargetName = Brand<string, "TargetName">;
export const TargetName = brand<TargetName>();
export function markAsTargetName(string: string): TargetName {
  return string as TargetName;
}

// "postprocess": ["elm-watch-node", "postprocess.js"]
//                                    ^^^^^^^^^^^^^^
// This is a `string` rather than a `URL` to avoid worker serialization stuff.
export type ElmWatchNodeScriptPath = Brand<string, "ElmWatchNodeScriptPath">;
export function markAsElmWatchNodeScriptPath(
  string: string,
): ElmWatchNodeScriptPath {
  return string as ElmWatchNodeScriptPath;
}

export type CliArg = Brand<string, "CliArg">;
export function markAsCliArg(string: string): CliArg {
  return string as CliArg;
}

export type WriteOutputErrorReasonForWriting =
  | "InjectWebSocketClient"
  | "Postprocess";

export type GetNow = () => Date;

export function equalsInputPath(
  elmFile: AbsolutePath,
  inputPath: InputPath,
): boolean {
  return inputPath.theInputPath === elmFile || inputPath.realpath === elmFile;
}
