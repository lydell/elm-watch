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
  RunMode,
} from "./Types";

export type PostprocessResult =
  | PostprocessError
  | {
      tag: "Success";
      code: Buffer;
    };

export type PostprocessError =
  | {
      tag: "CommandNotFoundError";
      command: Command;
    }
  | {
      tag: "ElmWatchNodeBadReturnValue";
      scriptPath: ElmWatchNodeScriptPath;
      args: Array<string>;
      returnValue: unknown;
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
    };

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

export async function postprocess({
  env,
  elmToolingJsonPath,
  compilationMode,
  runMode,
  outputPath: output,
  postprocessArray,
  code,
}: {
  env: Env;
  elmToolingJsonPath: ElmToolingJsonPath;
  compilationMode: CompilationMode;
  runMode: RunMode;
  outputPath: OutputPath;
  postprocessArray: NonEmptyArray<string>;
  code: Buffer | string;
}): Promise<PostprocessResult> {
  const commandName = postprocessArray[0];
  const userArgs = postprocessArray.slice(1);
  const extraArgs = [
    outputPathToAbsoluteString(output),
    compilationMode,
    runMode,
  ];
  const cwd = absoluteDirname(elmToolingJsonPath.theElmToolingJsonPath);

  if (commandName === "elm-watch-node") {
    return elmWatchNode(cwd, userArgs, extraArgs, code);
  }

  const command: Command = {
    command: commandName,
    args: [...userArgs, ...extraArgs],
    options: { cwd, env },
    stdin: code,
  };

  const spawnResult = await spawn(command);

  switch (spawnResult.tag) {
    case "CommandNotFoundError":
    case "OtherSpawnError":
      return spawnResult;

    case "Exit": {
      const { exitReason } = spawnResult;
      const executedCommand: ExecutedCommand = { tag: "Command", command };

      if (!(exitReason.tag === "ExitCode" && exitReason.exitCode === 0)) {
        const stdout = spawnResult.stdout.toString("utf8");
        const stderr = spawnResult.stderr.toString("utf8");
        return {
          tag: "PostprocessNonZeroExit",
          exitReason,
          stdout,
          stderr,
          executedCommand,
        };
      }

      return { tag: "Success", code: spawnResult.stdout };
    }
  }
}

async function elmWatchNode(
  cwd: AbsolutePath,
  userArgs: Array<string>,
  extraArgs: Array<string>,
  code: Buffer | string
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

  const args = [code.toString("utf8"), ...userArgs.slice(1), ...extraArgs];

  let returnValue: unknown;
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

  if (typeof returnValue !== "string") {
    return {
      tag: "ElmWatchNodeBadReturnValue",
      scriptPath,
      args,
      returnValue,
    };
  }

  return { tag: "Success", code: Buffer.from(returnValue) };
}
