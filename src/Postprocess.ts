import * as Decode from "tiny-decoders";

import { Env } from "./Helpers";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import {
  absoluteDirname,
  AbsolutePath,
  absolutePathFromString,
} from "./PathHelpers";
import { Command, ExitReason, spawn } from "./Spawn";
import {
  CompilationMode,
  ElmToolingJsonPath,
  ElmWatchNodeScriptPath,
  OutputPath,
  outputPathToAbsoluteString,
} from "./Types";

export type PostprocessResult =
  | {
      tag: "CommandNotFoundError";
      command: Command;
    }
  | {
      tag: "ElmWatchNodeDefaultExportNotFunction";
      scriptPath: ElmWatchNodeScriptPath;
      imported: Record<string, unknown>;
    }
  | {
      tag: "ElmWatchNodeImportError";
      scriptPath: ElmWatchNodeScriptPath;
      error: unknown;
    }
  | {
      tag: "ElmWatchNodeMissingScript";
    }
  | {
      tag: "ElmWatchNodeResultDecodeError";
      scriptPath: ElmWatchNodeScriptPath;
      args: Array<string>;
      error: Decode.DecoderError;
    }
  | {
      tag: "ElmWatchNodeRunError";
      scriptPath: ElmWatchNodeScriptPath;
      args: Array<string>;
      error: unknown;
    }
  | {
      tag: "OtherSpawnError";
      error: Error;
      command: Command;
    }
  | {
      tag: "PostprocessNonZeroExit";
      exitReason: ExitReason;
      stdout: string;
      stderr: string;
      executedCommand: ExecutedCommand;
    }
  | {
      tag: "StdoutDecodeError";
      error: Decode.DecoderError | SyntaxError;
      executedCommand: ExecutedCommand;
    }
  | { tag: "Success"; newOutputPath: OutputPath };

export type ExecutedCommand =
  | {
      tag: "Command";
      command: Command;
    }
  | {
      tag: "ElmWatchNode";
      scriptPath: ElmWatchNodeScriptPath;
      args: Array<string>;
    };

type Stdout = ReturnType<typeof Stdout>;
const Stdout = Decode.fieldsAuto(
  {
    newOutputPath: Decode.optional(Decode.string),
  },
  { exact: "throw" }
);

export async function postprocess({
  elmToolingJsonPath,
  mode,
  output,
  postprocessArray,
  env,
}: {
  elmToolingJsonPath: ElmToolingJsonPath;
  mode: CompilationMode;
  output: OutputPath;
  postprocessArray: NonEmptyArray<string>;
  env: Env;
}): Promise<PostprocessResult> {
  const commandName = postprocessArray[0];
  const userArgs = postprocessArray.slice(1);
  const extraArgs = [outputPathToAbsoluteString(output), mode];
  const cwd = absoluteDirname(elmToolingJsonPath.theElmToolingJsonPath);

  if (commandName === "elm-watch-node") {
    return elmWatchNode(cwd, output, userArgs, extraArgs);
  }

  const command: Command = {
    command: commandName,
    args: [...userArgs, ...extraArgs],
    options: { cwd, env },
  };

  const spawnResult = await spawn(command);

  switch (spawnResult.tag) {
    case "CommandNotFoundError":
    case "OtherSpawnError":
      return spawnResult;

    case "Exit": {
      const { exitReason, stdout, stderr } = spawnResult;
      const executedCommand: ExecutedCommand = { tag: "Command", command };

      if (!(exitReason.tag === "ExitCode" && exitReason.exitCode === 0)) {
        return {
          tag: "PostprocessNonZeroExit",
          exitReason,
          stdout,
          stderr,
          executedCommand,
        };
      }

      return parseStdout(cwd, output, executedCommand, stdout);
    }
  }
}

const ElmWatchNodeResult = Decode.fieldsAuto(
  {
    exitCode: Decode.number,
    stdout: Decode.optional(Decode.string, ""),
    stderr: Decode.optional(Decode.string, ""),
  },
  { exact: "throw" }
);

async function elmWatchNode(
  cwd: AbsolutePath,
  output: OutputPath,
  userArgs: Array<string>,
  extraArgs: Array<string>
): Promise<PostprocessResult> {
  if (!isNonEmptyArray(userArgs)) {
    return { tag: "ElmWatchNodeMissingScript" };
  }

  const scriptPath: ElmWatchNodeScriptPath = {
    tag: "ElmWatchNodeScriptPath",
    theElmWatchNodeScriptPath: absolutePathFromString(cwd, userArgs[0]),
    originalString: userArgs[0],
  };

  let imported;
  try {
    imported = (await import(
      scriptPath.theElmWatchNodeScriptPath.absolutePath
    )) as Record<string, unknown>;
  } catch (errorAny) {
    return {
      tag: "ElmWatchNodeImportError",
      scriptPath,
      error: errorAny,
    };
  }

  if (typeof imported.default !== "function") {
    return {
      tag: "ElmWatchNodeDefaultExportNotFunction",
      scriptPath,
      imported,
    };
  }

  const args = [...userArgs.slice(1), ...extraArgs];

  let returnValue;
  try {
    returnValue = (await imported.default(args)) as unknown;
  } catch (errorAny) {
    return {
      tag: "ElmWatchNodeRunError",
      scriptPath,
      args,
      error: errorAny,
    };
  }

  let result;
  try {
    result = ElmWatchNodeResult(returnValue);
  } catch (errorAny) {
    const error = errorAny as Decode.DecoderError;
    return {
      tag: "ElmWatchNodeResultDecodeError",
      scriptPath,
      args,
      error,
    };
  }

  const executedCommand: ExecutedCommand = {
    tag: "ElmWatchNode",
    scriptPath,
    args,
  };

  if (result.exitCode !== 0) {
    return {
      tag: "PostprocessNonZeroExit",
      exitReason: { tag: "ExitCode", exitCode: result.exitCode },
      stdout: result.stdout,
      stderr: result.stderr,
      executedCommand,
    };
  }

  return parseStdout(cwd, output, executedCommand, result.stdout);
}

function parseStdout(
  cwd: AbsolutePath,
  output: OutputPath,
  executedCommand: ExecutedCommand,
  stdoutString: string
): PostprocessResult {
  let stdout: Stdout | undefined = undefined;
  if (stdoutString.trim() !== "") {
    try {
      stdout = Stdout(JSON.parse(stdoutString));
    } catch (errorAny) {
      const error = errorAny as Decode.DecoderError | SyntaxError;
      return {
        tag: "StdoutDecodeError",
        error,
        executedCommand,
      };
    }
  }

  const newOutputPath: OutputPath =
    stdout?.newOutputPath === undefined
      ? output
      : {
          tag: "OutputPath",
          theOutputPath: absolutePathFromString(cwd, stdout.newOutputPath),
          originalString: stdout.newOutputPath,
        };

  return { tag: "Success", newOutputPath };
}
