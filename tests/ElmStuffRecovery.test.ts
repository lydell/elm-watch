import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { afterElm, beforeElm, lockElmStuff } from "../src/ElmStuffRecovery.ts";
import { __ELM_WATCH_ELM_STUFF_LOCK_TIMEOUT_MS, type Env } from "../src/Env.ts";
import type { Command, SpawnResult } from "../src/Spawn.ts";
import {
  type Compiler,
  type ElmJsonPath,
  markAsAbsolutePath,
  markAsElmJsonPath,
} from "../src/Types.ts";
import { wait } from "./Helpers.ts";

// Real environment: Taking the lock needs `flock` on Linux and PowerShell on
// Windows.
const env: Env = process.env;

let dir = "";
let elmJsonPath: ElmJsonPath;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "elm-watch-ElmStuffRecovery-"));
  elmJsonPath = markAsElmJsonPath(
    markAsAbsolutePath(path.join(dir, "elm.json")),
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const command: Command = {
  command: "elm",
  args: [],
  options: { cwd: markAsAbsolutePath(dir), env: {} },
};

const exitCode0: SpawnResult = {
  tag: "Exit",
  exitReason: { tag: "ExitCode", exitCode: 0 },
  stdout: Buffer.from(""),
  stderr: Buffer.from(""),
  command,
};

const exitSignal: SpawnResult = {
  tag: "Exit",
  exitReason: { tag: "Signal", signal: "SIGKILL" },
  stdout: Buffer.from(""),
  stderr: Buffer.from(""),
  command,
};

const killed: SpawnResult = { tag: "Killed", command };

const past = new Date(Date.now() - 60_000);
const future = new Date(Date.now() + 60_000);

// Files written by a previous `elm` run, before the current one started.
function writeOld(file: string, content = "old"): void {
  const filePath = path.join(dir, "elm-stuff", file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  fs.utimesSync(filePath, past, past);
}

// Files written by another `elm`, after d.dat but before the current `elm` run
// started.
function writeByOther(file: string, content = "other"): void {
  const filePath = path.join(dir, "elm-stuff", file);
  const time = new Date(Date.now() - 30_000);
  fs.writeFileSync(filePath, content);
  fs.utimesSync(filePath, time, time);
}

// Files written by the current `elm` run.
function writeNew(file: string, content = "new"): void {
  const filePath = path.join(dir, "elm-stuff", file);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  fs.utimesSync(filePath, future, future);
}

function listElmStuff(): Record<string, string> {
  const result: Record<string, string> = {};
  const elmStuff = path.join(dir, "elm-stuff");
  for (const file of fs.readdirSync(elmStuff, {
    recursive: true,
    encoding: "utf8",
  })) {
    const filePath = path.join(elmStuff, file);
    if (!file.startsWith("elm-watch") && fs.statSync(filePath).isFile()) {
      result[file.split(path.sep).join("/")] = fs.readFileSync(
        filePath,
        "utf8",
      );
    }
  }
  return result;
}

// Holds the lock, like another `elm` would.
async function holdLock(lockPath: string): Promise<() => Promise<void>> {
  if (process.platform === "win32") {
    // Uses PowerShell, just like the code under test.
    const unlock = await lockElmStuff(path.dirname(lockPath), env);
    if (unlock === undefined) {
      throw new Error("Failed to take the lock.");
    }
    return unlock;
  }
  if (process.platform === "darwin") {
    // O_EXLOCK
    const fd = fs.openSync(lockPath, fs.constants.O_RDONLY | 0x20);
    return () => {
      fs.closeSync(fd);
      return Promise.resolve();
    };
  }
  const child = childProcess.spawn(
    "flock",
    [lockPath, "sh", "-c", "echo locked && exec cat"],
    {
      stdio: ["pipe", "pipe", "inherit"],
    },
  );
  await new Promise((resolve) => {
    child.stdout.once("data", resolve);
  });
  const exited = new Promise((resolve) => {
    child.once("exit", resolve);
  });
  return async () => {
    child.stdin.end();
    await exited;
  };
}

async function runElm(
  compiler: Compiler,
  spawnResult: SpawnResult,
  writeFiles: () => void,
): Promise<void> {
  await beforeElm(elmJsonPath, compiler, env);
  writeFiles();
  await afterElm(elmJsonPath, compiler, spawnResult, Promise.resolve(), env);
}

function writeCompiledProject(): void {
  writeOld("0.19.3/lock", "");
  writeOld("0.19.3/d.dat", "old d.dat");
  writeOld("0.19.3/i.dat");
  writeOld("0.19.3/o.dat");
  writeOld("0.19.3/A.elmi");
  writeOld("0.19.3/A.elmo");
  writeOld("0.19.3/B.elmi");
  writeOld("0.19.3/B.elmo");
}

describe("ElmStuffRecovery", () => {
  test("elm exits normally: nothing is removed", async () => {
    writeCompiledProject();

    await runElm("elm", exitCode0, () => {
      writeNew("0.19.3/d.dat", "new d.dat");
      writeNew("0.19.3/A.elmi");
      writeNew("0.19.3/A.elmo");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/A.elmi": "new",
        "0.19.3/A.elmo": "new",
        "0.19.3/B.elmi": "old",
        "0.19.3/B.elmo": "old",
        "0.19.3/d.dat": "new d.dat",
        "0.19.3/i.dat": "old",
        "0.19.3/lock": "",
        "0.19.3/o.dat": "old",
      }
    `);
  });

  test("killed while compiling: removes what elm wrote", async () => {
    writeCompiledProject();

    await runElm("elm", killed, () => {
      writeNew("0.19.3/A.elmo", "half");
      writeNew("0.19.3/C.elmi");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/A.elmi": "old",
        "0.19.3/B.elmi": "old",
        "0.19.3/B.elmo": "old",
        "0.19.3/d.dat": "old d.dat",
        "0.19.3/i.dat": "old",
        "0.19.3/lock": "",
        "0.19.3/o.dat": "old",
      }
    `);
  });

  test("killed after writing d.dat: restores d.dat", async () => {
    writeCompiledProject();

    await runElm("elm", exitSignal, () => {
      writeNew("0.19.3/A.elmi");
      writeNew("0.19.3/A.elmo");
      writeNew("0.19.3/d.dat", "half");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/B.elmi": "old",
        "0.19.3/B.elmo": "old",
        "0.19.3/d.dat": "old d.dat",
        "0.19.3/i.dat": "old",
        "0.19.3/lock": "",
        "0.19.3/o.dat": "old",
      }
    `);
  });

  test("another elm wrote files before ours started: removes them too", async () => {
    writeCompiledProject();
    // For example, an AI agent type checking. It wrote the new .elmi of a
    // changed module. If kept, the next `elm` would think that the interface
    // did not change, and not recompile the modules depending on it.
    writeByOther("0.19.3/A.elmi");

    await runElm("elm", killed, () => {
      writeNew("0.19.3/B.elmo", "half");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/A.elmo": "old",
        "0.19.3/B.elmi": "old",
        "0.19.3/d.dat": "old d.dat",
        "0.19.3/i.dat": "old",
        "0.19.3/lock": "",
        "0.19.3/o.dat": "old",
      }
    `);
  });

  test("killed while installing dependencies: removes everything", async () => {
    writeCompiledProject();

    await runElm("elm", killed, () => {
      writeNew("0.19.3/i.dat", "half");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/lock": "",
      }
    `);
    // The directory itself is kept, since removing it makes elm-watch restart.
    expect(fs.existsSync(path.join(dir, "elm-stuff", "0.19.3"))).toBe(true);
  });

  test("killed after writing d.dat for the first time: removes everything", async () => {
    await runElm("elm", killed, () => {
      writeNew("0.19.3/lock", "");
      writeNew("0.19.3/i.dat");
      writeNew("0.19.3/o.dat");
      writeNew("0.19.3/A.elmi");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/lock": "",
      }
    `);

    writeOld("0.19.3/i.dat");
    writeOld("0.19.3/o.dat");

    await runElm("elm", killed, () => {
      writeNew("0.19.3/A.elmi");
      writeNew("0.19.3/d.dat", "half");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/lock": "",
      }
    `);
  });

  test("elm-watch itself was killed: recovers before the next run", async () => {
    writeCompiledProject();

    await beforeElm(elmJsonPath, "elm", env);
    writeNew("0.19.3/A.elmo", "half");
    // No `afterElm`, like when elm-watch is killed with SIGKILL.

    expect(
      fs.existsSync(
        path.join(dir, "elm-stuff", "elm-watch", "running-elm", "started"),
      ),
    ).toBe(true);

    await beforeElm(elmJsonPath, "elm", env);

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/A.elmi": "old",
        "0.19.3/B.elmi": "old",
        "0.19.3/B.elmo": "old",
        "0.19.3/d.dat": "old d.dat",
        "0.19.3/i.dat": "old",
        "0.19.3/lock": "",
        "0.19.3/o.dat": "old",
      }
    `);
  });

  // Elm takes a flock(2) lock on elm-stuff/0.19.x/lock (LockFileEx on
  // Windows).
  test("waits for another elm holding the lock", async () => {
    writeCompiledProject();
    await beforeElm(elmJsonPath, "elm", env);
    writeNew("0.19.3/A.elmo", "half");

    const release = await holdLock(
      path.join(dir, "elm-stuff", "0.19.3", "lock"),
    );
    let done = false;
    const promise = afterElm(
      elmJsonPath,
      "elm",
      killed,
      Promise.resolve(),
      env,
    ).then(() => {
      done = true;
    });

    await wait(200);
    expect(done).toBe(false);
    // Not `listElmStuff()`: On Windows, the lock file cannot be read while
    // locked.
    expect(
      fs.readFileSync(path.join(dir, "elm-stuff", "0.19.3", "A.elmo"), "utf8"),
    ).toBe("half");

    await release();
    await promise;
    expect(listElmStuff()["0.19.3/A.elmo"]).toBeUndefined();
  });

  test("gives up if another elm holds the lock for too long, and tries again before the next run", async () => {
    writeCompiledProject();
    await beforeElm(elmJsonPath, "elm", env);
    writeNew("0.19.3/A.elmo", "half");

    const release = await holdLock(
      path.join(dir, "elm-stuff", "0.19.3", "lock"),
    );
    await afterElm(elmJsonPath, "elm", killed, Promise.resolve(), {
      ...env,
      [__ELM_WATCH_ELM_STUFF_LOCK_TIMEOUT_MS]: "100",
    });

    // Nothing was touched, and the marker is kept.
    // Not `listElmStuff()`: On Windows, the lock file cannot be read while
    // locked.
    expect(
      fs.readFileSync(path.join(dir, "elm-stuff", "0.19.3", "A.elmo"), "utf8"),
    ).toBe("half");
    expect(
      fs.existsSync(
        path.join(dir, "elm-stuff", "elm-watch", "running-elm", "started"),
      ),
    ).toBe(true);

    await release();
    await beforeElm(elmJsonPath, "elm", env);
    expect(listElmStuff()["0.19.3/A.elmo"]).toBeUndefined();
  });

  // macOS takes the lock without a helper command.
  test.skipIf(process.platform === "darwin")(
    "recovers without the lock if the lock command is missing",
    async () => {
      writeCompiledProject();
      // No `flock` (Linux) or `powershell.exe` (Windows) on PATH. (Windows
      // calls it `Path`, and would look up commands in our own PATH if the
      // given environment had none.)
      const envWithoutPath: Env = {
        ...Object.fromEntries(
          Object.entries(env).filter(([key]) => key.toUpperCase() !== "PATH"),
        ),
        PATH: path.join(dir, "nonexistent"),
      };

      await beforeElm(elmJsonPath, "elm", envWithoutPath);
      writeNew("0.19.3/A.elmo", "half");
      await afterElm(
        elmJsonPath,
        "elm",
        killed,
        Promise.resolve(),
        envWithoutPath,
      );

      expect(listElmStuff()["0.19.3/A.elmo"]).toBeUndefined();
    },
  );

  test("elm only touches elm’s directories", async () => {
    writeOld("0.19.3/d.dat");
    writeOld("lamdera-1.5.0-0.19.3/d.dat");
    writeOld("elm-test-rs/A.elmi");

    await runElm("elm", killed, () => {
      writeNew("0.19.3/A.elmi");
      writeNew("lamdera-1.5.0-0.19.3/A.elmi");
      writeNew("elm-test-rs/B.elmi");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.3/d.dat": "old",
        "elm-test-rs/A.elmi": "old",
        "elm-test-rs/B.elmi": "new",
        "lamdera-1.5.0-0.19.3/A.elmi": "new",
        "lamdera-1.5.0-0.19.3/d.dat": "old",
      }
    `);
  });

  test("lamdera touches both lamdera-x-0.19.x/ and (older Lamdera) 0.19.x/", async () => {
    writeOld("0.19.1/d.dat");
    writeOld("0.19.1/A.elmi");
    writeOld("lamdera-1.5.0-0.19.3/d.dat");

    await runElm("lamdera", killed, () => {
      writeNew("0.19.1/B.elmi");
      writeNew("lamdera-1.5.0-0.19.3/A.elmi");
    });

    expect(listElmStuff()).toMatchInlineSnapshot(`
      {
        "0.19.1/A.elmi": "old",
        "0.19.1/d.dat": "old",
        "lamdera-1.5.0-0.19.3/d.dat": "old",
      }
    `);
  });
});
