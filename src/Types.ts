import * as Codec from "tiny-decoders";

export type AbsolutePath = Codec.Infer<typeof AbsolutePath>;
export const AbsolutePath = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("AbsolutePath"),
    absolutePath: Codec.string,
  },
]);

export type Cwd = { tag: "Cwd"; path: AbsolutePath };

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
export type ElmWatchJsonPath = {
  tag: "ElmWatchJsonPath";
  theElmWatchJsonPath: AbsolutePath;
};

// elm.json
export type ElmJsonPath = {
  tag: "ElmJsonPath";
  theElmJsonPath: AbsolutePath;
};

// elm-stuff/elm-watch/
export type ElmWatchStuffDir = {
  tag: "ElmWatchStuffDir";
  theElmWatchStuffDir: AbsolutePath;
};

// elm-stuff/elm-watch/stuff.json
export type ElmWatchStuffJsonPath = {
  tag: "ElmWatchStuffJsonPath";
  theElmWatchStuffJsonPath: AbsolutePath;
};

// applications: "source-directories": [...]
// packages: src
export type SourceDirectory = {
  tag: "SourceDirectory";
  theSourceDirectory: AbsolutePath;
};

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
  targetName: string;
};

// "postprocess": ["elm-watch-node", "postprocess.js"]
//                                    ^^^^^^^^^^^^^^
export type ElmWatchNodeScriptPath = {
  tag: "ElmWatchNodeScriptPath";
  // This is a `string` rather than a `URL` to avoid worker serialization stuff.
  theElmWatchNodeScriptFileUrl: string;
};

export type CliArg = {
  tag: "CliArg";
  theArg: string;
};

export type WriteOutputErrorReasonForWriting =
  | "InjectWebSocketClient"
  | "Postprocess";

export type GetNow = () => Date;

export function equalsInputPath(
  elmFile: AbsolutePath,
  inputPath: InputPath
): boolean {
  return (
    inputPath.theInputPath.absolutePath === elmFile.absolutePath ||
    inputPath.realpath.absolutePath === elmFile.absolutePath
  );
}
