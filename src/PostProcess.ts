import { Env } from "./helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import { absoluteDirname } from "./path-helpers";
import { Command, ExitReason, spawn } from "./spawn";
import {
  CompilationMode,
  ElmJsonPath,
  OutputPath,
  outputPathToAbsoluteString,
} from "./types";

export type PostprocessResult =
  | {
      tag: "CommandNotFoundError";
      command: Command;
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
  elmJsonPath,
  mode,
  output,
  postprocessArray,
  env,
}: {
  elmJsonPath: ElmJsonPath;
  mode: CompilationMode;
  output: OutputPath;
  postprocessArray: NonEmptyArray<string>;
  env: Env;
}): Promise<PostprocessResult> {
  const command: Command = {
    command: postprocessArray[0],
    args: [
      ...postprocessArray.slice(1),
      outputPathToAbsoluteString(output),
      mode,
    ],
    options: {
      cwd: absoluteDirname(elmJsonPath.theElmJsonPath),
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
