import * as childProcess from "child_process";
import { DecoderError } from "tiny-decoders";

import { ElmMakeError } from "./ElmMakeError";
import { IS_WINDOWS } from "./helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import { CompilationMode, ElmJsonPath, InputPath, OutputPath } from "./types";

type ElmMakeResult =
  | {
      tag: "DecodeError";
      error: DecoderError;
      rawJson: unknown;
    }
  | {
      tag: "ElmMakeError";
      error: ElmMakeError;
    }
  | {
      tag: "ElmNotFoundError";
    }
  | {
      tag: "JsonParseError";
      error: SyntaxError;
      rawJsonString: string;
    }
  | {
      tag: "OtherSpawnError";
      error: Error;
    }
  | {
      tag: "Success";
    }
  | {
      tag: "UnexpectedOutput";
      exitReason: ExitReason;
      stdout: string;
      stderr: string;
    };

export async function make({
  elmJsonPath,
  mode,
  inputs,
  output,
}: {
  elmJsonPath: ElmJsonPath;
  mode: CompilationMode;
  inputs: NonEmptyArray<InputPath>;
  output: OutputPath;
}): Promise<ElmMakeResult> {
  return new Promise((resolve) => {
    const args = [
      "make",
      "--report",
      "json",
      ...compilationModeToArgs(mode),
      "--output",
      outputPathToArg(output),
      ...inputs.map((inputPath) => inputPath.theInputPath.absolutePath),
    ];

    const elm = childProcess.spawn(
      "elm",
      IS_WINDOWS ? args.map(cmdEscapeArg) : args,
      {
        shell: IS_WINDOWS,
        cwd: elmJsonPath.theElmJsonPath.absolutePath,
      }
    );

    let stdout = "";
    let stderr = "";

    elm.on("error", (error: Error & { code?: string }) => {
      resolve(
        error.code === "ENOENT"
          ? { tag: "ElmNotFoundError" }
          : { tag: "OtherSpawnError", error }
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
          ? { tag: "Success" }
          : exitCode === 1 && signal === null && stdout !== "" && stderr === ""
          ? parseElmMakeJson(stdout)
          : {
              tag: "UnexpectedOutput",
              exitReason: exitReason(exitCode, signal),
              stdout,
              stderr,
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

function outputPathToArg(output: OutputPath): string {
  switch (output.tag) {
    case "OutputPath":
      return output.theOutputPath.absolutePath;
    case "NullOutputPath":
      return "/dev/null";
  }
}

type ExitReason =
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

function parseElmMakeJson(jsonString: string): ElmMakeResult {
  let json: unknown;

  try {
    json = JSON.parse(jsonString);
  } catch (errorAny) {
    const error = errorAny as SyntaxError;
    return {
      tag: "JsonParseError",
      error,
      rawJsonString: jsonString,
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
      tag: "DecodeError",
      error,
      rawJson: json,
    };
  }
}
