import type { AbsolutePath } from "./path-helpers";

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

export type CliArg = {
  tag: "CliArg";
  theArg: string;
};

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
