import type { AbsolutePath } from "./path-helpers";

export type RunMode = "hot" | "make" | "watch";

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
};

// build/main.js
export type OutputPath =
  | {
      tag: "OutputPath";
      theOutputPath: AbsolutePath;
    }
  | { tag: "NullOutputPath" };

export type CliArg = {
  tag: "CliArg";
  theArg: string;
};
