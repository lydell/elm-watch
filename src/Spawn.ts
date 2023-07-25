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

export function spawn(command: Command): {
  promise: Promise<SpawnResult>;
  kill: () => void;
} {
  let killed = false;

  // istanbul ignore next
  let kill = (): void => {
    killed = true;
  };

  const promise = (windowsPreviousAttemptError?: Error): Promise<SpawnResult> =>
    new Promise((resolve, reject) => {
      // istanbul ignore if
      if (killed) {
        resolve({ tag: "Killed", command });
        return;
      }

      const child = childProcess.spawn(
        // On Windows, executing just `elm` works for `elm.exe`, but not for
        // `elm.cmd` – then we need to explicitly say `.cmd`. When installing
        // Elm via npm or elm-tooling a `.cmd` file is used (pointing to the
        // `.exe` somewhere else). So we try first with the original command,
        // and then with `.cmd` appended.
        // istanbul ignore next
        windowsPreviousAttemptError === undefined
          ? command.command
          : `${command.command}.cmd`,
        command.args,
        {
          ...command.options,
          cwd: command.options.cwd.absolutePath,
        }
      );

      const stdout: Array<Buffer> = [];
      const stderr: Array<Buffer> = [];

      child.on("error", (error: Error & { code?: string }) => {
        // istanbul ignore else
        if (error.code === "ENOENT") {
          // istanbul ignore if
          if (IS_WINDOWS && windowsPreviousAttemptError === undefined) {
            promise(error).then(resolve).catch(reject);
          } else {
            resolve({ tag: "CommandNotFoundError", command });
          }
        } else {
          resolve({
            tag: "OtherSpawnError",
            error: windowsPreviousAttemptError ?? error,
            command,
          });
        }
      });

      let stdinWriteError:
        | { result: SpawnResult; timeoutId: NodeJS.Timeout }
        | undefined = undefined;

      child.stdin.on("error", (error: Error & { code?: string }) => {
        // EPIPE on Windows and macOS, EOF on Windows.
        // istanbul ignore else
        if (
          error.code === "EPIPE" ||
          /* istanbul ignore next */ error.code === "EOF"
        ) {
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
            timeoutId: setTimeout(
              // This is covered on macOS, but not on Linux.
              // istanbul ignore next
              () => {
                resolve(result);
              },
              500
            ),
          };
        } else {
          resolve({ tag: "OtherSpawnError", error, command });
        }
      });

      // istanbul ignore next
      child.stdout.on("error", (error: Error) => {
        resolve({ tag: "OtherSpawnError", error, command });
      });

      // istanbul ignore next
      child.stderr.on("error", (error: Error) => {
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
        // istanbul ignore else
        if (!killed) {
          child.kill();
          resolve({ tag: "Killed", command });
          killed = true;
        }
      };

      if (command.stdin !== undefined) {
        child.stdin.end(command.stdin);
      }
    });

  // istanbul ignore next
  return {
    promise: promise(),
    kill: () => {
      kill();
    },
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
