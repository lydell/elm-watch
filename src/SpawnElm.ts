import * as fs from "fs";
import * as os from "os";
import { DecoderError } from "tiny-decoders";

import { ElmMakeError } from "./ElmMakeError";
import { Env, sha256 } from "./Helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import {
  absoluteDirname,
  AbsolutePath,
  absolutePathFromString,
} from "./PathHelpers";
import { Command, ExitReason, spawn } from "./Spawn";
import {
  CompilationMode,
  ElmJsonPath,
  InputPath,
  OutputPath,
  outputPathToAbsoluteString,
} from "./Types";

export type RunElmMakeResult = RunElmMakeError | { tag: "Success" };

export type RunElmMakeError =
  | {
      tag: "ElmMakeError";
      error: ElmMakeError;
    }
  | {
      tag: "ElmMakeJsonParseError";
      error: DecoderError | SyntaxError;
      jsonPath: JsonPath;
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

export type JsonPath =
  | AbsolutePath
  | { tag: "WritingJsonFailed"; error: Error; attemptedPath: AbsolutePath };

export async function make({
  elmJsonPath,
  compilationMode,
  inputs,
  output,
  env,
}: {
  elmJsonPath: ElmJsonPath;
  compilationMode: CompilationMode;
  inputs: NonEmptyArray<InputPath>;
  output: OutputPath;
  env: Env;
}): Promise<RunElmMakeResult> {
  const command: Command = {
    command: "elm",
    args: [
      "make",
      "--report=json",
      ...maybeToArray(compilationModeToArg(compilationMode)),
      `--output=${outputPathToAbsoluteString(output)}`,
      ...inputs.map((inputPath) => inputPath.theInputPath.absolutePath),
    ],
    options: {
      cwd: absoluteDirname(elmJsonPath.theElmJsonPath),
      env,
    },
  };

  const spawnResult = await spawn(command);

  switch (spawnResult.tag) {
    // istanbul ignore next
    case "CommandNotFoundError":
      return { tag: "ElmNotFoundError", command };

    // istanbul ignore next
    case "OtherSpawnError":
      return spawnResult;

    case "Exit": {
      const { exitReason, stdout, stderr } = spawnResult;
      return exitReason.tag === "ExitCode" &&
        exitReason.exitCode === 0 &&
        stdout === "" &&
        stderr === ""
        ? { tag: "Success" }
        : exitReason.tag === "ExitCode" &&
          exitReason.exitCode === 1 &&
          stdout === "" &&
          stderr.startsWith("{")
        ? parseElmMakeJson(command, stderr)
        : {
            tag: "UnexpectedElmMakeOutput",
            exitReason,
            stdout,
            stderr,
            command,
          };
    }
  }
}

export function compilationModeToArg(
  compilationMode: CompilationMode
): string | undefined {
  switch (compilationMode) {
    case "standard":
      return undefined;
    case "debug":
      return "--debug";
    case "optimize":
      return "--optimize";
  }
}

export function maybeToArray<T>(arg: T | undefined): Array<T> {
  return arg === undefined ? [] : [arg];
}

function parseElmMakeJson(
  command: Command,
  jsonString: string
): RunElmMakeResult {
  let json: unknown;

  try {
    json = JSON.parse(jsonString);
  } catch (errorAny) {
    const error = errorAny as SyntaxError;
    return {
      tag: "ElmMakeJsonParseError",
      error,
      jsonPath: tryWriteJson(command.options.cwd, jsonString),
      command,
    };
  }

  try {
    return {
      tag: "ElmMakeError",
      error: ElmMakeError(json),
    };
  } catch (errorAny) {
    const error = errorAny as DecoderError;
    return {
      tag: "ElmMakeJsonParseError",
      error,
      jsonPath: tryWriteJson(
        command.options.cwd,
        JSON.stringify(json, null, 2)
      ),
      command,
    };
  }
}

function tryWriteJson(cwd: AbsolutePath, json: string): JsonPath {
  const jsonPath = absolutePathFromString(
    cwd,
    `elm-watch-ElmMakeJsonParseError-${sha256(json)}.json`
  );
  try {
    fs.writeFileSync(jsonPath.absolutePath, json);
    return jsonPath;
  } catch (errorAny) {
    const error = errorAny as Error;
    return {
      tag: "WritingJsonFailed",
      error,
      attemptedPath: jsonPath,
    };
  }
}

export type ElmInstallResult =
  | {
      tag: "CreatingDummyFailed";
      error: Error;
    }
  | {
      tag: "ElmInstallError";
      title: string;
      message: string;
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
      tag: "Success";
      elmInstallOutput: string;
    }
  | {
      tag: "UnexpectedElmInstallOutput";
      exitReason: ExitReason;
      stdout: string;
      stderr: string;
      command: Command;
    }
  | { tag: "ElmJsonError" };

const elmErrorMessageRegex = /^-- (.+) -+( elm\.json)?\r?\n([^]+)$/;

export async function install({
  elmJsonPath,
  env,
}: {
  elmJsonPath: ElmJsonPath;
  env: Env;
}): Promise<ElmInstallResult> {
  const dummy = absolutePathFromString(
    { tag: "AbsolutePath", absolutePath: os.tmpdir() },
    "ElmWatchDummy.elm"
  );

  try {
    fs.writeFileSync(dummy.absolutePath, elmWatchDummy());
  } catch (errorAny) {
    const error = errorAny as Error;
    return {
      tag: "CreatingDummyFailed",
      error,
    };
  }

  const command: Command = {
    command: "elm",
    // Don’t use `--report=json` here, because then Elm won’t print downloading
    // of packages. We unfortunately lose colors this way, but package download
    // errors aren’t very colorful anyway.
    args: ["make", `--output=/dev/null`, dummy.absolutePath],
    options: {
      cwd: absoluteDirname(elmJsonPath.theElmJsonPath),
      env,
    },
  };

  const spawnResult = await spawn(command);

  switch (spawnResult.tag) {
    case "CommandNotFoundError":
      return { tag: "ElmNotFoundError", command };

    // istanbul ignore next
    case "OtherSpawnError":
      return spawnResult;

    case "Exit": {
      const { exitReason, stdout, stderr } = spawnResult;

      if (
        exitReason.tag === "ExitCode" &&
        exitReason.exitCode === 0 &&
        stderr === ""
      ) {
        return {
          tag: "Success",
          elmInstallOutput: stdout
            // Elm uses `\r` to overwrite the same line multiple times.
            .split(/\r?\n|\r/)
            // Only include lines like `● elm/core 1.0.5` (they are indented).
            // Ignore stuff like "Starting downloads..." and "Verifying dependencies (4/7)".
            .filter((line) => line.startsWith("  "))
            // One more space looks nicer in our output.
            .map((line) => ` ${line}`)
            .join("\n")
            .trimEnd(),
        };
      }

      const match = elmErrorMessageRegex.exec(stderr);

      if (
        exitReason.tag === "ExitCode" &&
        exitReason.exitCode === 1 &&
        // Don’t bother checking stdout. Elm likes to print
        // "Dependencies ready!" even on failure.
        match !== null
      ) {
        const [, title, elmJson, message] = match;

        if (elmJson !== undefined) {
          return { tag: "ElmJsonError" };
        }

        // istanbul ignore else
        if (title !== undefined && message !== undefined) {
          return {
            tag: "ElmInstallError",
            title,
            message,
          };
        }
      }

      return {
        tag: "UnexpectedElmInstallOutput",
        exitReason,
        stdout,
        stderr,
        command,
      };
    }
  }
}

function elmWatchDummy(): string {
  return `
module ElmWatchDummy exposing (dummy)


dummy : ()
dummy =
    ()
  `.trim();
}
