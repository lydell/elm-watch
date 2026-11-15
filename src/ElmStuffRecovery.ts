import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";

import { __ELM_WATCH_ELM_STUFF_LOCK_TIMEOUT_MS, type Env } from "./Env.ts";
import { silentlyReadIntEnvValue } from "./Helpers.ts";
import type { SpawnResult } from "./Spawn.ts";
import type { Compiler, ElmJsonPath } from "./Types.ts";

// Workaround for: https://github.com/elm/compiler/issues/2367
//
// Elm writes the files in elm-stuff/0.19.x/ (*.elmi, *.elmo, d.dat, i.dat and
// o.dat) by first truncating them and then writing. If `elm` is killed in
// between (by elm-watch when a file changes or when exiting, by ctrl+c, or by
// anything else), the next `elm` can get stuck in an infinite loop when reading
// a half-written file. Even when no file is half-written, the next `elm` can
// report success without type checking the modules that depend on a changed
// module: The killed `elm` already wrote the new .elmi for the changed module,
// so the next `elm` thinks its interface did not change.
//
// Elm writes d.dat (which lists the compiled modules) only after compiling all
// modules. So we back up d.dat before running `elm`, and after an interrupted
// run we restore it and delete all files written after it:
// - Elm then recompiles every module whose .elmi or .elmo was deleted.
// - i.dat and o.dat are written when installing dependencies. They cannot be
//   deleted alone, so then we delete everything.
// Deleting a file written _before_ the restored d.dat does not work: Elm then
// reports a corrupt cache (or crashes).
//
// Note that the cutoff is when d.dat was written, not when `elm` started.
// Another `elm` (like an editor or an AI agent type checking) might have
// started writing files before our `elm` started. Elm runs one `elm` at a time
// per elm-stuff/ (using a file lock), so our `elm` might also have been
// waiting for the other one to finish when it was killed.
//
// The marker is a file in elm-stuff/elm-watch/, so we can also recover after
// elm-watch itself was killed while `elm` was running.

// Lamdera 1.5.0 uses elm-stuff/lamdera-1.5.0-0.19.3/, while older versions
// use elm-stuff/0.19.1/ just like Elm.
const compilerDirRegexes: Record<Compiler, RegExp> = {
  elm: /^\d+\.\d+\.\d+$/,
  lamdera: /^(?:lamdera-\d+\.\d+\.\d+-)?\d+\.\d+\.\d+$/,
};

// If a killed `elm` does not exit within this time, give up waiting for it.
// We try to recover before the next `elm` run instead.
const EXIT_TIMEOUT_MS = 5000;

// If another `elm` holds the lock for longer than this, give up recovering.
// It might be stuck in an infinite loop, due to the very bug we are working
// around.
const DEFAULT_LOCK_TIMEOUT_MS = 60_000;

const LOCK_POLL_INTERVAL_MS = 50;

type Paths = {
  elmStuff: string;
  runningDir: string;
  marker: string;
};

function getPaths(elmJsonPath: ElmJsonPath, compiler: Compiler): Paths {
  const elmStuff = path.join(path.dirname(elmJsonPath), "elm-stuff");
  const runningDir = path.join(elmStuff, "elm-watch", `running-${compiler}`);
  return { elmStuff, runningDir, marker: path.join(runningDir, "started") };
}

// Call right before spawning `elm`.
export async function beforeElm(
  elmJsonPath: ElmJsonPath,
  compiler: Compiler,
  env: Env,
): Promise<void> {
  const paths = getPaths(elmJsonPath, compiler);
  try {
    if (!(await recover(paths, compiler, env))) {
      // Keep the marker, to try again next time.
      return;
    }
    fs.rmSync(paths.runningDir, { recursive: true, force: true });
    fs.mkdirSync(paths.runningDir, { recursive: true });
    for (const dir of getCompilerDirs(paths.elmStuff, compiler)) {
      backUpDetails(paths, dir);
    }
    // Written last: Its modification time is when `elm` started.
    fs.writeFileSync(paths.marker, "");
  } catch {
    // Run `elm` anyway, even if elm-stuff/ is not writable.
  }
}

function backUpDetails(paths: Paths, dir: string): void {
  const details = path.join(paths.elmStuff, dir, "d.dat");
  const backup = path.join(paths.runningDir, `${dir}.d.dat`);
  let before: fs.BigIntStats;
  try {
    before = fs.statSync(details, { bigint: true });
  } catch {
    // There is no d.dat yet.
    return;
  }
  fs.copyFileSync(details, backup, fs.constants.COPYFILE_FICLONE);
  const after = fs.statSync(details, { bigint: true });
  if (after.mtimeNs === before.mtimeNs && after.size === before.size) {
    fs.writeFileSync(`${backup}.mtime`, before.mtimeNs.toString());
  } else {
    // Another `elm` was writing d.dat while we copied it. Without a backup,
    // recovering deletes everything.
    fs.rmSync(backup);
  }
}

// Call once `elm` is done. Resolves once it is safe to run `elm` again.
export async function afterElm(
  elmJsonPath: ElmJsonPath,
  compiler: Compiler,
  spawnResult: SpawnResult,
  exited: Promise<void>,
  env: Env,
): Promise<void> {
  const paths = getPaths(elmJsonPath, compiler);
  try {
    if (
      spawnResult.tag === "CommandNotFoundError" ||
      (spawnResult.tag === "Exit" && spawnResult.exitReason.tag === "ExitCode")
    ) {
      fs.rmSync(paths.runningDir, { recursive: true, force: true });
      return;
    }
    // Killed, or `elm` exited due to a signal. Wait for it to actually exit,
    // so it does not write more files after we have cleaned up.
    if (await withTimeout(exited, EXIT_TIMEOUT_MS)) {
      await recover(paths, compiler, env);
    }
  } catch {
    // The marker is left behind, so we try again before the next `elm` run.
  }
}

// Returns `false` if another `elm` held the lock for too long. Then the marker
// is kept, to try again later.
async function recover(
  paths: Paths,
  compiler: Compiler,
  env: Env,
): Promise<boolean> {
  let started: bigint;
  try {
    started = fs.statSync(paths.marker, { bigint: true }).mtimeNs;
  } catch {
    // No marker: The last `elm` run was not interrupted.
    return true;
  }

  for (const dir of getCompilerDirs(paths.elmStuff, compiler)) {
    const dirPath = path.join(paths.elmStuff, dir);
    if (!wasTouchedSince(dirPath, started)) {
      continue;
    }
    // Another `elm` (like an editor or an AI agent type checking) might be
    // running. Wait for it to finish, and make it wait for us.
    const unlock = await lockElmStuff(dirPath, env);
    if (unlock === undefined) {
      return false;
    }
    try {
      await recoverDir(paths, dir);
    } finally {
      await unlock();
    }
  }

  fs.rmSync(paths.runningDir, { recursive: true, force: true });
  return true;
}

function wasTouchedSince(dirPath: string, started: bigint): boolean {
  return fs
    .readdirSync(dirPath)
    .some(
      (name) =>
        name !== "lock" &&
        fs.statSync(path.join(dirPath, name), { bigint: true }).mtimeNs >=
          started,
    );
}

async function recoverDir(paths: Paths, dir: string): Promise<void> {
  const dirPath = path.join(paths.elmStuff, dir);
  // `lock` is used by Elm to run one `elm` at a time, and is always empty.
  const files = fs
    .readdirSync(dirPath)
    .filter((name) => name !== "lock")
    .map((name) => ({
      name,
      mtimeNs: fs.statSync(path.join(dirPath, name), { bigint: true }).mtimeNs,
    }));
  const backup = path.join(paths.runningDir, `${dir}.d.dat`);
  let detailsMtimeNs: bigint | undefined;
  try {
    detailsMtimeNs = BigInt(fs.readFileSync(`${backup}.mtime`, "utf8"));
  } catch {
    // No backup: There was no d.dat when `elm` started.
  }
  const stale = files
    .filter(
      (file) => detailsMtimeNs === undefined || file.mtimeNs > detailsMtimeNs,
    )
    .map((file) => file.name);
  // We remove the files rather than the directory itself, since elm-watch
  // restarts when the directory is removed (see WatcherEvents.ts).
  const restoreDetails =
    detailsMtimeNs !== undefined &&
    !stale.includes("i.dat") &&
    !stale.includes("o.dat");
  // d.dat is restored last: If removing a file fails, the backup is still
  // there for the next attempt.
  for (const name of restoreDetails ? stale : files.map((file) => file.name)) {
    if (!(name === "d.dat" && restoreDetails)) {
      fs.rmSync(path.join(dirPath, name), REMOVE_OPTIONS);
    }
  }
  if (restoreDetails && stale.includes("d.dat")) {
    await renameWithRetries(backup, path.join(dirPath, "d.dat"));
  }
}

// On Windows, a file that another process (like an antivirus) has open cannot
// be removed or replaced, so retry for a little while. (The retry options are
// only used together with `recursive: true`.)
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 100;
const REMOVE_OPTIONS: fs.RmOptions = {
  recursive: true,
  force: true,
  maxRetries: MAX_RETRIES,
  retryDelay: RETRY_DELAY_MS,
};

async function renameWithRetries(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
      await sleep(attempt * RETRY_DELAY_MS);
    }
  }
}

// Takes the same lock as Elm, which uses flock(2) on Unix and
// LockFileEx on Windows. Resolves with a function to release the lock, or
// `undefined` if another `elm` held it for too long.
export async function lockElmStuff(
  dirPath: string,
  env: Env,
): Promise<Unlock | undefined> {
  const lockPath = path.join(dirPath, "lock");
  if (!fs.existsSync(lockPath)) {
    // No `elm` has used this directory yet.
    return noLock;
  }
  const timeoutMs = silentlyReadIntEnvValue(
    env[__ELM_WATCH_ELM_STUFF_LOCK_TIMEOUT_MS],
    DEFAULT_LOCK_TIMEOUT_MS,
  );
  switch (process.platform) {
    case "darwin":
      return lockWithOpenFlag(lockPath, timeoutMs);
    case "linux":
      return lockWithFlockCommand(lockPath, env, timeoutMs);
    case "win32":
      return lockWithPowerShell(lockPath, env, timeoutMs);
    default:
      return noLock;
  }
}

// Resolves once the lock has been released.
type Unlock = () => Promise<void>;

const noLock: Unlock = async () => {
  // Nothing to unlock.
};

// macOS can take a flock(2) lock when opening a file. Node.js does not expose
// the constant, but passes the flags on as-is.
const O_EXLOCK = 0x20;

async function lockWithOpenFlag(
  lockPath: string,
  timeoutMs: number,
): Promise<Unlock | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fd = fs.openSync(
        lockPath,
        fs.constants.O_RDONLY | O_EXLOCK | fs.constants.O_NONBLOCK,
      );
      return () => {
        fs.closeSync(fd);
        return Promise.resolve();
      };
    } catch (unknownError) {
      const error = unknownError as NodeJS.ErrnoException;
      if (error.code !== "EAGAIN" || Date.now() > deadline) {
        return error.code === "EAGAIN" ? undefined : noLock;
      }
    }
    await sleep(LOCK_POLL_INTERVAL_MS);
  }
}

// Node.js cannot take a flock(2) lock on Linux, so let the `flock` command
// (from util-linux, or busybox) hold it for us. Busybox’s `flock` has no
// `--wait` option, so we time out ourselves.
async function lockWithFlockCommand(
  lockPath: string,
  env: Env,
  timeoutMs: number,
): Promise<Unlock | undefined> {
  return lockWithHelper(
    "flock",
    [lockPath, "sh", "-c", "echo locked && exec cat"],
    env,
    timeoutMs,
  );
}

// Elm locks the first byte of the lock file with LockFileEx on Windows, which
// Node.js cannot do. PowerShell can (`FileStream.Lock` uses LockFile, which
// conflicts with LockFileEx). The file is opened with the same sharing as Elm
// does, so that Elm can open it while we have it open, and vice versa.
const POWERSHELL_LOCK_SCRIPT = `
$file = [IO.File]::Open($env:ELM_WATCH_LOCK_PATH, 'OpenOrCreate', 'ReadWrite', 'ReadWrite')
while ($true) {
  try { $file.Lock(0, 1); break }
  catch [IO.IOException] { Start-Sleep -Milliseconds ${LOCK_POLL_INTERVAL_MS} }
}
[Console]::Out.WriteLine('locked')
[Console]::Out.Flush()
[void][Console]::In.ReadToEnd()
`;

async function lockWithPowerShell(
  lockPath: string,
  env: Env,
  timeoutMs: number,
): Promise<Unlock | undefined> {
  return lockWithHelper(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      // Avoids escaping problems: Base64 of UTF-16LE.
      "-EncodedCommand",
      Buffer.from(POWERSHELL_LOCK_SCRIPT, "utf16le").toString("base64"),
    ],
    { ...env, ELM_WATCH_LOCK_PATH: lockPath },
    timeoutMs,
  );
}

// Runs a command that takes the lock, prints a line once it has it, and holds
// the lock until stdin is closed.
async function lockWithHelper(
  command: string,
  args: Array<string>,
  env: Env,
  timeoutMs: number,
): Promise<Unlock | undefined> {
  return new Promise((resolve) => {
    const child = childProcess.spawn(command, args, {
      stdio: ["pipe", "pipe", "ignore"],
      env,
      windowsHide: true,
    });
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.on("error", () => {
      // The command does not exist.
      clearTimeout(timeoutId);
      resolve(noLock);
    });
    child.stdout.once("data", () => {
      clearTimeout(timeoutId);
      const exited = new Promise<void>((resolveExited) => {
        child.once("exit", () => {
          resolveExited();
        });
      });
      resolve(async () => {
        // The command exits, releasing the lock. Wait for that: On Windows,
        // the lock is mandatory, so the lock file cannot even be read until
        // then.
        child.stdin.end();
        await exited;
      });
    });
    child.on("exit", () => {
      // Exited before getting the lock: Either we timed out, or the command
      // could not be used (then recover without the lock).
      clearTimeout(timeoutId);
      resolve(timedOut ? undefined : noLock);
    });
  });
}

async function withTimeout(
  promise: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  let timeoutId: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
    }),
  ]);
  clearTimeout(timeoutId);
  return result;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getCompilerDirs(elmStuff: string, compiler: Compiler): Array<string> {
  let entries: Array<fs.Dirent>;
  try {
    entries = fs.readdirSync(elmStuff, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) =>
        entry.isDirectory() && compilerDirRegexes[compiler].test(entry.name),
    )
    .map((entry) => entry.name);
}
