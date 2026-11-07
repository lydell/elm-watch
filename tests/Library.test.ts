import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "vitest";

import { elmWatch } from "../src";
import { copyFixture } from "./FixtureCopies";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  logDebug,
  MemoryWriteStream,
  SilentReadStream,
  stringSnapshotSerializer,
  TEST_ENV,
} from "./Helpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

async function run(
  expectedExitCode: number,
  makeOptions: (root: string) => Record<string, unknown>,
): Promise<{ root: string; stdout: string }> {
  const root = copyFixture(".", "library");

  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();
  stdout.isTTY = true;
  stderr.isTTY = true;

  const exitCode = await elmWatch({
    ...makeOptions(root),
    env: { ...process.env, ...TEST_ENV },
    stdin: new SilentReadStream(),
    stdout,
    stderr,
    logDebug,
  });

  const stdoutString = clean(stdout.getOutput());

  assertExitCode(
    expectedExitCode,
    exitCode,
    stdoutString,
    stderr.content,
    root,
  );
  expect(stderr.content).toBe("");

  return { root, stdout: stdoutString };
}

describe("library", () => {
  test("make with postprocess functions", async () => {
    const calls: Array<unknown> = [];
    const { root, stdout } = await run(0, (dir) => ({
      root: dir,
      runMode: "make",
      compilationMode: "optimize",
      targets: [
        {
          name: "Sync",
          inputs: ["src/Main.elm"],
          output: "build/sync.js",
          postprocess: (code: string, info: unknown) => {
            calls.push(info);
            return `// sync\n${code}`;
          },
        },
        {
          name: "Async",
          inputs: ["src/Main.elm"],
          output: "build/async.js",
          postprocess: (code: string) =>
            Promise.resolve(`// async\n${code.length}`),
        },
        {
          name: "None",
          inputs: ["src/Main.elm"],
          output: "build/none.js",
        },
      ],
    }));

    expect(stdout).toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ Sync⧙   88.5 KiB → 88.5 KiB (100.0 %)     1 ms Q | 1.23 s E |   0 ms R | 31.2…⧘
      ✅ Async⧙   88.5 KiB → 0.01 KiB (0.0 %)     1 ms Q | 1.23 s E |   0 ms R | 31.2 …⧘
      ✅ None⧙                                           88.5 KiB     1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
    expect(calls).toStrictEqual([
      { compilationMode: "optimize", runMode: "make" },
    ]);
    const read = (file: string): string =>
      fs.readFileSync(path.join(root, "build", file), "utf8");
    expect(read("sync.js")).toMatch(/^\/\/ sync\n\(function\(scope\)/);
    expect(read("async.js")).toMatch(/^\/\/ async\n\d+$/);
    expect(read("none.js")).toMatch(/^\(function\(scope\)/);
  });

  test("postprocess function throws", async () => {
    const { stdout } = await run(1, (root) => ({
      root,
      runMode: "make",
      targets: [
        {
          name: "main",
          inputs: ["src/Main.elm"],
          output: "build/main.js",
          postprocess: () => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw "Something went wrong";
          },
        },
      ],
    }));

    expect(stdout).toMatchInlineSnapshot(`
      ✅ Dependencies
      🚨 main

      ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
      ⧙Target: main⧘

      I ran your postprocess function for this target.

      ⧙It threw an error:⧘

      "Something went wrong"

      🚨 ⧙1⧘ error found

      🚨 Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("postprocess function returns a non-string", async () => {
    const { stdout } = await run(1, (root) => ({
      root,
      runMode: "make",
      targets: [
        {
          name: "main",
          inputs: ["src/Main.elm"],
          output: "build/main.js",
          postprocess: () => Promise.resolve({ code: "" }),
        },
      ],
    }));

    expect(stdout).toMatchInlineSnapshot(`
      ✅ Dependencies
      🚨 main

      ⧙-- INVALID POSTPROCESS RESULT --------------------------------------------------⧘
      ⧙Target: main⧘

      I ran your postprocess function for this target.

      I expected it to return a string (or a promise of a string), but it returned:

      {
        "code": ""
      }

      🚨 ⧙1⧘ error found

      🚨 Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("duplicate outputs", async () => {
    const { stdout } = await run(1, (root) => ({
      root,
      runMode: "make",
      targets: [
        { name: "a", inputs: ["src/Main.elm"], output: "build/main.js" },
        { name: "b", inputs: ["src/Main.elm"], output: "./build/main.js" },
      ],
    }));

    expect(stdout).toMatchInlineSnapshot(`
      ⧙-- DUPLICATE OUTPUTS -----------------------------------------------------------⧘

      Some of your outputs seem to be duplicates!

      build/main.js
      ./build/main.js
      -> /Users/you/project/tests/fixtures/library/build/main.js

      Make sure every output is listed just once!
    `);
  });

  describe("invalid options", () => {
    const target = {
      name: "main",
      inputs: ["src/Main.elm"],
      output: "build/main.js",
    };

    test("relative root", async () => {
      const { stdout } = await run(1, () => ({
        root: ".",
        runMode: "make",
        targets: [target],
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch OPTIONS ---------------------------------------------------⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["root"]:
        Expected an absolute path (for example \`import.meta.dirname\`)
        Got: "."
      `);
    });

    test("unknown option", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "hot",
        targets: [target],
        serve: "public",
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch OPTIONS ---------------------------------------------------⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root:
        Expected only these fields:
          "runMode",
          "compilationMode",
          "root",
          "targets",
          "port",
          "staticFilesDir",
          "webSocketUrl",
          "allowedHosts",
          "createServer",
          "env",
          "stdin",
          "stdout",
          "stderr"
        Found extra fields:
          "serve"
      `);
    });

    test("empty targets", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [],
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch OPTIONS ---------------------------------------------------⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["targets"]:
        Expected a non-empty array
        Got: []
      `);
    });

    test("duplicate target names", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [target, { ...target, output: "build/other.js" }],
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch OPTIONS ---------------------------------------------------⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["targets"][1]["name"]:
        Target names must be unique
        Got: "main"
      `);
    });

    test("postprocess is not a function", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [{ ...target, postprocess: ["elm-watch-node", "a.js"] }],
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch OPTIONS ---------------------------------------------------⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["targets"][0]["postprocess"]:
        Expected a function
        Got: [
          "elm-watch-node",
          "a.js"
        ]
      `);
    });

    test("compilationMode in hot mode", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "hot",
        compilationMode: "debug",
        targets: [target],
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch OPTIONS ---------------------------------------------------⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["compilationMode"]:
        compilationMode can only be set when runMode is "make". In "hot" mode, you choose compilation mode in the browser UI.
        Got: "debug"
      `);
    });
  });
});
