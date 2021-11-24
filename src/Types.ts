import * as Decode from "tiny-decoders";

export type AbsolutePath = { tag: "AbsolutePath"; absolutePath: string };

export type Cwd = { tag: "Cwd"; path: AbsolutePath };

export type RunMode = "hot" | "make";

export type CompilationMode = ReturnType<typeof CompilationMode>;
export const CompilationMode = Decode.stringUnion({
  debug: null,
  standard: null,
  optimize: null,
});

export type CompilationModeWithProxy = CompilationMode | "proxy";

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

// elm-stuff/elm-watch-stuff.json
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

// build/main.js
export type OutputPath = {
  tag: "OutputPath";
  theOutputPath: AbsolutePath;
  originalString: string;
  targetName: string;
};

// "postprocess": ["elm-watch-node", "postprocess.js"]
//                                    ^^^^^^^^^^^^^^
export type ElmWatchNodeScriptPath = {
  tag: "ElmWatchNodeScriptPath";
  theElmWatchNodeScriptPath: AbsolutePath;
};

export type CliArg = {
  tag: "CliArg";
  theArg: string;
};

export type GetNow = () => Date;

export type OnIdle = () => "KeepGoing" | "StopError" | "StopSuccess";

export function equalsInputPath(
  elmFile: AbsolutePath,
  inputPath: InputPath
): boolean {
  return (
    inputPath.theInputPath.absolutePath === elmFile.absolutePath ||
    inputPath.realpath.absolutePath === elmFile.absolutePath
  );
}
