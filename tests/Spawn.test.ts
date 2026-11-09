import * as path from "path";
import { describe, expect, test } from "vitest";

import type { Env } from "../src/Env.ts";
import { findOnWindowsPath, windowsEscape } from "../src/Spawn.ts";
import { markAsAbsolutePath } from "../src/Types.ts";

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
