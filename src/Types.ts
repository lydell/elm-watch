import type { AbsolutePath } from "./PathHelpers";

export type RunMode = "hot" | "make";

export type CompilationMode = "debug" | "optimize" | "standard";

// elm-tooling.json
export type ElmToolingJsonPath = {
  tag: "ElmToolingJsonPath";
  theElmToolingJsonPath: AbsolutePath;
};

// elm.json
export type ElmJsonPath = {
  tag: "ElmJsonPath";
  theElmJsonPath: AbsolutePath;
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
export type OutputPath =
  | {
      tag: "OutputPath";
      theOutputPath: AbsolutePath;
      originalString: string;
    }
  | { tag: "NullOutputPath" };

// "postprocess": ["elm-watch-node", "postprocess.js"]
//                                    ^^^^^^^^^^^^^^
export type ElmWatchNodeScriptPath = {
  tag: "ElmWatchNodeScriptPath";
  theElmWatchNodeScriptPath: AbsolutePath;
  originalString: string;
};

export type CliArg = {
  tag: "CliArg";
  theArg: string;
};

export type GetNow = () => Date;

export type OnIdle = () => "KeepGoing" | "Stop";

export function outputPathToAbsoluteString(output: OutputPath): string {
  switch (output.tag) {
    case "OutputPath":
      return output.theOutputPath.absolutePath;
    case "NullOutputPath":
      return "/dev/null";
  }
}

export function outputPathToOriginalString(output: OutputPath): string {
  switch (output.tag) {
    case "OutputPath":
      return output.originalString;
    case "NullOutputPath":
      return "/dev/null";
  }
}
