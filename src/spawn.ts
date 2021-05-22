import * as childProcess from "child_process";

import { Env, IS_WINDOWS } from "./helpers";
import { AbsolutePath } from "./path-helpers";

export type SpawnResult =
  | {
      tag: "CommandNotFoundError";
      command: Command;
    }
  | {
      tag: "Exit";
      exitReason: ExitReason;
      stdout: string;
      stderr: string;
      command: Command;
    }
  | {
      tag: "OtherSpawnError";
      error: Error;
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

export async function spawn(command: Command): Promise<SpawnResult> {
  const actualSpawn = IS_WINDOWS
    ? // istanbul ignore next
      (await import("cross-spawn")).spawn
    : childProcess.spawn;
  return new Promise((resolve) => {
    const child = actualSpawn(command.command, command.args, {
      ...command.options,
      cwd: command.options.cwd.absolutePath,
    });

    let stdout = "";
    let stderr = "";

    child.on("error", (error: Error & { code?: string }) => {
      resolve(
        error.code === "ENOENT"
          ? { tag: "CommandNotFoundError", command }
          : { tag: "OtherSpawnError", error, command }
      );
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode, signal) => {
      resolve({
        tag: "Exit",
        exitReason: exitReason(exitCode, signal),
        stdout,
        stderr,
        command,
      });
    });
  });
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
