import * as childProcess from "child_process";

import { Env, IS_WINDOWS } from "./Helpers";
import { AbsolutePath } from "./PathHelpers";

export type SpawnResult =
  | {
      tag: "CommandNotFoundError";
      command: Command;
    }
  | {
      tag: "Exit";
      exitReason: ExitReason;
      stdout: Buffer;
      stderr: Buffer;
      command: Command;
    }
  | {
      tag: "OtherSpawnError";
      error: Error;
      command: Command;
    }
  | {
      tag: "StdinWriteError";
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
  stdin?: Buffer | string;
};

export async function spawn(command: Command): Promise<SpawnResult> {
  // istanbul ignore next
  const actualSpawn = IS_WINDOWS
    ? (await import("cross-spawn")).spawn
    : childProcess.spawn;
  return new Promise((resolve) => {
    const child = actualSpawn(command.command, command.args, {
      ...command.options,
      cwd: command.options.cwd.absolutePath,
    });

    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];

    child.on("error", (error: Error & { code?: string }) => {
      resolve(
        // istanbul ignore next
        error.code === "ENOENT"
          ? { tag: "CommandNotFoundError", command }
          : { tag: "OtherSpawnError", error, command }
      );
    });

    child.stdin.on("error", (error: Error & { code?: string }) => {
      resolve(
        error.code === "EPIPE"
          ? { tag: "StdinWriteError", error, command }
          : { tag: "OtherSpawnError", error, command }
      );
    });

    child.stdout.on("error", (error: Error) => {
      resolve({ tag: "OtherSpawnError", error, command });
    });

    child.stderr.on("error", (error: Error) => {
      resolve({ tag: "OtherSpawnError", error, command });
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });

    child.on("close", (exitCode, signal) => {
      resolve({
        tag: "Exit",
        exitReason: exitReason(exitCode, signal),
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        command,
      });
    });

    if (command.stdin !== undefined) {
      child.stdin.end(command.stdin);
    }
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
  // istanbul ignore next
  return exitCode !== null
    ? { tag: "ExitCode", exitCode }
    : signal !== null
    ? { tag: "Signal", signal }
    : { tag: "Unknown" };
}
