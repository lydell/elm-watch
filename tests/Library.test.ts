import * as fs from "fs";
import * as net from "net";
import * as path from "path";
import { describe, expect, test } from "vitest";

import type { HotTestHooks } from "../src/Hot.ts";
import { createErrorReporter, elmWatch } from "../src/index.ts";
import { copyFixture } from "./FixtureCopies.ts";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  logDebug,
  MemoryWriteStream,
  SilentReadStream,
  stringSnapshotSerializer,
  TEST_ENV,
  waitFor,
} from "./Helpers.ts";

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
          type: "application",
          name: "Sync",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "build/sync.js",
          postprocess: (code: string, info: unknown) => {
            calls.push(info);
            return `// sync\n${code}`;
          },
        },
        {
          type: "application",
          name: "Async",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "build/async.js",
          postprocess: (code: string) =>
            Promise.resolve(`// async\n${code.length}`),
        },
        {
          type: "application",
          name: "None",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "build/none.js",
        },
      ],
    }));

    expect(stdout).toMatchInlineSnapshot(`
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

  test("optional options can be set to undefined", async () => {
    const { stdout } = await run(0, (root) => ({
      root,
      runMode: "make",
      compilationMode: undefined,
      targets: [
        {
          type: "application",
          name: "main",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "build/main.js",
          postprocess: undefined,
        },
      ],
      port: undefined,
      host: undefined,
      staticFilesDir: undefined,
      webSocketUrl: undefined,
      allowedHosts: undefined,
      createServer: undefined,
    }));

    expect(stdout).toMatchInlineSnapshot(`
      ✅ main⧙                                                        1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("already aborted signal", async () => {
    const { stdout } = await run(0, (root) => ({
      root,
      runMode: "hot",
      targets: [
        {
          type: "application",
          name: "main",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "build/main.js",
        },
      ],
      signal: AbortSignal.abort(),
    }));

    expect(stdout).toBe("");
  });

  describe("port option in hot mode", () => {
    async function getFreePort(): Promise<number> {
      const server = net.createServer();
      await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address() as net.AddressInfo;
      await new Promise((resolve) => {
        server.close(resolve);
      });
      return port;
    }

    // Runs hot mode with `port` until stuff.json has been written, and returns
    // stuff.json.
    async function runHot(
      root: string,
      port: number,
    ): Promise<Record<string, unknown>> {
      const stuffJsonPath = path.join(
        root,
        "elm-stuff",
        "elm-watch",
        "stuff.json",
      );
      const readStuffJson = (): string | undefined => {
        try {
          return fs.readFileSync(stuffJsonPath, "utf8");
        } catch {
          return undefined;
        }
      };
      let isIdle = false;
      const hotTestHooks: HotTestHooks = {
        kill: undefined,
        onUpdate: (_msg, idle) => {
          isIdle = idle;
        },
      };
      const stderr = new MemoryWriteStream();
      const done = elmWatch({
        root,
        runMode: "hot",
        targets: [
          {
            type: "application",
            name: "main",
            elmJson: "elm.json",
            inputs: ["src/Main.elm"],
            output: "build/main.js",
          },
        ],
        port,
        env: { ...process.env, ...TEST_ENV },
        stdin: new SilentReadStream(),
        stdout: new CursorWriteStream(),
        stderr,
        logDebug,
        hotTestHooks,
      });
      // elm-watch always writes the web socket token.
      await waitFor(
        () => isIdle && readStuffJson()?.includes("webSocketToken") === true,
      );
      await hotTestHooks.kill?.();
      await done;
      expect(stderr.content).toBe("");
      return JSON.parse(readStuffJson() ?? "") as Record<string, unknown>;
    }

    test("keeps the previously saved port", async () => {
      const root = copyFixture(".", "library");
      fs.mkdirSync(path.join(root, "elm-stuff", "elm-watch"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(root, "elm-stuff", "elm-watch", "stuff.json"),
        JSON.stringify({ port: 9876, targets: {} }),
      );
      const stuffJson = await runHot(root, await getFreePort());
      expect(stuffJson["port"]).toBe(9876);
    });

    test("saves no port if there was none", async () => {
      const root = copyFixture(".", "library");
      const stuffJson = await runHot(root, await getFreePort());
      expect(Object.keys(stuffJson)).toStrictEqual([
        "webSocketToken",
        "targets",
      ]);
    });
  });

  test("postprocess function throws", async () => {
    const { stdout } = await run(1, (root) => ({
      root,
      runMode: "make",
      targets: [
        {
          type: "application",
          name: "main",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "build/main.js",
          postprocess: () => {
            // oxlint-disable-next-line typescript/only-throw-error
            throw "Something went wrong";
          },
        },
      ],
    }));

    expect(stdout).toMatchInlineSnapshot(`
      🚨 main

      ⧙── POSTPROCESS ERROR ───────────────────────────────────────────────────────────⧘
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
          type: "application",
          name: "main",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "build/main.js",
          postprocess: () => Promise.resolve({ code: "" }),
        },
      ],
    }));

    expect(stdout).toMatchInlineSnapshot(`
      🚨 main

      ⧙── INVALID POSTPROCESS RESULT ──────────────────────────────────────────────────⧘
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
        {
          type: "application",
          name: "a",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "build/main.js",
        },
        {
          type: "application",
          name: "b",
          elmJson: "elm.json",
          inputs: ["src/Main.elm"],
          output: "./build/main.js",
        },
      ],
    }));

    expect(stdout).toMatchInlineSnapshot(`
      ⧙── DUPLICATE OUTPUTS ───────────────────────────────────────────────────────────⧘

      Some of your outputs seem to be duplicates!

      build/main.js
      ./build/main.js
      -> /Users/you/project/tests/fixtures/library/build/main.js

      Make sure every output is listed just once!
    `);
  });

  describe("invalid options", () => {
    const target = {
      type: "application",
      name: "main",
      elmJson: "elm.json",
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
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["root"]:
        Expected an absolute path (for example \`import.meta.dirname\`)
        Got: "."
      `);
    });

    test("package target with application fields", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [{ ...target, type: "package" }],
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["targets"][0]:
        Expected only these fields:
          "type",
          "name",
          "elmJson",
          "compiler"
        Found extra fields:
          "inputs",
          "output"
      `);
    });

    test("elmJson must point to elm.json", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [{ ...target, elmJson: "." }],
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["targets"][0]["elmJson"]:
        Expected a path to a file called elm.json
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
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root:
        Expected only these fields:
          "runMode",
          "compilationMode",
          "root",
          "targets",
          "port",
          "host",
          "staticFilesDir",
          "webSocketUrl",
          "allowedHosts",
          "errors",
          "createServer",
          "signal",
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
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

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
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

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
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["targets"][0]["postprocess"]:
        Expected a function
        Got: [
          "elm-watch-node",
          "a.js"
        ]
        Or expected: undefined
      `);
    });

    test("openEditor is not an option (use ELM_WATCH_OPEN_EDITOR)", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [target],
        openEditor: 'code --goto "$file:$line:$column"',
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root:
        Expected only these fields:
          "runMode",
          "compilationMode",
          "root",
          "targets",
          "port",
          "host",
          "staticFilesDir",
          "webSocketUrl",
          "allowedHosts",
          "errors",
          "createServer",
          "signal",
          "env",
          "stdin",
          "stdout",
          "stderr"
        Found extra fields:
          "openEditor"
      `);
    });
  });

  describe("external errors", () => {
    const target = {
      type: "application",
      name: "main",
      elmJson: "elm.json",
      inputs: ["src/Main.elm"],
      output: "build/main.js",
    };

    test("make fails if there are errors at the end", async () => {
      const errors = createErrorReporter();
      errors.set("esbuild", [
        {
          message:
            "\nExpected \x1B[1m;\x1B[0m but found \x1B[31mfoo\x1B[0m\x1B[2J\n\n",
          location: { file: "ts/main.ts", line: 12, column: 9 },
        },
        { message: "Only a file", location: { file: "/absolute/file.ts" } },
      ]);
      errors.set("translations", [{ message: "Missing key: goodbye" }]);
      errors.set("cleared", [{ message: "Not shown" }]);
      errors.set("cleared", []);
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [
          {
            ...target,
            // Errors set while compiling count too.
            postprocess: (code: string) => {
              errors.set("postprocess", [{ message: "Set while compiling" }]);
              return code;
            },
          },
        ],
        errors,
      }));
      expect(stdout).toMatchInlineSnapshot(`
        🚨 esbuild
        🚨 translations
        ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

        ⧙── ESBUILD ─────────────────────────────────────────────────────────────────────⧘
        /Users/you/project/tests/fixtures/library/ts/main.ts:12:9

        Expected ⧙;⧘ but found ⧙foo⧘⧘

        ⧙── ESBUILD ─────────────────────────────────────────────────────────────────────⧘
        /absolute/file.ts

        Only a file

        ⧙── TRANSLATIONS ────────────────────────────────────────────────────────────────⧘

        Missing key: goodbye

        ⧙── POSTPROCESS ─────────────────────────────────────────────────────────────────⧘

        Set while compiling

        🚨 ⧙4⧘ errors found

        🚨 Compilation finished in ⧙123 ms⧘.
      `);
    });

    test("make succeeds if all errors have been cleared", async () => {
      const errors = createErrorReporter();
      errors.set("esbuild", [{ message: "Not shown" }]);
      errors.set("esbuild", []);
      const { stdout } = await run(0, (root) => ({
        root,
        runMode: "make",
        targets: [target],
        errors,
      }));
      expect(stdout).not.toContain("esbuild");
    });

    test("source with the same name as a target", async () => {
      const errors = createErrorReporter();
      errors.set("main", [{ message: "Clash" }]);
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [target],
        errors,
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["errors"]:
        An error source passed to \`set()\` has the same name as a target
        Got: "main"
      `);
      // Now that elm-watch knows the target names, `set` throws instead.
      expect(() => {
        errors.set("main", []);
      }).toThrowErrorMatchingInlineSnapshot(
        `[TypeError: ErrorReporter#set: The source must not have the same name as a target, but got: "main"]`,
      );
    });

    test("not an error reporter", async () => {
      const { stdout } = await run(1, (root) => ({
        root,
        runMode: "make",
        targets: [target],
        errors: { set: () => undefined },
      }));
      expect(stdout).toMatchInlineSnapshot(`
        ⧙── INVALID elm-watch OPTIONS ───────────────────────────────────────────────────⧘

        I got invalid options passed to ⧙elmWatch()⧘:

        At root["errors"]:
        Expected an error reporter from \`createErrorReporter()\`
        Got: {
          "set": function "set"
        }
        Or expected: undefined
      `);
    });

    test("set validates its arguments", () => {
      const errors = createErrorReporter();
      const set = errors.set as (source: unknown, errors: unknown) => void;
      expect(() => {
        set("", []);
      }).toThrowErrorMatchingInlineSnapshot(
        `[TypeError: ErrorReporter#set: Expected the source to be a non-empty, single line string, but got: ""]`,
      );
      expect(() => {
        set("a\nb", []);
      }).toThrowErrorMatchingInlineSnapshot(
        `[TypeError: ErrorReporter#set: Expected the source to be a non-empty, single line string, but got: "a\\nb"]`,
      );
      expect(() => {
        set("esbuild", [{ text: "esbuild uses text, not message" }]);
      }).toThrowErrorMatchingInlineSnapshot(`
        [TypeError: ErrorReporter#set: Invalid errors for "esbuild":

        At root[0]:
        Expected an object with a field called: "message"
        Got: {
          "text": "esbuild uses text, not message"
        }]
      `);
      // Extra fields are allowed, so you can map over objects and only add
      // `message`.
      set("esbuild", [
        { message: "a", extra: 1, location: { file: "a.ts", extra: 2 } },
      ]);
    });
  });
});
