import * as childProcess from "child_process";

import { Env } from "./Env";
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
      tag: "Killed";
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

// Promises for all commands that are currently running.
const running = new Set<Promise<unknown>>();

// Resolves once all currently running commands have exited.
export async function waitForRunningCommands(): Promise<void> {
  while (running.size > 0) {
    await Promise.allSettled(running);
  }
}

export function spawn(command: Command): {
  promise: Promise<SpawnResult>;
  kill: () => void;
} {
  let killed = false;

  /* v8 ignore start */
  let kill = (): void => {
    killed = true;
  };
  /* v8 ignore stop */

  const promise = (
    actualSpawn: typeof childProcess.spawn,
  ): Promise<SpawnResult> =>
    new Promise((resolve) => {
      /* v8 ignore start */
      if (killed) {
        resolve({ tag: "Killed", command });
        return;
      }
      /* v8 ignore stop */

      const child = actualSpawn(command.command, command.args, {
        ...command.options,
        cwd: command.options.cwd,
      });

      const stdout: Array<Buffer> = [];
      const stderr: Array<Buffer> = [];

      child.on("error", (error: Error & { code?: string }) => {
        resolve(
          /* v8 ignore start */
          error.code === "ENOENT"
            ? { tag: "CommandNotFoundError", command }
            : { tag: "OtherSpawnError", error, command },
          /* v8 ignore stop */
        );
      });

      /* v8 ignore start */
      child.stdin.on("error", (error: Error) => {
        resolve({ tag: "OtherSpawnError", error, command });
      });
      /* v8 ignore stop */

      /* v8 ignore start */
      child.stdout.on("error", (error: Error) => {
        resolve({ tag: "OtherSpawnError", error, command });
      });
      /* v8 ignore stop */

      /* v8 ignore start */
      child.stderr.on("error", (error: Error) => {
        resolve({ tag: "OtherSpawnError", error, command });
      });
      /* v8 ignore stop */

      child.stdout.on("data", (chunk: Buffer) => {
        stdout.push(chunk);
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr.push(chunk);
      });

      child.on("exit", (exitCode, signal) => {
        if (killed) {
          // Ignore after killed.
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
          resolve({ tag: "Killed", command });
          killed = true;
        }
      };
    });

  /* v8 ignore start */
  const resultPromise = IS_WINDOWS
    ? import("cross-spawn").then((crossSpawn) => promise(crossSpawn.spawn))
    : promise(childProcess.spawn);
  /* v8 ignore stop */

  running.add(resultPromise);
  void resultPromise.finally(() => {
    running.delete(resultPromise);
  });

  /* v8 ignore start */
  return {
    promise: resultPromise,
    kill: () => {
      kill();
    },
  };
  /* v8 ignore stop */
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
  signal: NodeJS.Signals | null,
): ExitReason {
  /* v8 ignore start */
  return exitCode !== null
    ? { tag: "ExitCode", exitCode }
    : signal !== null
      ? { tag: "Signal", signal }
      : { tag: "Unknown" };
  /* v8 ignore stop */
}
