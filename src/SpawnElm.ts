import * as path from "path";
import * as Codec from "tiny-decoders";

import { ElmMakeError } from "./ElmMakeError.ts";
import { __ELM_WATCH_ELM_TIMEOUT_MS, type Env } from "./Env.ts";
import * as Errors from "./Errors.ts";
import { silentlyReadIntEnvValue } from "./Helpers.ts";
import { absoluteDirname } from "./PathHelpers.ts";
import {
  type Command,
  type ExitReason,
  spawn,
  type SpawnResult,
} from "./Spawn.ts";
import type {
  AbsolutePath,
  CompilationMode,
  Compiler,
  ElmJsonPath,
  GetNow,
  InputPath,
  OutputPath,
} from "./Types.ts";

export type RunElmMakeResult =
  | RunElmMakeError
  | { tag: "Killed" }
  | { tag: "Success" };

export type RunElmMakeError =
  | {
      tag: "ElmMakeCrashError";
      beforeError: Errors.ElmMakeCrashBeforeError;
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
      error: Codec.DecoderError;
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

type LocalOutputPath =
  | { tag: "NullOutputPath" }
  | (Pick<OutputPath, "tag" | "temporaryOutputPath" | "theOutputPath"> & {
      writeToTemporaryDir: boolean;
    });

export function make({
  compiler,
  elmJsonPath,
  compilationMode,
  inputs,
  outputPath,
  env,
  getNow,
}: {
  compiler: Compiler;
  elmJsonPath: ElmJsonPath;
  compilationMode: CompilationMode;
  // Empty for packages: `elm make` without inputs typechecks the package.
  inputs: Array<Pick<InputPath, "tag" | "theInputPath">>;
  outputPath: LocalOutputPath;
  env: Env;
  getNow: GetNow;
}): {
  promise: Promise<RunElmMakeResult>;
  kill: (options: { force: boolean }) => void;
} {
  const cwd = absoluteDirname(elmJsonPath);
  const command: Command = {
    command: compiler,
    args: [
      "make",
      "--report=json",
      ...maybeToArray(compilationModeToArg(compilationMode)),
      `--output=${outputPathToAbsoluteString(cwd, outputPath)}`,
      // Use relative paths because:
      // - Windows has a maximum command length. See: https://github.com/lydell/elm-watch/issues/86
      // - It looks nicer in error messages (the printed commands are much shorter).
      ...inputs.map((inputPath) => path.relative(cwd, inputPath.theInputPath)),
    ],
    options: {
      cwd,
      env,
    },
  };

  const { promise, kill } = spawn(command);

  const handleSpawnResult = (spawnResult: SpawnResult): RunElmMakeResult => {
    switch (spawnResult.tag) {
      case "CommandNotFoundError":
        return { tag: "ElmNotFoundError", command };

      case "OtherSpawnError":
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
            ? (parsePotentialElmMakeJson(command, stderr) ??
              unexpectedElmMakeOutput)
            : unexpectedElmMakeOutput;
      }
    }
  };

  const startTime = getNow().getTime();

  return {
    promise: promise.then(handleSpawnResult),
    kill: ({ force }) => {
      if (force) {
        kill();
      } else {
        delayKill(promise, startTime, getNow, env, kill);
      }
    },
  };
}

function delayKill(
  promise: Promise<SpawnResult>,
  startTime: number,
  getNow: GetNow,
  env: Env,
  kill: () => void,
): void {
  const timeout = silentlyReadIntEnvValue(
    env[__ELM_WATCH_ELM_TIMEOUT_MS],
    10000,
  );
  const elapsed = getNow().getTime() - startTime;
  const timeoutId = setTimeout(kill, Math.max(0, timeout - elapsed));
  void promise.finally(() => {
    clearTimeout(timeoutId);
  });
}

export function compilationModeToArg(
  compilationMode: CompilationMode,
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
  cwd: AbsolutePath,
  outputPath: LocalOutputPath,
): string {
  switch (outputPath.tag) {
    case "OutputPath":
      // We usually write to a temporary directory, to make the compilation atomic.
      // If postprocessing fails, we don’t want to end up with a plain Elm file with
      // no hot reloading or web socket client. The only time we can write directly
      // to the output is when in "make" mode with no postprocessing.
      return path.relative(
        cwd,
        outputPath.writeToTemporaryDir
          ? outputPath.temporaryOutputPath
          : outputPath.theOutputPath,
      );
    case "NullOutputPath":
      return "/dev/null";
  }
}

function maybeToArray<T>(arg: T | undefined): Array<T> {
  return arg === undefined ? [] : [arg];
}

function parsePotentialElmMakeJson(
  command: Command,
  stderr: string,
): RunElmMakeResult | undefined {
  if (!stderr.endsWith("}")) {
    // This is a workaround for when Elm crashes, potentially half-way through printing the JSON.
    // For example: https://github.com/elm/compiler/issues/1916
    const errorIndex = stderr.lastIndexOf("elm: ");
    if (errorIndex !== -1) {
      return {
        tag: "ElmMakeCrashError",
        beforeError: stderr.startsWith("{")
          ? { tag: "Json", length: errorIndex }
          : { tag: "Text", text: stderr.slice(0, errorIndex) },
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
  extraError: string | undefined,
): RunElmMakeResult {
  // We need to replace literal tab characters as a workaround for https://github.com/elm/compiler/issues/2259.
  const parsed = Codec.JSON.parse(
    ElmMakeError,
    jsonString.replace(/\t/g, "\\t"),
  );
  switch (parsed.tag) {
    case "DecoderError":
      return {
        tag: "ElmMakeJsonParseError",
        error: parsed.error,
        errorFilePath: Errors.tryWriteErrorFile({
          cwd: command.options.cwd,
          name: "ElmMakeJsonParseError",
          content: Errors.toPlainString(
            Errors.elmMakeJsonParseError(
              { tag: "NoLocation" },
              parsed.error,
              { tag: "ErrorFileBadContent", content: jsonString },
              command,
            ),
          ),
          hash: jsonString,
        }),
        command,
      };

    case "Valid":
      return {
        tag: "ElmMakeError",
        error: parsed.value,
        extraError,
      };
  }
}

type ElmInstallResult =
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

const fileNotFoundErrorMessageRegex = /^-- FILE NOT FOUND -+\r?\n/;

const elmStuffErrorMessagePrefixRegex =
  /^\+-+\r?\n(?:\|.*\r?\n)+\+-+\r?\n\r?\n/;

// To install packages, we run `elm make` on a file that does not exist. Elm
// installs and verifies all packages (writing elm-stuff/0.19.x/d.dat and
// friends) before it notices that the file is missing. That makes it fail with
// "FILE NOT FOUND", which we treat as success. We used to compile a dummy file
// instead, but then Elm writes d.dat twice: First in a background thread after
// verifying the packages, and then again after compiling the dummy file. When
// there is no elm-stuff/ (like in CI), the second write could happen while the
// first one was still in progress, failing with "withBinaryFile: resource busy
// (file is locked)". With a missing file, Elm stops before the second write.
// https://github.com/elm/compiler/issues/2258
// We run `elm` in the directory of elm.json, and since elm.json is a file, a
// path "inside" it can never exist.
const nonExistentFile = "elm.json/ElmWatchNonExistentFile.elm";

export function install({
  compiler,
  elmJsonPath,
  env,
  getNow,
}: {
  compiler: Compiler;
  elmJsonPath: ElmJsonPath;
  env: Env;
  getNow: GetNow;
}): {
  promise: Promise<ElmInstallResult>;
  kill: (options: { force: boolean }) => void;
} {
  const command: Command = {
    command: compiler,
    // Don’t use `--report=json` here, because then Elm won’t print downloading
    // of packages. We unfortunately lose colors this way, but package download
    // errors aren’t very colorful anyway.
    args: ["make", `--output=/dev/null`, nonExistentFile],
    options: {
      cwd: absoluteDirname(elmJsonPath),
      env,
    },
  };

  const { promise, kill } = spawn(command);

  const handleSpawnResult = (spawnResult: SpawnResult): ElmInstallResult => {
    switch (spawnResult.tag) {
      case "CommandNotFoundError":
        return { tag: "ElmNotFoundError", command };

      case "OtherSpawnError":
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
          ((exitReason.exitCode === 1 &&
            fileNotFoundErrorMessageRegex.test(stderr)) ||
            // In case `elm` is a wrapper that exits 0 without output (like
            // some fake `elm` binaries in the tests).
            (exitReason.exitCode === 0 && stderr === ""))
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
    kill: ({ force }) => {
      if (force) {
        kill();
      } else {
        delayKill(promise, startTime, getNow, env, kill);
      }
    },
  };
}
