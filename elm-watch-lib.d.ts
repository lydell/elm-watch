// This file contains manually copy-pasted-and-adjusted types for `elm-watch-lib.ts`.

import type { DecoderError } from "tiny-decoders";

export function readSourceDirectories(elmJsonPath: string): ElmJsonParseResult;

export function walkImports(
  sourceDirectories: NonEmptyArray<string>,
  inputRealPaths: NonEmptyArray<string>,
): WalkImportsResult;

export function inject(compilationMode: CompilationMode, code: string): string;

export function elmMake(options: {
  elmJsonPath: string;
  compilationMode: CompilationMode;
  inputs: NonEmptyArray<string>;
  outputPath: "/dev/null" | string;
  env: Env;
}): {
  promise: Promise<RunElmMakeResult>;
  kill: (options: { force: boolean }) => void;
};

export type NonEmptyArray<T> = [T, ...Array<T>];

export type Env = Record<string, string | undefined>;

export type CompilationMode = "debug" | "standard" | "optimize";

export type ElmJsonParseResult =
  | ElmJsonParseError
  | {
      tag: "Parsed";
      sourceDirectories: NonEmptyArray<string>;
    };

export type ElmJsonParseError =
  | {
      tag: "ElmJsonDecodeError";
      elmJsonPath: string;
      error: DecoderError;
    }
  | {
      tag: "ElmJsonReadError";
      elmJsonPath: string;
      error: Error;
    };

export type WalkImportsResult =
  | WalkImportsError
  | {
      tag: "Success";
      allRelatedElmFilePaths: Set<string>;
    };

export type WalkImportsError = {
  tag: "ImportWalkerFileSystemError";
  error: NodeJS.ErrnoException;
  relatedElmFilePathsUntilError: Set<string>;
};

export type RunElmMakeResult =
  | RunElmMakeError
  | { tag: "Killed" }
  | { tag: "Success" };

export type RunElmMakeError =
  | {
      tag: "ElmMakeCrashError";
      beforeError: ElmMakeCrashBeforeError;
      error: string;
      command: Command;
    }
  | {
      tag: "ElmMakeError";
      error: ElmMakeError;
      extraError: string | undefined;
    }
  | {
      tag: "ElmMakeJsonParseError";
      error: DecoderError;
      errorFilePath: ErrorFilePath;
      command: Command;
    }
  | {
      tag: "ElmNotFoundError";
      command: Command;
    }
  | {
      tag: "OtherSpawnError";
      error: Error;
      command: Command;
    }
  | {
      tag: "UnexpectedElmMakeOutput";
      exitReason: ExitReason;
      stdout: string;
      stderr: string;
      command: Command;
    };

export type ElmMakeCrashBeforeError =
  | {
      tag: "Json";
      length: number;
    }
  | {
      tag: "Text";
      text: string;
    };

export type ErrorFilePath =
  | {
      tag: "AbsolutePath";
      theAbsolutePath: string;
    }
  | {
      tag: "ErrorFileBadContent";
      content: string;
    }
  | {
      tag: "WritingErrorFileFailed";
      error: Error;
      attemptedPath: string;
    };

export type ExitReason =
  | {
      tag: "ExitCode";
      exitCode: number;
    }
  | {
      tag: "Signal";
      signal: NodeJS.Signals;
    }
  | {
      tag: "Unknown";
    };

export type Command = {
  command: string;
  args: Array<string>;
  options: {
    cwd: string;
    env: Env;
  };
  stdin?: Buffer | string;
};

type ElmMakeError =
  | {
      type: "error";
      path: "elm.json" | null;
      title: string;
      message: Array<string | StyledText>;
    }
  | {
      type: "compile-errors";
      errors: NonEmptyArray<{
        path: string;
        name: string;
        problems: NonEmptyArray<{
          title: string;
          region: {
            start: { line: number; column: number };
            end: { line: number; column: number };
          };
          message: Array<string | StyledText>;
        }>;
      }>;
    };

export type StyledText = {
  bold: boolean;
  underline: boolean;
  color: Color | null;
  string: string;
};

export type Color =
  | "red"
  | "RED"
  | "magenta"
  | "MAGENTA"
  | "yellow"
  | "YELLOW"
  | "green"
  | "GREEN"
  | "cyan"
  | "CYAN"
  | "blue"
  | "BLUE"
  | "black"
  | "BLACK"
  | "white"
  | "WHITE";
