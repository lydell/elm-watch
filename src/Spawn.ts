import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";

import type { Env } from "./Env.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import type { AbsolutePath } from "./Types.ts";

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

  const promise = new Promise<SpawnResult>((resolve) => {
    const child = spawnChild(command);

    /* v8 ignore start */
    if (child === undefined) {
      resolve({ tag: "CommandNotFoundError", command });
      return;
    }
    /* v8 ignore stop */

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

  running.add(promise);
  void promise.finally(() => {
    running.delete(promise);
  });

  /* v8 ignore start */
  return {
    promise,
    kill: () => {
      kill();
    },
  };
  /* v8 ignore stop */
}

// Returns `undefined` if the command could not be found on Windows. On other
// platforms, that is reported via an ENOENT error event instead.
function spawnChild(
  command: Command,
): childProcess.ChildProcessWithoutNullStreams | undefined {
  /* v8 ignore start */
  if (!IS_WINDOWS) {
    return childProcess.spawn(command.command, command.args, command.options);
  }

  const file = findOnWindowsPath(
    command.command,
    command.options.cwd,
    command.options.env,
  );

  if (file === undefined) {
    return undefined;
  }

  // If the Elm binary is `elm.exe`, we can spawn it directly. But when
  // installing Elm with npm or elm-tooling, we have `node_modules/.bin/elm.cmd`
  // which in turn calls an `elm.exe` elsewhere. `.cmd` files cannot be executed
  // directly with `child_process.spawn` – it requires a shell, which is why we
  // pass `shell: true` here. However, when using that option we must pass
  // everything as a single string and escape stuff ourselves.
  return /\.exe$/i.test(file)
    ? childProcess.spawn(file, command.args, command.options)
    : childProcess.spawn([file, ...command.args].map(windowsEscape).join(" "), {
        ...command.options,
        shell: true,
      });
  /* v8 ignore stop */
}

// Like `which`, but for Windows only. We only ever spawn `elm`, so this only
// supports bare command names without extension.
/* v8 ignore start */
function findOnWindowsPath(
  command: string,
  cwd: AbsolutePath,
  env: Env,
): string | undefined {
  // Environment variables are case insensitive on Windows. Node.js sorts the
  // keys and uses the first match, so do the same here.
  const getEnv = (name: string): string | undefined => {
    const key = Object.keys(env)
      .sort()
      .find((key2) => key2.toUpperCase() === name);
    return key === undefined ? undefined : env[key];
  };

  const extensions = (getEnv("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((extension) => extension !== "");

  const dirs = (getEnv("PATH") ?? "")
    .split(path.delimiter)
    // PATH entries are allowed to be wrapped in double quotes on Windows.
    .map((dir) => dir.replace(/^"(.*)"$/, "$1"))
    .filter((dir) => dir !== "");

  for (const dir of dirs) {
    for (const extension of extensions) {
      // Relative PATH entries are relative to the cwd of the spawned command.
      const file = path.resolve(cwd, dir, command + extension);
      try {
        if (fs.statSync(file).isFile()) {
          return file;
        }
      } catch {
        // Try the next one.
      }
    }
  }

  return undefined;
}
/* v8 ignore stop */

/* v8 ignore start */
function windowsEscape(arg: string): string {
  // The args we pass to `elm` are flags and file paths. File paths cannot
  // contain double quotes and newlines on Windows. That makes it much easier to
  // escape: We just need to wrap in double quotes. There is one exception:
  // `%PATH%` expands to the `PATH` environment variable. The solution is to
  // turn `Hi %PATH%` into `"Hi "%"PATH"%""` (multiple double quoted strings
  // with bare percentage signs in between).
  // The easiest way to play around with escaping on Windows is to run the following:
  // child_process.spawn('node -p process.argv "put stuff here"', { shell: true, stdio: 'inherit' })
  // That prints an array of the arguments `node` receives. Check if the last argument
  // contains all the text you wrote within the double quotes unchanged.
  return `"${arg.replace(/%/g, '"%"')}"`;
}
/* v8 ignore stop */

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
