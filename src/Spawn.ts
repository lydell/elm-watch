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

// Promises for all commands that are currently running (and other work that
// should finish before exiting, see `trackRunning`).
const running = new Set<Promise<unknown>>();

// Resolves once all currently running commands have exited.
export async function waitForRunningCommands(): Promise<void> {
  while (running.size > 0) {
    await Promise.allSettled(running);
  }
}

// Makes `waitForRunningCommands` wait for `promise` too.
export function trackRunning(promise: Promise<unknown>): void {
  running.add(promise);
  void promise.finally(() => {
    running.delete(promise);
  });
}

// Child processes that are currently running. If elm-watch exits while `elm` is
// running, `elm` keeps running: If `elm` is stuck (it can get into infinite
// loops), it keeps running forever. So kill them when exiting, if possible.
// SIGKILL of elm-watch cannot be handled, though.
const runningChildren = new Map<childProcess.ChildProcess, KillChild>();

// The signals that make Node.js exit by default, without emitting "exit".
const EXIT_SIGNALS = ["SIGINT", "SIGHUP", "SIGTERM"] as const;

function trackChild(
  child: childProcess.ChildProcess,
  killChild: KillChild,
): void {
  if (runningChildren.size === 0) {
    process.on("exit", killRunningChildren);
    for (const signal of EXIT_SIGNALS) {
      process.on(signal, onExitSignal);
    }
  }
  runningChildren.set(child, killChild);
  const untrack = (): void => {
    if (runningChildren.delete(child) && runningChildren.size === 0) {
      stopListening();
    }
  };
  child.once("exit", untrack);
  child.once("error", () => {
    // "error" is also emitted if killing fails, but then the child might
    // still be running.
    if (child.pid === undefined) {
      untrack();
    }
  });
}

function stopListening(): void {
  process.off("exit", killRunningChildren);
  for (const signal of EXIT_SIGNALS) {
    process.off(signal, onExitSignal);
  }
}

function killRunningChildren(): void {
  for (const killChild of runningChildren.values()) {
    killChild({ sync: true });
  }
}

function onExitSignal(signal: NodeJS.Signals): void {
  // Someone else listens to this signal (like `Hot.ts` for SIGTERM, or whoever
  // uses elm-watch via the JavaScript API). Let them decide what to do. If they
  // exit, the "exit" listener kills the children.
  if (process.listenerCount(signal) > 1) {
    return;
  }
  killRunningChildren();
  stopListening();
  // With no listeners left, Node.js restores the default behavior for the
  // signal: Exit, just like if we had never listened.
  process.kill(process.pid, signal);
}

// `sync: true` is for when exiting, where async work never finishes.
type KillChild = (options: { sync: boolean }) => void;

function makeKillChild(
  child: childProcess.ChildProcess,
  usesShell: boolean,
): KillChild {
  return ({ sync }) => {
    if (usesShell && child.pid !== undefined) {
      // `child` is `cmd.exe`, running a `.cmd` file (like
      // `node_modules/.bin/elm.cmd`), which in turn runs the real `elm.exe`.
      // Killing `cmd.exe` does not kill its children on Windows, so kill the
      // whole tree.
      const args = ["/pid", child.pid.toString(), "/T", "/F"];
      if (sync) {
        childProcess.spawnSync("taskkill", args, { stdio: "ignore" });
      } else {
        childProcess
          .spawn("taskkill", args, { stdio: "ignore" })
          .on("error", () => {
            // Not much to do.
          });
      }
    } else {
      child.kill(sync ? "SIGKILL" : "SIGTERM");
    }
  };
}

export function spawn(command: Command): {
  promise: Promise<SpawnResult>;
  kill: () => void;
} {
  let killed = false;

  let kill = (): void => {
    killed = true;
  };

  const promise = new Promise<SpawnResult>((resolve) => {
    const spawned = spawnChild(command);

    if (spawned === undefined) {
      resolve({ tag: "CommandNotFoundError", command });
      return;
    }

    const { child, usesShell } = spawned;
    const killChild = makeKillChild(child, usesShell);
    trackChild(child, killChild);

    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];

    child.on("error", (error: Error & { code?: string }) => {
      resolve(
        error.code === "ENOENT"
          ? { tag: "CommandNotFoundError", command }
          : { tag: "OtherSpawnError", error, command },
      );
    });

    child.stdin.on("error", (error: Error) => {
      resolve({ tag: "OtherSpawnError", error, command });
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
        killChild({ sync: false });
        resolve({ tag: "Killed", command });
        killed = true;
      }
    };
  });

  trackRunning(promise);

  return {
    promise,
    kill: () => {
      kill();
    },
  };
}

// Returns `undefined` if the command could not be found on Windows. On other
// platforms, that is reported via an ENOENT error event instead.
function spawnChild(command: Command):
  | {
      child: childProcess.ChildProcessWithoutNullStreams;
      usesShell: boolean;
    }
  | undefined {
  if (!IS_WINDOWS) {
    return {
      child: childProcess.spawn(command.command, command.args, command.options),
      usesShell: false,
    };
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
    ? {
        child: childProcess.spawn(file, command.args, command.options),
        usesShell: false,
      }
    : {
        child: childProcess.spawn(
          [file, ...command.args].map(windowsEscape).join(" "),
          { ...command.options, shell: true },
        ),
        usesShell: true,
      };
}

// Like `which`, but for Windows only. We only ever spawn `elm`, so this only
// supports bare command names without extension. `platformPath` and `isFile`
// can be swapped out to test this on any platform.
export function findOnWindowsPath(
  command: string,
  cwd: AbsolutePath,
  env: Env,
  platformPath: path.PlatformPath = path,
  isFile: (file: string) => boolean = isFileOnDisk,
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
    .split(platformPath.delimiter)
    // PATH entries are allowed to be wrapped in double quotes on Windows.
    .map((dir) => dir.replace(/^"(.*)"$/, "$1"))
    .filter((dir) => dir !== "");

  for (const dir of dirs) {
    for (const extension of extensions) {
      // Relative PATH entries are relative to the cwd of the spawned command.
      const file = platformPath.resolve(cwd, dir, command + extension);
      if (isFile(file)) {
        return file;
      }
    }
  }

  return undefined;
}

function isFileOnDisk(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function windowsEscape(arg: string): string {
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
  return exitCode !== null
    ? { tag: "ExitCode", exitCode }
    : signal !== null
      ? { tag: "Signal", signal }
      : { tag: "Unknown" };
}
