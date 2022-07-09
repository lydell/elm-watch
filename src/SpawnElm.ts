import * as fs from "fs";
import * as os from "os";

import { ElmMakeError } from "./ElmMakeError";
import { __ELM_WATCH_TMP_DIR, Env } from "./Env";
import * as Errors from "./Errors";
import { JsonError, toError, toJsonError } from "./Helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import { absoluteDirname, absolutePathFromString } from "./PathHelpers";
import { Command, ExitReason, spawn } from "./Spawn";
import {
  CompilationMode,
  ElmJsonPath,
  ElmWatchJsonPath,
  ElmWatchStuffDir,
  InputPath,
  OutputPath,
} from "./Types";

export type RunElmMakeResult = RunElmMakeError | { tag: "Success" };

export type RunElmMakeError =
  | {
      tag: "ElmMakeError";
      error: ElmMakeError;
      extraError: string | undefined;
    }
  | {
      tag: "ElmMakeJsonParseError";
      error: JsonError;
      errorFilePath: Errors.ErrorFilePath;
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

type NullOutputPath = { tag: "NullOutputPath" };

export async function make({
  elmJsonPath,
  compilationMode,
  inputs,
  outputPath,
  env,
}: {
  elmJsonPath: ElmJsonPath;
  compilationMode: CompilationMode;
  inputs: NonEmptyArray<InputPath>;
  outputPath: NullOutputPath | (OutputPath & { writeToTemporaryDir: boolean });
  env: Env;
}): Promise<RunElmMakeResult> {
  const command: Command = {
    command: "elm",
    args: [
      "make",
      "--report=json",
      ...maybeToArray(compilationModeToArg(compilationMode)),
      `--output=${outputPathToAbsoluteString(outputPath)}`,
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
    // istanbul ignore next
    case "StdinWriteError": // We never write to stdin.
      return {
        tag: "OtherSpawnError",
        error: spawnResult.error,
        command: spawnResult.command,
      };

    case "Exit": {
      const { exitReason } = spawnResult;
      const stdout = spawnResult.stdout.toString("utf8");
      const stderr = spawnResult.stderr.toString("utf8");

      // This is a workaround for: https://github.com/elm/compiler/issues/2264
      // Elm can print a “box” of plain text information before the JSON when
      // it fails to read certain files in elm-stuff/:
      // https://github.com/elm/compiler/blob/9f1bbb558095d81edba5796099fee9981eac255a/builder/src/File.hs#L85-L94
      const match = elmStuffErrorMessagePrefixRegex.exec(stderr);
      const elmStuffError = match?.[0];
      const potentialJson =
        elmStuffError === undefined
          ? stderr
          : stderr.slice(elmStuffError.length);

      return exitReason.tag === "ExitCode" &&
        exitReason.exitCode === 0 &&
        stdout === "" &&
        stderr === ""
        ? { tag: "Success" }
        : exitReason.tag === "ExitCode" &&
          exitReason.exitCode === 1 &&
          stdout === "" &&
          potentialJson.startsWith("{")
        ? parseElmMakeJson(command, potentialJson, elmStuffError?.trim())
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

export function getTemporaryOutputDir(
  elmWatchJsonPath: ElmWatchJsonPath
): ElmWatchStuffDir {
  const elmStuff = absolutePathFromString(
    absoluteDirname(elmWatchJsonPath.theElmWatchJsonPath),
    "elm-stuff"
  );

  return {
    tag: "ElmWatchStuffDir",
    theElmWatchStuffDir: absolutePathFromString(elmStuff, "elm-watch"),
  };
}

function outputPathToAbsoluteString(
  outputPath: NullOutputPath | (OutputPath & { writeToTemporaryDir: boolean })
): string {
  switch (outputPath.tag) {
    case "OutputPath":
      return outputPath.writeToTemporaryDir
        ? outputPath.temporaryOutputPath.absolutePath
        : outputPath.theOutputPath.absolutePath;
    case "NullOutputPath":
      return "/dev/null";
  }
}

function maybeToArray<T>(arg: T | undefined): Array<T> {
  return arg === undefined ? [] : [arg];
}

function parseElmMakeJson(
  command: Command,
  jsonString: string,
  extraError: string | undefined
): RunElmMakeResult {
  let json: unknown;

  try {
    // We need to replace literal tab characters as a workaround for https://github.com/elm/compiler/issues/2259.
    json = JSON.parse(jsonString.replace(/\t/g, "\\t"));
  } catch (unknownError) {
    const error = toJsonError(unknownError);
    return {
      tag: "ElmMakeJsonParseError",
      error,
      errorFilePath: Errors.tryWriteErrorFile({
        cwd: command.options.cwd,
        name: "ElmMakeJsonParseError",
        content: Errors.toPlainString(
          Errors.elmMakeJsonParseError(
            { tag: "NoLocation" },
            error,
            { tag: "ErrorFileBadContent", content: jsonString },
            command
          )
        ),
        hash: jsonString,
      }),
      command,
    };
  }

  try {
    return {
      tag: "ElmMakeError",
      error: ElmMakeError(json),
      extraError,
    };
  } catch (unknownError) {
    const error = toJsonError(unknownError);
    return {
      tag: "ElmMakeJsonParseError",
      error,
      errorFilePath: Errors.tryWriteErrorFile({
        cwd: command.options.cwd,
        name: "ElmMakeJsonParseError",
        content: Errors.toPlainString(
          Errors.elmMakeJsonParseError(
            { tag: "NoLocation" },
            error,
            {
              tag: "ErrorFileBadContent",
              content: JSON.stringify(json, null, 2),
            },
            command
          )
        ),
        hash: jsonString,
      }),
      command,
    };
  }
}

type ElmInstallResult =
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
  | { tag: "ElmJsonError" }
  | { tag: "ElmStuffError" };

const elmJsonErrorMessageRegex = /^-- (.+) -+( elm\.json)?\r?\n([^]+)$/;

const elmStuffErrorMessagePrefixRegex =
  /^\+-+\r?\n(?:\|.*\r?\n)+\+-+\r?\n\r?\n/;

export async function install({
  elmJsonPath,
  env,
}: {
  elmJsonPath: ElmJsonPath;
  env: Env;
}): Promise<ElmInstallResult> {
  const dummy = absolutePathFromString(
    {
      tag: "AbsolutePath",
      absolutePath: env[__ELM_WATCH_TMP_DIR] ?? os.tmpdir(),
    },
    "ElmWatchDummy.elm"
  );

  try {
    fs.writeFileSync(dummy.absolutePath, elmWatchDummy());
  } catch (unknownError) {
    const error = toError(unknownError);
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
    // istanbul ignore next
    case "StdinWriteError": // We never write to stdin.
      return {
        tag: "OtherSpawnError",
        error: spawnResult.error,
        command: spawnResult.command,
      };

    case "Exit": {
      const { exitReason } = spawnResult;
      const stdout = spawnResult.stdout.toString("utf8");
      const stderr = spawnResult.stderr.toString("utf8");

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

      if (elmStuffErrorMessagePrefixRegex.test(stderr)) {
        return { tag: "ElmStuffError" };
      }

      const match = elmJsonErrorMessageRegex.exec(stderr);

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
