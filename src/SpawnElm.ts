import * as crypto from "crypto";
import * as fs from "fs";
import { DecoderError } from "tiny-decoders";

import { ElmMakeError } from "./ElmMakeError";
import { Env } from "./helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import {
  absoluteDirname,
  AbsolutePath,
  absolutePathFromString,
} from "./path-helpers";
import { Command, ExitReason, spawn } from "./spawn";
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

  const spawnResult = await spawn(command);

  switch (spawnResult.tag) {
    case "CommandNotFoundError":
      return { tag: "ElmNotFoundError", command };

    case "OtherSpawnError":
      return spawnResult;

    case "Exit": {
      const { exitReason, stdout, stderr } = spawnResult;
      return exitReason.tag === "ExitCode" &&
        exitReason.exitCode === 0 &&
        stdout === "" &&
        stderr === ""
        ? { tag: "Success", timestamp: Date.now() }
        : exitReason.tag === "ExitCode" &&
          exitReason.exitCode === 1 &&
          stdout === "" &&
          stderr.startsWith("{")
        ? parseElmMakeJson(command, stderr)
        : {
            tag: "UnexpectedOutput",
            exitReason,
            stdout,
            stderr,
            command,
          };
    }
  }
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
