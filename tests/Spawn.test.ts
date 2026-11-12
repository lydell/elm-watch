import * as childProcess from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import type { Env } from "../src/Env.ts";
import { IS_WINDOWS } from "../src/IsWindows.ts";
import { findOnWindowsPath, windowsEscape } from "../src/Spawn.ts";
import { markAsAbsolutePath } from "../src/Types.ts";
import { waitFor } from "./Helpers.ts";

// `findOnWindowsPath` and `windowsEscape` are only used on Windows, so they are
// tested directly here (using `path.win32` and a fake file system) to make the
// tests run on any platform.

const cwd = markAsAbsolutePath("C:\\project");

function find(env: Env, files: Array<string>): string | undefined {
  const fileSet = new Set(files);
  return findOnWindowsPath("elm", cwd, env, path.win32, (file) =>
    fileSet.has(file),
  );
}

describe("findOnWindowsPath", () => {
  test("not found", () => {
    expect(find({}, ["C:\\bin\\elm.exe"])).toBeUndefined();
    expect(find({ PATH: "" }, ["C:\\bin\\elm.exe"])).toBeUndefined();
    expect(find({ PATH: "C:\\bin" }, [])).toBeUndefined();
    // Only files with an extension from PATHEXT count.
    expect(find({ PATH: "C:\\bin" }, ["C:\\bin\\elm"])).toBeUndefined();
  });

  test("default PATHEXT order", () => {
    const env = { PATH: "C:\\bin" };
    expect(find(env, ["C:\\bin\\elm.CMD", "C:\\bin\\elm.EXE"])).toBe(
      "C:\\bin\\elm.EXE",
    );
    expect(find(env, ["C:\\bin\\elm.CMD", "C:\\bin\\elm.BAT"])).toBe(
      "C:\\bin\\elm.BAT",
    );
    expect(find(env, ["C:\\bin\\elm.EXE", "C:\\bin\\elm.COM"])).toBe(
      "C:\\bin\\elm.COM",
    );
  });

  test("custom PATHEXT, ignoring empty entries", () => {
    expect(
      find({ PATH: "C:\\bin", PATHEXT: ";.CMD;;.EXE;" }, [
        "C:\\bin\\elm.CMD",
        "C:\\bin\\elm.EXE",
      ]),
    ).toBe("C:\\bin\\elm.CMD");
  });

  test("earlier PATH entries win, regardless of extension", () => {
    expect(
      find({ PATH: "C:\\first;C:\\second" }, [
        "C:\\first\\elm.CMD",
        "C:\\second\\elm.EXE",
      ]),
    ).toBe("C:\\first\\elm.CMD");
  });

  test("quoted and empty PATH entries", () => {
    expect(
      find({ PATH: ';;"C:\\Program Files\\Elm";' }, [
        "C:\\Program Files\\Elm\\elm.EXE",
      ]),
    ).toBe("C:\\Program Files\\Elm\\elm.EXE");
  });

  test("relative PATH entries are resolved from cwd", () => {
    expect(
      find({ PATH: "node_modules\\.bin" }, [
        "C:\\project\\node_modules\\.bin\\elm.CMD",
      ]),
    ).toBe("C:\\project\\node_modules\\.bin\\elm.CMD");
  });

  test("environment variable names are case insensitive", () => {
    expect(
      find({ Path: "C:\\bin", PathExt: ".CMD" }, [
        "C:\\bin\\elm.CMD",
        "C:\\bin\\elm.EXE",
      ]),
    ).toBe("C:\\bin\\elm.CMD");
  });

  test("the first environment variable name in sorted order wins, like Node.js", () => {
    // "PATH" sorts before "Path", which sorts before "path".
    const files = ["C:\\upper\\elm.EXE", "C:\\mixed\\elm.EXE"];
    expect(find({ path: "C:\\lower", Path: "C:\\mixed" }, files)).toBe(
      "C:\\mixed\\elm.EXE",
    );
    expect(
      find({ path: "C:\\lower", Path: "C:\\mixed", PATH: "C:\\upper" }, files),
    ).toBe("C:\\upper\\elm.EXE");
  });
});

describe("windowsEscape", () => {
  test("wraps in double quotes", () => {
    expect(windowsEscape("--output=/dev/null")).toBe('"--output=/dev/null"');
    expect(windowsEscape("C:\\My Project\\src\\Main.elm")).toBe(
      '"C:\\My Project\\src\\Main.elm"',
    );
    expect(windowsEscape("")).toBe('""');
  });

  test("characters special to cmd.exe are quoted", () => {
    expect(windowsEscape("a & b | c > d < e ^ f")).toBe(
      '"a & b | c > d < e ^ f"',
    );
  });

  test("percent signs are left outside the quotes, so variables aren't expanded", () => {
    expect(windowsEscape("Hi %PATH%")).toBe('"Hi "%"PATH"%""');
    expect(windowsEscape("100%")).toBe('"100"%""');
  });
});

describe("children are killed when exiting", () => {
  // Don’t leave never-ending processes behind if a test fails.
  const pidsToCleanUp: Array<number> = [];
  const dirsToCleanUp: Array<string> = [];
  afterEach(() => {
    for (const pid of pidsToCleanUp.splice(0)) {
      if (isAlive(pid)) {
        process.kill(pid, "SIGKILL");
      }
    }
    for (const dir of dirsToCleanUp.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // Runs SpawnExitScript.ts in a separate process, since the tests are about
  // that process exiting.
  async function runScript(mode: "exit" | "wait" | "listen"): Promise<{
    script: childProcess.ChildProcess;
    exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
    stdout: () => string;
    childPid: number;
  }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "elm-watch-spawn-"));
    dirsToCleanUp.push(dir);
    const pidFile = path.join(dir, "pid");
    const script = childProcess.spawn(
      process.execPath,
      [path.join(import.meta.dirname, "SpawnExitScript.ts"), mode, pidFile],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    let stdout = "";
    script.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      script.on("exit", (code, signal) => {
        resolve({ code, signal });
      });
    });
    if (script.pid !== undefined) {
      pidsToCleanUp.push(script.pid);
    }
    await waitFor(() => stdout.includes("ready"));
    const childPid = Number(fs.readFileSync(pidFile, "utf8"));
    pidsToCleanUp.push(childPid);
    return {
      script,
      exited,
      stdout: () => stdout,
      childPid,
    };
  }

  function isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  test("process.exit", async () => {
    const { exited, childPid } = await runScript("exit");
    expect(await exited).toStrictEqual({ code: 1, signal: null });
    await waitFor(() => !isAlive(childPid));
  });

  // Windows does not have real signals.
  describe.skipIf(IS_WINDOWS)("signals", () => {
    test.each(["SIGINT", "SIGHUP", "SIGTERM"] as const)(
      "%s exits by the signal, like by default",
      async (signal) => {
        const { script, exited, childPid } = await runScript("wait");
        script.kill(signal);
        expect(await exited).toStrictEqual({ code: null, signal });
        await waitFor(() => !isAlive(childPid));
      },
    );

    test("other listeners decide what happens", async () => {
      const { script, exited, stdout, childPid } = await runScript("listen");
      script.kill("SIGTERM");
      expect(await exited).toStrictEqual({ code: 0, signal: null });
      expect(stdout()).toBe("ready\nchild alive: true\n");
      await waitFor(() => !isAlive(childPid));
    });
  });
});
