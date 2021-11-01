import * as childProcess from "child_process";

import { Env } from "./Helpers";
import { IS_WINDOWS } from "./IsWindows";
import { AbsolutePath } from "./Types";

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

export const SPAWN_KILLED = new Error(
  "`spawnKillable` returns a `kill` function. That was called! This error is supposed to be caught."
);

export async function spawn(command: Command): Promise<SpawnResult> {
  return spawnKillable(command).promise;
}

export function spawnKillable(command: Command): {
  promise: Promise<SpawnResult>;
  kill: () => void;
} {
  let kill = (): void => {
    // Reassigned below.
  };

  const promise = (
    actualSpawn: typeof childProcess.spawn
  ): Promise<SpawnResult> =>
    new Promise((resolve, reject) => {
      const child = actualSpawn(command.command, command.args, {
        ...command.options,
        cwd: command.options.cwd.absolutePath,
      });

      const stdout: Array<Buffer> = [];
      const stderr: Array<Buffer> = [];
      let killed = false;

      child.on("error", (error: Error & { code?: string }) => {
        resolve(
          // istanbul ignore next
          error.code === "ENOENT"
            ? { tag: "CommandNotFoundError", command }
            : { tag: "OtherSpawnError", error, command }
        );
      });

      let stdinWriteError:
        | { result: SpawnResult; timeoutId: NodeJS.Timeout }
        | undefined = undefined;

      child.stdin.on("error", (error: Error & { code?: string }) => {
        // istanbul ignore else
        if (error.code === "EPIPE") {
          // The postprocess program can exit before we have managed to write all
          // the stdin. The stdin write error happens before the "exit" event.
          // It’s more important to get to know the exit code and stdout/stderr
          // than this stdin error. So give the "exit" event a chance to happen
          // before reporting this one.
          const result: SpawnResult = {
            tag: "StdinWriteError",
            error,
            command,
          };
          stdinWriteError = {
            result,
            timeoutId: setTimeout(() => {
              resolve(result);
            }, 500),
          };
        } else {
          resolve({ tag: "OtherSpawnError", error, command });
        }
      });

      child.stdout.on("error", (error: Error) => {
        // istanbul ignore next
        resolve({ tag: "OtherSpawnError", error, command });
      });

      child.stderr.on("error", (error: Error) => {
        // istanbul ignore next
        resolve({ tag: "OtherSpawnError", error, command });
      });

      child.stdout.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
      });

      child.on("exit", (exitCode, signal) => {
        if (killed) {
          // Ignore after killed.
        } else if (exitCode === 0 && stdinWriteError !== undefined) {
          clearTimeout(stdinWriteError.timeoutId);
          resolve(stdinWriteError.result);
        } else {
          resolve({
            tag: "Exit",
            exitReason: exitReason(exitCode, signal),
            stdout: Buffer.concat(stdout),
            stderr: Buffer.concat(stderr),
            command,
          });
        }
      });

      kill = () => {
        if (!killed) {
          child.kill();
          reject(SPAWN_KILLED);
          killed = true;
        }
      };

      if (command.stdin !== undefined) {
        child.stdin.end(command.stdin);
      }
    });

  return {
    // istanbul ignore next
    promise: IS_WINDOWS
      ? import("cross-spawn").then((crossSpawn) => promise(crossSpawn.spawn))
      : promise(childProcess.spawn),
    kill,
  };
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
