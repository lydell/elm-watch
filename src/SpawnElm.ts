import * as fs from "fs";
import * as os from "os";

import { ElmMakeError } from "./ElmMakeError";
import { __ELM_WATCH_ELM_TIMEOUT, __ELM_WATCH_TMP_DIR, Env } from "./Env";
import * as Errors from "./Errors";
import {
  JsonError,
  silentlyReadIntEnvValue,
  toError,
  toJsonError,
} from "./Helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import { absoluteDirname, absolutePathFromString } from "./PathHelpers";
import { Command, ExitReason, spawn, SpawnResult } from "./Spawn";
import {
  CompilationMode,
  ElmJsonPath,
  GetNow,
  InputPath,
  OutputPath,
} from "./Types";

export type RunElmMakeResult =
  | RunElmMakeError
  | { tag: "Killed" }
  | { tag: "Success" };

export type RunElmMakeError =
  | {
      tag: "ElmMakeCrashError";
      jsonLength: number | undefined;
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

export function make({
  elmJsonPath,
  compilationMode,
  inputs,
  outputPath,
  env,
  getNow,
}: {
  elmJsonPath: ElmJsonPath;
  compilationMode: CompilationMode;
  inputs: NonEmptyArray<InputPath>;
  outputPath: NullOutputPath | (OutputPath & { writeToTemporaryDir: boolean });
  env: Env;
  getNow: GetNow;
}): { promise: Promise<RunElmMakeResult>; kill: () => void } {
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

  const { promise, kill } = spawn(command);

  const handleSpawnResult = (spawnResult: SpawnResult): RunElmMakeResult => {
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

      case "Killed":
        return { tag: "Killed" };

      case "Exit": {
        const { exitReason } = spawnResult;
        const stdout = spawnResult.stdout.toString("utf8");
        const stderr = spawnResult.stderr.toString("utf8");

        const unexpectedElmMakeOutput: RunElmMakeResult = {
          tag: "UnexpectedElmMakeOutput",
          exitReason,
          stdout,
          stderr,
          command,
        };

        return exitReason.tag === "ExitCode" &&
          exitReason.exitCode === 0 &&
          stdout === "" &&
          stderr === ""
          ? { tag: "Success" }
          : exitReason.tag === "ExitCode" &&
            exitReason.exitCode === 1 &&
            stdout === ""
          ? parsePotentialElmMakeJson(command, stderr) ??
            unexpectedElmMakeOutput
          : unexpectedElmMakeOutput;
      }
    }
  };

  const startTime = getNow().getTime();

  return {
    promise: promise.then(handleSpawnResult),
    kill: () => {
      delayKill(startTime, getNow, env, kill);
    },
  };
}

function delayKill(
  startTime: number,
  getNow: GetNow,
  env: Env,
  kill: () => void
): void {
  const timeout = silentlyReadIntEnvValue(env[__ELM_WATCH_ELM_TIMEOUT], 10000);
  const elapsed = getNow().getTime() - startTime;
  setTimeout(kill, Math.max(0, timeout - elapsed));
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

function outputPathToAbsoluteString(
  outputPath: NullOutputPath | (OutputPath & { writeToTemporaryDir: boolean })
): string {
  switch (outputPath.tag) {
    case "OutputPath":
      // We usually write to a temporary directory, to make the compilation atomic.
      // If postprocessing fails, we don’t want to end up with a plain Elm file with
      // no hot reloading or web socket client. The only time we can write directly
      // to the output is when in "make" mode with no postprocessing.
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

function parsePotentialElmMakeJson(
  command: Command,
  stderr: string
): RunElmMakeResult | undefined {
  if (!stderr.endsWith("}")) {
    // This is a workaround for when Elm crashes half-way through printing the JSON.
    const braceIndex = stderr.indexOf("{");
    const errorIndex = stderr.lastIndexOf("elm: ");
    if (errorIndex !== -1) {
      return {
        tag: "ElmMakeCrashError",
        jsonLength: braceIndex === -1 ? undefined : errorIndex - braceIndex,
        error: stderr.slice(errorIndex),
        command,
      };
    }
  }

  // This is a workaround for: https://github.com/elm/compiler/issues/2264
  // Elm can print a “box” of plain text information before the JSON when
  // it fails to read certain files in elm-stuff/:
  // https://github.com/elm/compiler/blob/9f1bbb558095d81edba5796099fee9981eac255a/builder/src/File.hs#L85-L94
  const match = elmStuffErrorMessagePrefixRegex.exec(stderr);
  const elmStuffError = match?.[0];
  const potentialJson =
    elmStuffError === undefined ? stderr : stderr.slice(elmStuffError.length);

  return potentialJson.startsWith("{")
    ? parseActualElmMakeJson(command, potentialJson, elmStuffError?.trim())
    : undefined;
}

function parseActualElmMakeJson(
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
      tag: "Killed";
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

export function install({
  elmJsonPath,
  env,
  getNow,
}: {
  elmJsonPath: ElmJsonPath;
  env: Env;
  getNow: GetNow;
}): { promise: Promise<ElmInstallResult>; kill: () => void } {
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
      promise: Promise.resolve({
        tag: "CreatingDummyFailed",
        error,
      }),
      kill:
        // istanbul ignore next
        () => {
          // Do nothing.
        },
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

  const { promise, kill } = spawn(command);

  const handleSpawnResult = (spawnResult: SpawnResult): ElmInstallResult => {
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

      case "Killed":
        return { tag: "Killed" };

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
  };

  const startTime = getNow().getTime();

  return {
    promise: promise.then(handleSpawnResult),
    kill: () => {
      delayKill(startTime, getNow, env, kill);
    },
  };
}

function elmWatchDummy(): string {
  return `
module ElmWatchDummy exposing (dummy)


dummy : ()
dummy =
    ()
  `.trim();
}
