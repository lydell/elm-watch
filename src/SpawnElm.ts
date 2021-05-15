import * as childProcess from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import { DecoderError } from "tiny-decoders";

import { ElmMakeError } from "./ElmMakeError";
import { Env, IS_WINDOWS } from "./helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import {
  absoluteDirname,
  AbsolutePath,
  absolutePathFromString,
} from "./path-helpers";
import {
  CompilationMode,
  ElmJsonPath,
  InputPath,
  OutputPath,
  outputPathToAbsoluteString,
} from "./types";

export type ElmMakeResult =
  | {
      tag: "ElmMakeError";
      error: ElmMakeError;
    }
  | {
      tag: "ElmNotFoundError";
      command: Command;
    }
  | {
      tag: "JsonParseError";
      error: DecoderError | SyntaxError;
      jsonPath: JsonPath;
      command: Command;
    }
  | {
      tag: "OtherSpawnError";
      error: Error;
      command: Command;
    }
  | {
      tag: "Success";
      timestamp: number;
    }
  | {
      tag: "UnexpectedOutput";
      exitReason: ExitReason;
      stdout: string;
      stderr: string;
      command: Command;
    };

export type Command = {
  command: string;
  args: Array<string>;
  options: {
    cwd: AbsolutePath;
    env: Env;
  };
};

export type JsonPath =
  | AbsolutePath
  | { tag: "WritingJsonFailed"; error: Error; attemptedPath: AbsolutePath };

export async function make({
  elmJsonPath,
  mode,
  inputs,
  output,
  env,
}: {
  elmJsonPath: ElmJsonPath;
  mode: CompilationMode;
  inputs: NonEmptyArray<InputPath>;
  output: OutputPath;
  env: Env;
}): Promise<ElmMakeResult> {
  return new Promise((resolve) => {
    const command: Command = {
      command: "elm",
      args: [
        "make",
        "--report=json",
        ...compilationModeToArgs(mode),
        `--output=${outputPathToAbsoluteString(output)}`,
        ...inputs.map((inputPath) => inputPath.theInputPath.absolutePath),
      ],
      options: {
        cwd: absoluteDirname(elmJsonPath.theElmJsonPath),
        env,
      },
    };

    const elm = childProcess.spawn(
      command.command,
      IS_WINDOWS ? command.args.map(cmdEscapeArg) : command.args,
      {
        ...command.options,
        cwd: command.options.cwd.absolutePath,
        shell: IS_WINDOWS,
      }
    );

    let stdout = "";
    let stderr = "";

    elm.on("error", (error: Error & { code?: string }) => {
      resolve(
        error.code === "ENOENT"
          ? { tag: "ElmNotFoundError", command }
          : { tag: "OtherSpawnError", error, command }
      );
    });

    elm.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    elm.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    elm.on("close", (exitCode, signal) => {
      resolve(
        exitCode === 0 && signal === null && stdout === "" && stderr === ""
          ? { tag: "Success", timestamp: Date.now() }
          : exitCode === 1 &&
            signal === null &&
            stdout === "" &&
            stderr.startsWith("{")
          ? parseElmMakeJson(command, stderr)
          : {
              tag: "UnexpectedOutput",
              exitReason: exitReason(exitCode, signal),
              stdout,
              stderr,
              command,
            }
      );
    });
  });
}

function compilationModeToArgs(mode: CompilationMode): Array<string> {
  switch (mode) {
    case "standard":
      return [];
    case "debug":
      return ["--debug"];
    case "optimize":
      return ["--optimize"];
  }
}

function cmdEscapeArg(arg: string): string {
  // https://qntm.org/cmd
  return `"${arg
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\+)$/, "$1$1")}"`.replace(/[()%!^"<>&|;, ]/g, "^$&");
}

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

function exitReason(
  exitCode: number | null,
  signal: NodeJS.Signals | null
): ExitReason {
  return exitCode !== null
    ? { tag: "ExitCode", exitCode }
    : signal !== null
    ? { tag: "Signal", signal }
    : { tag: "Unknown" };
}

function parseElmMakeJson(command: Command, jsonString: string): ElmMakeResult {
  let json: unknown;

  try {
    json = JSON.parse(jsonString);
  } catch (errorAny) {
    const error = errorAny as SyntaxError;
    return {
      tag: "JsonParseError",
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
      tag: "JsonParseError",
      error,
      jsonPath: tryWriteJson(command.options.cwd, JSON.stringify(json)),
      command,
    };
  }
}

function tryWriteJson(cwd: AbsolutePath, json: string): JsonPath {
  const jsonPath = absolutePathFromString(
    cwd,
    `elm-watch-JsonParseError-${sha256(json)}.json`
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

function sha256(string: string): string {
  return crypto.createHash("sha256").update(string).digest("hex");
}
