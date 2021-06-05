import * as Decode from "tiny-decoders";

import { Env } from "./Helpers";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { absoluteDirname, absolutePathFromString } from "./PathHelpers";
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
      tag: "ElmWatchNodePostprocessNonZeroExitCode";
      scriptPath: ElmWatchNodeScriptPath;
      args: Array<string>;
      result: ElmWatchNodeResult;
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
      command: Command;
    }
  | { tag: "Success" };

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

  if (commandName === "elm-watch-node") {
    return elmWatchNode(elmToolingJsonPath, userArgs, extraArgs);
  }

  const command: Command = {
    command: commandName,
    args: [...userArgs, ...extraArgs],
    options: {
      cwd: absoluteDirname(elmToolingJsonPath.theElmToolingJsonPath),
      env,
    },
  };

  const spawnResult = await spawn(command);

  switch (spawnResult.tag) {
    case "CommandNotFoundError":
    case "OtherSpawnError":
      return spawnResult;

    case "Exit": {
      const { exitReason, stdout, stderr } = spawnResult;
      return exitReason.tag === "ExitCode" && exitReason.exitCode === 0
        ? { tag: "Success" }
        : {
            tag: "PostprocessNonZeroExit",
            exitReason,
            stdout,
            stderr,
            command,
          };
    }
  }
}

export type ElmWatchNodeResult = ReturnType<typeof ElmWatchNodeResult>;
const ElmWatchNodeResult = Decode.fieldsAuto({
  exitCode: Decode.number,
  stdout: Decode.string,
  stderr: Decode.string,
});

async function elmWatchNode(
  elmToolingJsonPath: ElmToolingJsonPath,
  userArgs: Array<string>,
  extraArgs: Array<string>
): Promise<PostprocessResult> {
  if (!isNonEmptyArray(userArgs)) {
    return { tag: "ElmWatchNodeMissingScript" };
  }

  const scriptPath: ElmWatchNodeScriptPath = {
    tag: "ElmWatchNodeScriptPath",
    theElmWatchNodeScriptPath: absolutePathFromString(
      elmToolingJsonPath.theElmToolingJsonPath,
      userArgs[0]
    ),
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

  return result.exitCode === 0
    ? { tag: "Success" }
    : {
        tag: "ElmWatchNodePostprocessNonZeroExitCode",
        scriptPath,
        args,
        result,
      };
}
