import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";

import { elmWatchCli } from "../src";
import { ElmWatchStuffJsonWritable } from "../src/ElmWatchStuffJson";
import {
  __ELM_WATCH_EXIT_ON_ERROR,
  __ELM_WATCH_MAX_PARALLEL,
  __ELM_WATCH_TMP_DIR,
  Env,
  NO_COLOR,
} from "../src/Env";
import * as Errors from "../src/Errors";
import { toError } from "../src/Helpers";
import {
  assertExitCode,
  badElmBinEnv,
  clean,
  CursorWriteStream,
  FailReadStream,
  logDebug,
  MemoryWriteStream,
  prependPATH,
  rm,
  rmSymlink,
  stringSnapshotSerializer,
  TEST_ENV,
  touch,
  wait,
} from "./Helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "errors");

async function run(
  fixture: string,
  args: Array<string>,
  options?: { env?: Env; isTTY?: boolean; exitHotOnError?: boolean }
): Promise<string> {
  return runAbsolute(path.join(FIXTURES_DIR, fixture), args, options);
}

async function runAbsolute(
  dir: string,
  args: Array<string>,
  {
    env,
    isTTY = true,
    exitHotOnError = false,
  }: { env?: Env; isTTY?: boolean; exitHotOnError?: boolean } = {}
): Promise<string> {
  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const exitCode = await elmWatchCli(args, {
    cwd: dir,
    env: {
      ...(exitHotOnError ? { [__ELM_WATCH_EXIT_ON_ERROR]: "" } : {}),
      ...(env === undefined
        ? {
            ...process.env,
            ...TEST_ENV,
          }
        : env),
    },
    stdin: new FailReadStream(),
    stdout,
    stderr,
    logDebug,
  });

  const stdoutString = clean(stdout.getOutput());

  assertExitCode(1, exitCode, stdoutString, stderr.content);
  expect(stderr.content).toBe("");

  return stdoutString;
}

const elmBinAlwaysSucceedEnv = {
  ...process.env,
  ...TEST_ENV,
  PATH: prependPATH(path.join(__dirname, "fixtures", "elm-bin-always-succeed")),
};

async function runWithBadElmBin(
  fixture: string,
  {
    postprocess = false,
    exitHotOnError = false,
  }: { postprocess?: boolean; exitHotOnError?: boolean } = {}
): Promise<string> {
  const dir = path.join(FIXTURES_DIR, "valid");
  const BUILD = path.join(dir, "build");
  if (fs.rmSync !== undefined) {
    fs.rmSync(BUILD, { recursive: true, force: true });
  } else if (fs.existsSync(BUILD)) {
    fs.rmdirSync(BUILD, { recursive: true });
  }
  return runAbsolute(
    postprocess ? path.join(dir, "postprocess") : dir,
    [exitHotOnError ? "hot" : "make", "app"],
    {
      env: badElmBinEnv(path.join(dir, "bad-bin", fixture)),
      exitHotOnError,
    }
  );
}

async function runWithBadElmBinAndExpectedJson(
  fixture: string,
  expectedWrittenJson: string
): Promise<string> {
  const dir = path.join(FIXTURES_DIR, "valid");
  const jsonPath = path.join(
    dir,
    `elm-watch-ElmMakeJsonParseError-${Errors.sha256(expectedWrittenJson)}.json`
  );

  rm(jsonPath);

  const output = await runAbsolute(dir, ["make", "app"], {
    env: badElmBinEnv(path.join(dir, "bad-bin", fixture)),
  });

  let writtenJson;
  try {
    writtenJson = fs.readFileSync(jsonPath, "utf8");
  } catch (unknownError) {
    const error = toError(unknownError);
    throw new Error(
      `Expected ${jsonPath} to exist.\n\n${error.message}\n\n${output}`
    );
  }
  expect(writtenJson).toBe(expectedWrittenJson);

  return output;
}

function printError(errorTemplate: Errors.ErrorTemplate): string {
  return clean(errorTemplate(80));
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("errors", () => {
  test("unknown command", async () => {
    expect(await run("wherever", ["nope"])).toMatchInlineSnapshot(
      `Unknown command: nope`
    );
  });

  test("elm-watch.json is a folder", async () => {
    expect(await run("elm-watch-json-is-folder", ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING elm-watch.json ----------------------------------------------⧘
      /Users/you/project/tests/fixtures/errors/elm-watch-json-is-folder/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble reading it as JSON:⧘

      EISDIR: illegal operation on a directory, read
    `);
  });

  test("elm-watch.json bad json", async () => {
    expect(await run("elm-watch-json-bad-json", ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING elm-watch.json ----------------------------------------------⧘
      /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-json/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble reading it as JSON:⧘

      Unexpected end of JSON input
    `);
  });

  describe("elm-watch.json decode errors", () => {
    test("empty outputs", async () => {
      expect(await run("elm-watch-json-decode-error/empty-outputs", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/empty-outputs/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]:
        Expected a non-empty object
        Got: {}
      `);
    });

    describe("bad target name", () => {
      test("starts with dash", async () => {
        expect(
          await run("elm-watch-json-bad-target-name/starts-with-dash", ["make"])
        ).toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-target-name/starts-with-dash/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["-main"]:
          Target names must start with a non-whitespace character except \`-\`,
          cannot contain newlines and must end with a non-whitespace character
        `);
      });

      test("starts with whitespace", async () => {
        expect(
          await run("elm-watch-json-bad-target-name/starts-with-whitespace", [
            "make",
          ])
        ).toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-target-name/starts-with-whitespace/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["\\tmain"]:
          Target names must start with a non-whitespace character except \`-\`,
          cannot contain newlines and must end with a non-whitespace character
        `);
      });

      test("contains newline", async () => {
        expect(
          await run("elm-watch-json-bad-target-name/contains-newline", ["make"])
        ).toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-target-name/contains-newline/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["main\\ntarget"]:
          Target names must start with a non-whitespace character except \`-\`,
          cannot contain newlines and must end with a non-whitespace character
        `);
      });

      test("ends with whitespace", async () => {
        expect(
          await run("elm-watch-json-bad-target-name/ends-with-whitespace", [
            "make",
          ])
        ).toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-target-name/ends-with-whitespace/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["main "]:
          Target names must start with a non-whitespace character except \`-\`,
          cannot contain newlines and must end with a non-whitespace character
        `);
      });
    });

    test("bad output extension", async () => {
      expect(
        await run("elm-watch-json-decode-error/bad-output-extension", ["make"])
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/bad-output-extension/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["index"]["output"]:
        Outputs must end with .js
      `);
    });

    test("bad output extension – just .js", async () => {
      // The error message isn’t the best here but this very much an edge case anyway.
      expect(
        await run(
          "elm-watch-json-decode-error/bad-output-extension-just-dot-js",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/bad-output-extension-just-dot-js/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]["output"]:
        Outputs must end with .js
      `);
    });

    test("/dev/null is not a valid output", async () => {
      expect(await run("elm-watch-json-decode-error/bad-dev-null", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/bad-dev-null/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]["output"]:
        Outputs must end with .js
      `);
    });

    test("unknown field", async () => {
      expect(await run("elm-watch-json-decode-error/unknown-field", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/unknown-field/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]:
        Expected only these fields: "inputs", "output"
        Found extra fields: "mode"
      `);
    });

    test("empty list of inputs", async () => {
      expect(await run("elm-watch-json-decode-error/empty-inputs", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/empty-inputs/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]["inputs"]:
        Expected a non-empty array
        Got: []
      `);
    });

    test("bad input extension", async () => {
      expect(
        await run("elm-watch-json-decode-error/bad-input-extension", ["make"])
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/bad-input-extension/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]["inputs"][0]:
        Inputs must have a valid module name and end with .elm
        Got: "src/Main.js"
      `);
    });

    test("bad input module name", async () => {
      expect(
        await run("elm-watch-json-decode-error/bad-input-module-name", ["make"])
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/bad-input-module-name/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]["inputs"][0]:
        Inputs must have a valid module name and end with .elm
        Got: "src/main.elm"
      `);
    });

    test("too low port", async () => {
      expect(await run("elm-watch-json-decode-error/too-low-port", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/too-low-port/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["port"] (optional):
        Expected an integer where 1 <= port <= 65535
        Got: 0
      `);
    });

    test("too high port", async () => {
      expect(await run("elm-watch-json-decode-error/too-high-port", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/too-high-port/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["port"] (optional):
        Expected an integer where 1 <= port <= 65535
        Got: 65536
      `);
    });
  });

  test("elm-watch.json not found", async () => {
    expect(await runAbsolute(path.parse(__dirname).root, ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- elm-watch.json NOT FOUND ----------------------------------------------------⧘

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙But I couldn't find one!⧘

      You need to create one with JSON like this:

      {
          "targets": {
              "MyTargetName": {
                  "inputs": [
                      "src/Main.elm"
                  ],
                  "output": "build/main.js"
              }
          }
      }
    `);
  });

  test("elm-watch.json not found and suggest JSON from args", async () => {
    expect(
      await runAbsolute(path.parse(__dirname).root, [
        "make",
        "src/Game.elm",
        "--output",
        "dist/game.js",
      ])
    ).toMatchInlineSnapshot(`
      ⧙-- elm-watch.json NOT FOUND ----------------------------------------------------⧘

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙But I couldn't find one!⧘

      You need to create one with JSON like this:

      {
          "targets": {
              "MyTargetName": {
                  "inputs": [
                      "src/Game.elm"
                  ],
                  "output": "dist/game.js"
              }
          }
      }
    `);
  });

  describe("suggest JSON from args", () => {
    test("with typical `elm make`-like args", async () => {
      expect(
        await run("valid", [
          "make",
          "src/App.elm",
          "src/Admin.elm",
          "--output",
          "bundle.js",
          "--debug",
        ])
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED FLAGS ------------------------------------------------------------⧘

        The ⧙make⧘ command only accepts the flags ⧙--debug⧘ and ⧙--optimize⧘.

        But you provided these flag-looking args:

        --output

        Try removing those extra flags!

        It looks like your arguments might fit in an ⧙elm make⧘ command.
        If so, you could try moving them to the ⧙elm-watch.json⧘ I found here:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch.json

        For example, you could add some JSON like this:

        {
            "targets": {
                "MyTargetName": {
                    "inputs": [
                        "src/App.elm",
                        "src/Admin.elm"
                    ],
                    "output": "bundle.js"
                }
            }
        }
      `);
    });

    test("no suggesting for unknown flags", async () => {
      expect(
        await run("valid", ["make", "src/App.elm", "--loglevel=silent", "-f"])
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED FLAGS ------------------------------------------------------------⧘

        The ⧙make⧘ command only accepts the flags ⧙--debug⧘ and ⧙--optimize⧘.

        But you provided these flag-looking args:

        --loglevel=silent
        -f

        Try removing those extra flags!
      `);
    });

    test("suggested inputs are relative to elm-watch.json, not cwd", async () => {
      expect(
        await run("valid/src", [
          "hot",
          "src/App.elm",
          "../lib/Admin.elm",
          "--output=dist/main.js",
        ])
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED FLAGS ------------------------------------------------------------⧘

        The ⧙hot⧘ command only accepts no flags at all.

        But you provided these flag-looking args:

        --output=dist/main.js

        Try removing those extra flags!

        It looks like your arguments might fit in an ⧙elm make⧘ command.
        If so, you could try moving them to the ⧙elm-watch.json⧘ I found here:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch.json

        For example, you could add some JSON like this:

        {
            "targets": {
                "MyTargetName": {
                    "inputs": [
                        "src/src/App.elm",
                        "lib/Admin.elm"
                    ],
                    "output": "dist/main.js"
                }
            }
        }
      `);
    });

    test("--output=/dev/null should not be suggested as an output", async () => {
      expect(await run("valid", ["make", "MyMain.elm", "--output=/dev/null"]))
        .toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED FLAGS ------------------------------------------------------------⧘

        The ⧙make⧘ command only accepts the flags ⧙--debug⧘ and ⧙--optimize⧘.

        But you provided these flag-looking args:

        --output=/dev/null

        Try removing those extra flags!
      `);
    });

    test("ignore invalid stuff", async () => {
      expect(
        await run("valid", [
          "make",
          "src/app.elm",
          "--output",
          ".js",
          "--output=.js",
          "ignored.js",
          "--docs",
          "docs.json",
        ])
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED FLAGS ------------------------------------------------------------⧘

        The ⧙make⧘ command only accepts the flags ⧙--debug⧘ and ⧙--optimize⧘.

        But you provided these flag-looking args:

        --output
        --output=.js
        --docs

        Try removing those extra flags!
      `);
    });
  });

  test("Using --debug and --optimize for hot", async () => {
    const output = await run("valid", ["hot", "--debug"]);

    expect(output).toMatchInlineSnapshot(`
      ⧙-- REDUNDANT FLAGS -------------------------------------------------------------⧘

      ⧙--debug⧘ and ⧙--optimize⧘ only make sense for ⧙elm-watch make⧘.
      When using ⧙elm-watch hot⧘, you can switch mode in the browser.
    `);

    expect(await run("valid", ["hot", "--optimize"])).toBe(output);

    expect(await run("valid", ["hot", "--optimize", "--debug"])).toBe(output);
  });

  test("using both --debug and --optimize for make", async () => {
    expect(await run("valid", ["make", "--debug", "--optimize"]))
      .toMatchInlineSnapshot(`
      ⧙-- CLASHING FLAGS --------------------------------------------------------------⧘

      ⧙--debug⧘ and ⧙--optimize⧘ cannot be used at the same time.
    `);
  });

  test("unknown targets", async () => {
    expect(
      await run("valid", ["make", "build/app.js", "build/adnim.js", "app.js"])
    ).toMatchInlineSnapshot(`
      ⧙-- UNKNOWN TARGETS SUBSTRINGS --------------------------------------------------⧘
      /Users/you/project/tests/fixtures/errors/valid/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      It contains these targets:

      app
      admin

      ⧙But none of those match these substrings you gave me:⧘

      build/app.js
      build/adnim.js
      app.js

      Is something misspelled?
      Or do you need to add some more targets?
    `);
  });

  test("duplicate outputs", async () => {
    expect(await run("duplicate-outputs", ["make"])).toMatchInlineSnapshot(`
      ⧙-- DUPLICATE OUTPUTS -----------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/errors/duplicate-outputs/elm-watch.json

      Some of your outputs seem to be duplicates!

      main.js
      ./main.js
      ../duplicate-outputs/main.js
      -> /Users/you/project/tests/fixtures/errors/duplicate-outputs/main.js

      build/app.js
      build//app.js
      -> /Users/you/project/tests/fixtures/errors/duplicate-outputs/build/app.js

      Make sure every output is listed just once!
    `);
  });

  describe("inputs errors", () => {
    test("inputs not found", async () => {
      expect(await run("inputs-not-found", ["make"])).toMatchInlineSnapshot(`
        🚨 main

        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙Target: main⧘

        You asked me to compile these inputs:

        Main.elm ⧙(/Users/you/project/tests/fixtures/errors/inputs-not-found/Main.elm)⧘
        pages/About.elm ⧙(/Users/you/project/tests/fixtures/errors/inputs-not-found/pages/About.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    describe("symlink loop", () => {
      const fixture = "symlink-loop";
      const dir = path.join(FIXTURES_DIR, fixture);
      const symlink1 = path.join(dir, "Main.elm");
      const symlink2 = path.join(dir, "Other.elm");

      function deleteSymlinks(): void {
        rmSymlink(symlink1);
        rmSymlink(symlink2);
      }

      beforeEach(() => {
        deleteSymlinks();
        fs.symlinkSync(symlink1, symlink2);
        fs.symlinkSync(symlink2, symlink1);
      });

      // The symlink loop is deleted when done to avoid this error sometimes happening in other tests:
      // ELOOP: too many symbolic links encountered, stat '/Users/you/project/tests/fixtures/errors/symlink-loop/Other.elm'
      afterEach(deleteSymlinks);

      test("make", async () => {
        expect(await run(fixture, ["make"])).toMatchInlineSnapshot(`
          🚨 main

          ⧙-- INPUTS FAILED TO RESOLVE ----------------------------------------------------⧘
          ⧙Target: main⧘

          I start by checking if the inputs you give me exist,
          but doing so resulted in errors!

          Main.elm:
          ELOOP: too many symbolic links encountered, stat '/Users/you/project/tests/fixtures/errors/symlink-loop/Main.elm'

          ⧙That's all I know, unfortunately!⧘

          🚨 ⧙1⧘ error found

          🚨 Compilation finished in ⧙123⧘ ms.
        `);
      });

      test("hot", async () => {
        expect(await run(fixture, ["hot"])).toMatchInlineSnapshot(`
          🚨 main

          ⧙-- INPUTS FAILED TO RESOLVE ----------------------------------------------------⧘
          ⧙Target: main⧘

          I start by checking if the inputs you give me exist,
          but doing so resulted in errors!

          Main.elm:
          ELOOP: too many symbolic links encountered, stat '/Users/you/project/tests/fixtures/errors/symlink-loop/Main.elm'

          ⧙That's all I know, unfortunately!⧘

          🚨 ⧙1⧘ error found

          📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

          🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
          ⧙-- WATCHER ERROR ---------------------------------------------------------------⧘

          The file watcher encountered an error, which means that it cannot continue.
          elm-watch is powered by its file watcher, so I have to exit at this point.

          See if this is something you can solve by maybe removing some problematic files
          or something!

          This is the error message I got:

          ELOOP: too many symbolic links encountered, stat '/Users/you/project/tests/fixtures/errors/symlink-loop/Main.elm'
        `);
      });
    });

    test("hot failure to read previous output file", async () => {
      expect(await run("output-is-folder", ["hot"], { exitHotOnError: true }))
        .toMatchInlineSnapshot(`
          ✅ Dependencies
          🚨 Main

          ⧙-- TROUBLE READING OUTPUT ------------------------------------------------------⧘
          ⧙Target: Main⧘

          I managed to compile your code. Then I tried to read the output:

          /Users/you/project/tests/fixtures/errors/output-is-folder/output/Main.js

          Doing so I encountered this error:

          EISDIR: illegal operation on a directory, read

          🚨 ⧙1⧘ error found

          📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

          🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
        `);
    });

    test("duplicate inputs", async () => {
      expect(await run("duplicate-inputs", ["make"])).toMatchInlineSnapshot(`
        🚨 main

        ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
        ⧙Target: main⧘

        Some of your inputs seem to be duplicates!

        Main.elm
        ../duplicate-inputs/./Main.elm
        -> /Users/you/project/tests/fixtures/errors/duplicate-inputs/Main.elm

        Make sure every input is listed just once!

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("duplicate inputs with symlinks", async () => {
      expect(await run("duplicate-inputs-with-symlinks", ["make"]))
        .toMatchInlineSnapshot(`
        🚨 main

        ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
        ⧙Target: main⧘

        Some of your inputs seem to be duplicates!

        Main.elm
        Symlink1.elm ⧙(symlink)⧘
        Symlink2.elm ⧙(symlink)⧘
        -> /Users/you/project/tests/fixtures/errors/duplicate-inputs-with-symlinks/Main.elm

        Other.elm
        Other.elm
        -> /Users/you/project/tests/fixtures/errors/duplicate-inputs-with-symlinks/Other.elm

        Make sure every input is listed just once!

        Note that at least one of the inputs seems to be a symlink. They can be tricky!

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });
  });

  describe("elm.json errors", () => {
    test("elm.json not found, with long target name", async () => {
      expect(await run("elm-json-not-found", ["make"])).toMatchInlineSnapshot(`
        🚨 yooooooooooooooooooooooooooooloooooooooooooooooooooooooooooooooooooooooooooo…

        ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
        ⧙Target: yooooooooooooooooooooooooooooloooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo⧘

        I could not find an ⧙elm.json⧘ for these inputs:

        Main.elm
        pages/About.elm

        Has it gone missing? Maybe run ⧙elm init⧘ to create one?

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("elm.json not found for all inputs, with long input name (non-fancy)", async () => {
      expect(
        await run("elm-json-not-found-for-all", ["make"], {
          env: {
            ...process.env,
            ...TEST_ENV,
            [NO_COLOR]: "",
          },
        })
      ).toMatchInlineSnapshot(`
        yoooooooooooooooooooooooooooolooooooooooooooooooooooooooooooooooooooooooooooo...

        -- elm.json NOT FOUND ----------------------------------------------------------
        Target: yooooooooooooooooooooooooooooloooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo

        I could not find an elm.json for these inputs:

        Main.elm

        Has it gone missing? Maybe run elm init to create one?

        Note that I did find an elm.json for some inputs:

        pages/About.elm
        -> /Users/you/project/tests/fixtures/errors/elm-json-not-found-for-all/pages/elm.json

        Make sure that one single elm.json covers all the inputs together!

        1 error found

        Compilation finished in 123 ms.
      `);
    });

    test("non unique elm.json", async () => {
      expect(await run("non-unique-elm-json", ["make"])).toMatchInlineSnapshot(`
        🚨 main

        ⧙-- NO UNIQUE elm.json ----------------------------------------------------------⧘
        ⧙Target: main⧘

        I went looking for an ⧙elm.json⧘ for your inputs, but I found more than one!

        Main.elm
        -> /Users/you/project/tests/fixtures/errors/non-unique-elm-json/elm.json

        pages/About.elm
        -> /Users/you/project/tests/fixtures/errors/non-unique-elm-json/pages/elm.json

        It doesn't make sense to compile Elm files from different projects into one output.

        Either split this target, or move the inputs to the same project with the same
        ⧙elm.json⧘.

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("is a folder", async () => {
      expect(
        await run("elm-json-is-folder", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        })
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 Main

        ⧙-- TROUBLE READING elm.json ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-json-is-folder/elm.json

        I read "source-directories" from ⧙elm.json⧘ when figuring out all Elm files that
        your inputs depend on.

        ⧙I had trouble reading it as JSON:⧘

        EISDIR: illegal operation on a directory, read

        (I still managed to compile your code, but the watcher will not work properly
        and "postprocess" was not run.)

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("bad json", async () => {
      expect(
        await run("elm-json-bad-json", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        })
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 Main

        ⧙-- TROUBLE READING elm.json ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-json-bad-json/elm.json

        I read "source-directories" from ⧙elm.json⧘ when figuring out all Elm files that
        your inputs depend on.

        ⧙I had trouble reading it as JSON:⧘

        Unexpected end of JSON input

        (I still managed to compile your code, but the watcher will not work properly
        and "postprocess" was not run.)

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("decode error", async () => {
      expect(
        await run("elm-json-decode-error", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        })
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 Main

        ⧙-- INVALID elm.json FORMAT -----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-json-decode-error/elm.json

        I read "source-directories" from ⧙elm.json⧘ when figuring out all Elm files that
        your inputs depend on.

        ⧙I had trouble with the JSON inside:⧘

        At root["type"]:
        Expected one of these tags: "application", "package"
        Got: "hackage"

        (I still managed to compile your code, but the watcher will not work properly
        and "postprocess" was not run.)

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      `);
    });
  });

  describe("elm not found", () => {
    test("basic", async () => {
      expect(
        await run("valid", ["make"], {
          env: {
            ...process.env,
            ...TEST_ENV,
            PATH: [__dirname, path.join(__dirname, "some", "bin")].join(
              path.delimiter
            ),
          },
        })
      ).toMatchInlineSnapshot(`
        🚨 Dependencies

        ⧙-- ELM NOT FOUND ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/valid/elm.json

        I tried to execute ⧙elm⧘, but it does not appear to exist!

        This is what the PATH environment variable looks like:

        /Users/you/project/tests
        /Users/you/project/tests/some/bin

        Is Elm installed?

        Note: If you have installed Elm locally (for example using npm or elm-tooling),
        execute elm-watch using npx to make elm-watch automatically pick up that local
        installation: ⧙npx elm-watch⧘
      `);
    });

    test("undefined PATH", async () => {
      expect(await run("valid", ["make", "app"], { env: {} }))
        .toMatchInlineSnapshot(`
          🚨 Dependencies

          ⧙-- ELM NOT FOUND ---------------------------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/valid/elm.json

          I tried to execute ⧙elm⧘, but it does not appear to exist!

          I can't find any program, because process.env.PATH is undefined!

          Is Elm installed?

          Note: If you have installed Elm locally (for example using npm or elm-tooling),
          execute elm-watch using npx to make elm-watch automatically pick up that local
          installation: ⧙npx elm-watch⧘
        `);
    });

    const printPATHWindows = (env: Env): string =>
      clean(Errors.printPATH(env, true));

    test("Windows basic", () => {
      expect(
        printPATHWindows({
          Path: [__dirname, path.join(__dirname, "some", "bin")].join(
            path.delimiter
          ),
        })
      ).toMatchInlineSnapshot(`
          This is what the Path environment variable looks like:

          /Users/you/project/tests
          /Users/you/project/tests/some/bin
        `);
    });

    test("Windows no PATH-like", () => {
      expect(printPATHWindows({})).toMatchInlineSnapshot(
        `I can't find any program, because I can't find any PATH-like environment variables!`
      );
    });

    test("Windows multiple PATH-like", () => {
      expect(
        printPATHWindows({
          Path: [__dirname, path.join(__dirname, "some", "bin")].join(
            path.delimiter
          ),
          PATH: [
            path.join(__dirname, "that", "bin"),
            path.join(__dirname, "final", "bin"),
          ].join(path.delimiter),
          notPath: "should not be seen",
        })
      ).toMatchInlineSnapshot(`
        You seem to have several PATH-like environment variables set. The last one
        should be the one that is actually used, but it's better to have a single one!

        Path:
        /Users/you/project/tests
        /Users/you/project/tests/some/bin

        PATH:
        /Users/you/project/tests/that/bin
        /Users/you/project/tests/final/bin
      `);
    });
  });

  describe("elm install errors", () => {
    test("dummy file creation error", async () => {
      const fixture = "valid";
      const tmpDir = path.join(FIXTURES_DIR, fixture, "tmp");
      expect(
        await run(fixture, ["make", "app"], {
          env: { [__ELM_WATCH_TMP_DIR]: tmpDir },
        })
      ).toMatchInlineSnapshot(`
        🚨 Dependencies

        ⧙-- FILE SYSTEM TROUBLE ---------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/valid/elm.json

        I tried to make sure that all packages are installed. To do that, I need to
        create a temporary dummy .elm file but that failed:

        EISDIR: illegal operation on a directory, open '/Users/you/project/tests/fixtures/errors/valid/tmp/fake/ElmWatchDummy.elm'
      `);
    });

    test("elm install error", async () => {
      expect(await runWithBadElmBin("install-error")).toMatchInlineSnapshot(`
        🚨 Dependencies

        ⧙-- PROBLEM LOADING PACKAGE LIST ------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/valid/elm.json

        I need the list of published packages to verify your dependencies, so I tried to
        fetch:

            https://package.elm-lang.org/all-packages

        But my HTTP library is giving me the following error message:

            ConnectionFailure Network.Socket.getAddrInfo (called with preferred socket type/protocol: AddrInfo {addrFlags = [AI_ADDRCONFIG], addrFamily = AF_UNSPEC, addrSocketType = Stream, addrProtocol = 0, addrAddress = <assumed to be undefined>, addrCanonName = <assumed to be undefined>}, host name: Just "package.elm-lang.org", service name: Just "443"): does not exist (nodename nor servname provided, or not known)

        Are you somewhere with a slow internet connection? Or no internet? Does the link
        I am trying to fetch work in your browser? Maybe the site is down? Does your
        internet connection have a firewall that blocks certain domains? It is usually
        something like that!
      `);
    });

    test("elm install error – hot", async () => {
      expect(await runWithBadElmBin("install-error", { exitHotOnError: true }))
        .toMatchInlineSnapshot(`
        🚨 Dependencies

        ⧙-- PROBLEM LOADING PACKAGE LIST ------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/valid/elm.json

        I need the list of published packages to verify your dependencies, so I tried to
        fetch:

            https://package.elm-lang.org/all-packages

        But my HTTP library is giving me the following error message:

            ConnectionFailure Network.Socket.getAddrInfo (called with preferred socket type/protocol: AddrInfo {addrFlags = [AI_ADDRCONFIG], addrFamily = AF_UNSPEC, addrSocketType = Stream, addrProtocol = 0, addrAddress = <assumed to be undefined>, addrCanonName = <assumed to be undefined>}, host name: Just "package.elm-lang.org", service name: Just "443"): does not exist (nodename nor servname provided, or not known)

        Are you somewhere with a slow internet connection? Or no internet? Does the link
        I am trying to fetch work in your browser? Maybe the site is down? Does your
        internet connection have a firewall that blocks certain domains? It is usually
        something like that!
      `);
    });

    describe("unexpected elm install output", () => {
      test("exit 0 + stderr", async () => {
        expect(await runWithBadElmBin("exit-0-stderr-install"))
          .toMatchInlineSnapshot(`
          🚨 Dependencies

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/valid/elm.json

          I tried to make sure all packages are installed by running the following commands:

          cd /Users/you/project/tests/fixtures/errors/valid
          elm make --output=/dev/null /tmp/fake/ElmWatchDummy.elm

          I expected it to either exit 0 with no output (success),
          or exit 1 with an error I can recognize (using regex) on stderr.

          ⧙But it exited like this:⧘

          exit 0
          some output
          on stderr
        `);
      });

      test("exit 1 + stderr not matching", async () => {
        expect(await runWithBadElmBin("exit-1-stderr-not-install-error-match"))
          .toMatchInlineSnapshot(`
          🚨 Dependencies

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/valid/elm.json

          I tried to make sure all packages are installed by running the following commands:

          cd /Users/you/project/tests/fixtures/errors/valid
          elm make --output=/dev/null /tmp/fake/ElmWatchDummy.elm

          I expected it to either exit 0 with no output (success),
          or exit 1 with an error I can recognize (using regex) on stderr.

          ⧙But it exited like this:⧘

          exit 1
          STDOUT:
          Dependencies ready!

          STDERR:
          I ran into an unexpected problem!
        `);
      });

      test("exit 2 + no output", async () => {
        expect(await runWithBadElmBin("exit-2-no-output-install"))
          .toMatchInlineSnapshot(`
          🚨 Dependencies

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/valid/elm.json

          I tried to make sure all packages are installed by running the following commands:

          cd /Users/you/project/tests/fixtures/errors/valid
          elm make --output=/dev/null /tmp/fake/ElmWatchDummy.elm

          I expected it to either exit 0 with no output (success),
          or exit 1 with an error I can recognize (using regex) on stderr.

          ⧙But it exited like this:⧘

          exit 2
          ⧙(no output)⧘
        `);
      });
    });
  });

  describe("elm make json errors", () => {
    test("syntax error", async () => {
      expect(await runWithBadElmBinAndExpectedJson("json-syntax-error", "{"))
        .toMatchInlineSnapshot(`
        🚨 app

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        Unexpected end of JSON input

        I wrote that to this file so you can inspect it:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96.json

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("decode error", async () => {
      expect(
        await runWithBadElmBinAndExpectedJson(
          "json-decode-error",
          JSON.stringify({ type: "laser-error" }, null, 2)
        )
      ).toMatchInlineSnapshot(`
        🚨 app

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        At root["type"]:
        Expected one of these tags: "error", "compile-errors"
        Got: "laser-error"

        I wrote that to this file so you can inspect it:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fe311e7464d5d116f8fa1ddccbc22767d9b6c74bfdd28d0719fb55ef7c1037a6.json

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("error failed to write", async () => {
      expect(await runWithBadElmBin("json-error-failed-write"))
        .toMatchInlineSnapshot(`
        🚨 app

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        Unexpected token { in JSON at position 1

        I tried to write that to this file:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fb337d3432f9465ea0a23c33debf6525c68f21f95061a35ff08c271f6c8e176b.json

        ⧙But that failed too:⧘

        EISDIR: illegal operation on a directory, open '/Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fb337d3432f9465ea0a23c33debf6525c68f21f95061a35ff08c271f6c8e176b.json'

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });
  });

  describe("unexpected `elm make` output", () => {
    test("exit 0 + stdout", async () => {
      expect(await runWithBadElmBin("exit-0-stdout")).toMatchInlineSnapshot(`
        🚨 app

        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 0
        some output
        on stdout

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 0 + stderr", async () => {
      expect(await runWithBadElmBin("exit-0-stderr")).toMatchInlineSnapshot(`
        🚨 app

        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 0
        some output
        on stderr

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 1 + stdout", async () => {
      expect(await runWithBadElmBin("exit-1-stdout")).toMatchInlineSnapshot(`
        🚨 app

        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 1
        some output
        on stdout

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 1 + stderr that isn’t json", async () => {
      expect(await runWithBadElmBin("exit-1-stderr-not-{"))
        .toMatchInlineSnapshot(`
        🚨 app

        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 1
        This flag was given a bad value:

            --output=.js

        I need a valid <output-file> value. For example:

            --output=elm.js
            --output=index.html
            --output=/dev/null

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 2 + no output", async () => {
      expect(await runWithBadElmBin("exit-2-no-output")).toMatchInlineSnapshot(`
        🚨 app

        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 2
        ⧙(no output)⧘

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 2 + both stdout and stderr", async () => {
      expect(await runWithBadElmBin("exit-2-both-stdout-and-stderr"))
        .toMatchInlineSnapshot(`
        🚨 app

        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/tests/fixtures/errors/valid/build/app.js /Users/you/project/tests/fixtures/errors/valid/src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 2
        STDOUT:
        stuff on stdout
        second write to stdout

        STDERR:
        stuff on stderr

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });
  });

  describe("elm compilation errors", () => {
    test('wrong "type" in elm.json', async () => {
      expect(await run("wrong-elm-json-type", ["make"])).toMatchInlineSnapshot(`
        ⛔️ Dependencies
        🚨 main

        ⧙-- UNEXPECTED TYPE -------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/wrong-elm-json-type/elm.json

        I got stuck while reading your elm.json file. I cannot handle a "type" like
        this:

        1|⧙>⧘{
        2|⧙>⧘  "type": "pakage"
        3|⧙>⧘}

        Try changing the "type" to ⧙"application"⧘ or ⧙"package"⧘ instead.

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("Elm file is actually a directory", async () => {
      // Elm’s message is a bit odd.
      expect(await run("compilation-errors", ["make", "Dir"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 Dir

        ⧙-- FILE NOT FOUND --------------------------------------------------------------⧘
        ⧙Target: Dir⧘

        I cannot find this file:

            ⧙/Users/you/project/tests/fixtures/errors/compilation-errors/src/Dir.elm⧘

        Is there a typo?

        ⧙Note⧘: If you are just getting started, try working through the examples in the
        official guide https://guide.elm-lang.org to get an idea of the kinds of things
        that typically go in a src/Main.elm file.

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("Elm syntax error", async () => {
      expect(await run("compilation-errors", ["make", "SyntaxError"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 SyntaxError

        ⧙-- UNFINISHED MODULE DECLARATION -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/compilation-errors/src/SyntaxError.elm:1:28

        I am parsing an \`module\` declaration, but I got stuck here:

        1| module SyntaxError exposing
                                      ⧙^⧘
        Here are some examples of valid \`module\` declarations:

            ⧙module⧘ Main ⧙exposing⧘ (..)
            ⧙module⧘ Dict ⧙exposing⧘ (Dict, empty, get)

        I generally recommend using an explicit exposing list. I can skip compiling a
        bunch of files when the public interface of a module stays the same, so exposing
        fewer values can help improve compile times!

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("module name and file name mismatch", async () => {
      expect(await run("compilation-errors", ["make", "ModuleNameMismatch"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 ModuleNameMismatch

        ⧙-- MODULE NAME MISMATCH --------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/compilation-errors/src/ModuleNameMismatch.elm:1:8

        It looks like this module name is out of sync:

        1| module OtherModuleName exposing (a)
                  ⧙^^^^^^^^^^^^^^^⧘
        I need it to match the file path, so I was expecting to see \`ModuleNameMismatch\`
        here. Make the following change, and you should be all set!

            ⧙OtherModuleName⧘ -> ⧙ModuleNameMismatch⧘

        ⧙Note⧘: I require that module names correspond to file paths. This makes it much
        easier to explore unfamiliar codebases! So if you want to keep the current
        module name, try renaming the file instead.

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("type error", async () => {
      expect(await run("compilation-errors", ["make", "TypeError"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 TypeError

        ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/compilation-errors/src/TypeError.elm:3:9

        I cannot do addition with ⧙String⧘ values like this one:

        3| error = "a" + 1
                   ⧙^^^⧘
        The (+) operator only works with ⧙Int⧘ and ⧙Float⧘ values.

        ⧙Hint⧘: Switch to the ⧙(++)⧘ operator to append strings!

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("missing main", async () => {
      expect(await run("compilation-errors", ["make", "MissingMain"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 MissingMain

        ⧙-- NO MAIN ---------------------------------------------------------------------⧘
        ⧙Target: MissingMain⧘

        When producing a JS file, I require that the given file has a \`main\` value. That
        way Elm.MissingMain.init() is definitely defined in the resulting file!

        Try adding a \`main\` value to your file? Or if you just want to verify that this
        module compiles, switch to --output=/dev/null to skip the code gen phase
        altogether.

        ⧙Note⧘: Adding a \`main\` value can be as brief as adding something like this:

        ⧙import⧘ Html

        ⧙main⧘ =
          ⧙Html⧘.text ⧙"Hello!"⧘

        Or use https://package.elm-lang.org/packages/elm/core/latest/Platform#worker to
        make a \`main\` with no user interface.

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("--optimize with Debug.log", async () => {
      expect(
        await run("compilation-errors", ["make", "DebugLog", "--optimize"])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 DebugLog

        ⧙-- DEBUG REMNANTS --------------------------------------------------------------⧘
        ⧙Target: DebugLog⧘

        There are uses of the \`Debug\` module in the following modules:

            ⧙DebugLog⧘

        But the --optimize flag only works if all \`Debug\` functions are removed!

        ⧙Note⧘: The issue is that --optimize strips out info needed by \`Debug\` functions.
        Here are two examples:

            (1) It shortens record field names. This makes the generated JavaScript is
            smaller, but \`Debug.toString\` cannot know the real field names anymore.

            (2) Values like \`type Height = Height Float\` are unboxed. This reduces
            allocation, but it also means that \`Debug.toString\` cannot tell if it is
            looking at a \`Height\` or \`Float\` value.

        There are a few other cases like that, and it will be much worse once we start
        inlining code. That optimization could move \`Debug.log\` and \`Debug.todo\` calls,
        resulting in unpredictable behavior. I hope that clarifies why this restriction
        exists!

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("interrupt typecheck with compilation error", async () => {
      const fixture = "interrupt-typecheck";
      const dir = path.join(FIXTURES_DIR, fixture);
      const src = path.join(dir, "src");
      const mainFile = path.join(src, "Main.elm");
      const mainFileTemplate = path.join(src, "Main1.elm");
      const mainFileString = fs
        .readFileSync(mainFileTemplate, "utf8")
        .replace("Main1", "Main");
      fs.writeFileSync(mainFile, mainFileString);

      const [output] = await Promise.all([
        run(fixture, ["hot"], {
          isTTY: false,
          env: {
            ...badElmBinEnv(path.join(dir, "bad-bin")),
            [__ELM_WATCH_EXIT_ON_ERROR]: "",
          },
        }),
        (async () => {
          await wait(500);
          touch(mainFile);
          await wait(60);
          fs.writeFileSync(mainFile, mainFileString.slice(0, -5));
        })(),
      ]);

      expect(output).toMatchInlineSnapshot(`
        ⏳ Main: elm make (typecheck only)
        ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
        ⏳ Main: elm make (typecheck only)
        ⏳ Main: interrupted
        ⏳ Main: elm make (typecheck only)
        🚨 Main

        ⧙-- ENDLESS STRING --------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/interrupt-typecheck/src/Main.elm:7:17

        I got to the end of the line without seeing the closing double quote:

        7|     Html.text "M
                           ⧙^⧘
        Strings look like ⧙"this"⧘ with double quotes on each end. Is the closing double
        quote missing in your code?

        ⧙Note⧘: For a string that spans multiple lines, you can use the multi-line string
        syntax like this:

        ⧙    """
            # Multi-line Strings
            
            - start with triple double quotes
            - write whatever you want
            - no need to escape newlines or double quotes
            - end with triple double quotes
            """⧘

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ⧙ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/errors/interrupt-typecheck/src/Main.elm
        ℹ️ 13:10:05 Changed /Users/you/project/tests/fixtures/errors/interrupt-typecheck/src/Main.elm⧘
        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      `);
    });
  });

  test("fail to read the size of Elm’s output", async () => {
    expect(await runWithBadElmBin("exit-0-no-write")).toMatchInlineSnapshot(`
      🚨 app

      ⧙-- TROUBLE READING OUTPUT ------------------------------------------------------⧘
      ⧙Target: app⧘

      I managed to compile your code. Then I tried to read the output:

      /Users/you/project/tests/fixtures/errors/valid/build/app.js

      Doing so I encountered this error:

      ENOENT: no such file or directory, stat '/Users/you/project/tests/fixtures/errors/valid/build/app.js'

      🚨 ⧙1⧘ error found

      🚨 Compilation finished in ⧙123⧘ ms.
    `);
  });

  describe("postprocess errors", () => {
    test("fail to read Elm’s output", async () => {
      expect(await runWithBadElmBin("exit-0-no-write", { postprocess: true }))
        .toMatchInlineSnapshot(`
        🚨 app

        ⧙-- TROUBLE READING OUTPUT ------------------------------------------------------⧘
        ⧙Target: app⧘

        I managed to compile your code. Then I tried to read the output:

        /Users/you/project/tests/fixtures/errors/valid/build/app.js

        Doing so I encountered this error:

        ENOENT: no such file or directory, open '/Users/you/project/tests/fixtures/errors/valid/build/app.js'

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("fail to overwrite Elm’s output after postprocess", async () => {
      expect(
        await runWithBadElmBin("exit-0-write-readonly", { postprocess: true })
      ).toMatchInlineSnapshot(`
        🚨 app

        ⧙-- TROUBLE WRITING OUTPUT ------------------------------------------------------⧘
        ⧙Target: app⧘

        I managed to compile your code and read the generated file:

        /Users/you/project/tests/fixtures/errors/valid/build/app.js

        After running your postprocess command, I tried to write the result of that
        back to the file but I encountered this error:

        EACCES: permission denied, open '/Users/you/project/tests/fixtures/errors/valid/build/app.js'

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("fail to write dummy output", async () => {
      expect(
        await runWithBadElmBin("exit-0-write-readonly", {
          exitHotOnError: true,
        })
      ).toMatchInlineSnapshot(`
        🚨 app

        ⧙-- TROUBLE WRITING DUMMY OUTPUT ------------------------------------------------⧘
        ⧙Target: app⧘

        There are no websocket connections for this target, so I only typecheck the
        code. That went well. Then I tried to write a dummy output file here:

        /Users/you/project/tests/fixtures/errors/valid/build/app.js

        Doing so I encountered this error:

        EACCES: permission denied, open '/Users/you/project/tests/fixtures/errors/valid/build/app.js'

        🚨 ⧙1⧘ error found

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("command not found", async () => {
      expect(
        await run("postprocess/variants/command-not-found", ["make"], {
          env: {
            ...process.env,
            ...TEST_ENV,
            PATH: path.join(path.dirname(__dirname), "node_modules", ".bin"),
          },
        })
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- COMMAND NOT FOUND -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I tried to execute ⧙nope⧘, but it does not appear to exist!

        This is what the PATH environment variable looks like:

        /Users/you/project/node_modules/.bin

        Is ⧙nope⧘ installed?

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 1 + stdout", async () => {
      expect(await run("postprocess/variants/exit-1-stdout", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/exit-1-stdout
        printf '(function(...;}(this));' | node -e 'console.log(Array.from({length:101}, (_, i) => \`\${i + 1} | stdout line\`).join('\\''\\n'\\'')); process.exit(1)' main standard make

        ⧙It exited with an error:⧘

        exit 1
        1 | stdout line
        2 | stdout line
        3 | stdout line
        4 | stdout line
        5 | stdout line
        6 | stdout line
        7 | stdout line
        8 | stdout line
        9 | stdout line
        10 | stdout line
        11 | stdout line
        12 | stdout line
        13 | stdout line
        14 | stdout line
        15 | stdout line
        16 | stdout line
        17 | stdout line
        18 | stdout line
        19 | stdout line
        20 | stdout line
        21 | stdout line
        22 | stdout line
        23 | stdout line
        24 | stdout line
        25 | stdout line
        26 | stdout line
        27 | stdout line
        28 | stdout line
        29 | stdout line
        30 | stdout line
        31 | stdout line
        32 | stdout line
        33 | stdout line
        34 | stdout line
        35 | stdout line
        36 | stdout line
        37 | stdout line
        38 | stdout line
        39 | stdout line
        40 | stdout line
        41 | stdout line
        42 | stdout line
        43 | stdout line
        44 | stdout line
        45 | stdout line
        46 | stdout line
        47 | stdout line
        48 | stdout line
        49 | stdout line
        50 | stdout line
        51 | stdout line
        52 | stdout line
        53 | stdout line
        54 | stdout line
        55 | stdout line
        56 | stdout line
        57 | stdout line
        58 | stdout line
        59 | stdout line
        60 | stdout line
        61 | stdout line
        62 | stdout line
        63 | stdout line
        64 | stdout line
        65 | stdout line
        66 | stdout line
        67 | stdout line
        68 | stdout line
        69 | stdout line
        70 | stdout line
        71 | stdout line
        72 | stdout line
        73 | stdout line
        74 | stdout line
        75 | stdout line
        76 | stdout line
        77 | stdout line
        78 | stdout line
        79 | stdout line
        80 | stdout line
        81 | stdout line
        82 | stdout line
        83 | stdout line
        84 | stdout line
        85 | stdout line
        86 | stdout line
        87 | stdout line
        88 | stdout line
        89 | stdout line
        90 | stdout line
        91 | stdout line
        92 | stdout line
        93 | stdout line
        94 | stdout line
        95 | stdout line
        96 | stdout line
        97 | stdout line
        98 | stdout line
        99 | stdout line
        100 | stdout line
        ⧙1 more line⧘

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 2 + stderr + debug", async () => {
      expect(
        await run("postprocess/variants/exit-2-stderr", ["make", "--debug"])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/exit-2-stderr
        printf '(function(...;}(this));' | node -e 'console.error(Array.from({length:102}, (_, i) => \`\${i + 1} | stderr line\`).join('\\''\\n'\\'')); process.exit(2)' main debug make

        ⧙It exited with an error:⧘

        exit 2
        1 | stderr line
        2 | stderr line
        3 | stderr line
        4 | stderr line
        5 | stderr line
        6 | stderr line
        7 | stderr line
        8 | stderr line
        9 | stderr line
        10 | stderr line
        11 | stderr line
        12 | stderr line
        13 | stderr line
        14 | stderr line
        15 | stderr line
        16 | stderr line
        17 | stderr line
        18 | stderr line
        19 | stderr line
        20 | stderr line
        21 | stderr line
        22 | stderr line
        23 | stderr line
        24 | stderr line
        25 | stderr line
        26 | stderr line
        27 | stderr line
        28 | stderr line
        29 | stderr line
        30 | stderr line
        31 | stderr line
        32 | stderr line
        33 | stderr line
        34 | stderr line
        35 | stderr line
        36 | stderr line
        37 | stderr line
        38 | stderr line
        39 | stderr line
        40 | stderr line
        41 | stderr line
        42 | stderr line
        43 | stderr line
        44 | stderr line
        45 | stderr line
        46 | stderr line
        47 | stderr line
        48 | stderr line
        49 | stderr line
        50 | stderr line
        51 | stderr line
        52 | stderr line
        53 | stderr line
        54 | stderr line
        55 | stderr line
        56 | stderr line
        57 | stderr line
        58 | stderr line
        59 | stderr line
        60 | stderr line
        61 | stderr line
        62 | stderr line
        63 | stderr line
        64 | stderr line
        65 | stderr line
        66 | stderr line
        67 | stderr line
        68 | stderr line
        69 | stderr line
        70 | stderr line
        71 | stderr line
        72 | stderr line
        73 | stderr line
        74 | stderr line
        75 | stderr line
        76 | stderr line
        77 | stderr line
        78 | stderr line
        79 | stderr line
        80 | stderr line
        81 | stderr line
        82 | stderr line
        83 | stderr line
        84 | stderr line
        85 | stderr line
        86 | stderr line
        87 | stderr line
        88 | stderr line
        89 | stderr line
        90 | stderr line
        91 | stderr line
        92 | stderr line
        93 | stderr line
        94 | stderr line
        95 | stderr line
        96 | stderr line
        97 | stderr line
        98 | stderr line
        99 | stderr line
        100 | stderr line
        ⧙2 more lines⧘

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 3 + no output + optimize", async () => {
      expect(
        await run("postprocess/variants/exit-3-no-output", [
          "make",
          "--optimize",
        ])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/exit-3-no-output
        printf '(function(...;}(this));' | node -e 'process.exit(3)' main optimize make

        ⧙It exited with an error:⧘

        exit 3
        ⧙(no output)⧘

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 4 + both stdout and stderr", async () => {
      expect(
        await run("postprocess/variants/exit-4-both-stdout-and-stderr", [
          "make",
        ])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/exit-4-both-stdout-and-stderr
        printf '(function(...;}(this));' | node -e 'console.log("1234567890".repeat(800)+'\\'1\\''); console.error("1234567890".repeat(400)); console.error("1234567890".repeat(400)+'\\'12\\''); console.error('\\''last line'\\''); process.exit(4)' main standard make

        ⧙It exited with an error:⧘

        exit 4
        STDOUT:
        12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890 ⧙1 more character⧘

        STDERR:
        1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890
        1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890 ⧙2 more characters⧘
        ⧙1 more line⧘

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("exit 5 + tricky args", async () => {
      expect(await run("postprocess/variants/exit-5-tricky-args", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/exit-5-tricky-args
        printf '(function(...;}(this));' | node -e 'process.exit(5)' -- '' \\'a\\'b\\' '$x' main standard make

        ⧙It exited with an error:⧘

        exit 5
        ⧙(no output)⧘

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("forgot to read stdin", async () => {
      expect(await run("postprocess/variants/no-stdin-read", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS STDIN TROUBLE ---------------------------------------------------⧘
        ⧙Target: main⧘

        I tried to run your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/no-stdin-read
        printf '(function(...;}(this));' | true main standard make

        Trying to write to its ⧙stdin⧘, I got an error!
        ⧙Did you forget to read stdin, maybe?⧘

        Note: If you don't need stdin in some case, you can pipe it to stdout!

        This is the error message I got:

        write EPIPE

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });
  });

  describe("elm-watch-node errors", () => {
    test("missing script", async () => {
      expect(await run("postprocess/variants/missing-script", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- MISSING POSTPROCESS SCRIPT --------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/missing-script/elm-watch.json

        You have specified this in ⧙elm-watch.json⧘:

        "postprocess": ["elm-watch-node"]

        You need to specify a JavaScript file to run as well, like so:

        "postprocess": ["elm-watch-node", "postprocess.js"]

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("script not found", async () => {
      expect(await run("postprocess/variants/script-not-found", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/script-not-found/not-found.js

        I tried to import your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/script-not-found/not-found.js")

        But that resulted in this error:

        Cannot find module '/Users/you/project/tests/fixtures/errors/postprocess/variants/script-not-found/not-found.js' imported from /Users/you/project/src/PostprocessWorker.ts

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("throw at import", async () => {
      expect(await run("postprocess/variants/throw-at-import", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-at-import/postprocess.js

        I tried to import your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/throw-at-import/postprocess.js")

        But that resulted in this error:

        Error: Failed to initialize!
            at fake/stacktrace.js

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("throw non-error at import, with console.log", async () => {
      expect(
        await run("postprocess/variants/throw-non-error-at-import", ["make"])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-non-error-at-import/postprocess.js

        I tried to import your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/throw-non-error-at-import/postprocess.js")

        But that resulted in this error:

        [null, "error"]

        STDOUT:
        My debug message 1337

        STDERR:

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("throw null at import, with console.error", async () => {
      expect(await run("postprocess/variants/throw-null-at-import", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-null-at-import/postprocess.js

        I tried to import your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/throw-null-at-import/postprocess.js")

        But that resulted in this error:

        null

        STDOUT:


        STDERR:
        { test: 1, items: [ 'one', 'two' ] }

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("empty file", async () => {
      expect(await run("postprocess/variants/empty-file", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- MISSING POSTPROCESS DEFAULT EXPORT ------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/empty-file/postprocess.js

        I imported your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/empty-file/postprocess.js")

        I expected ⧙imported.default⧘ to be a function, but it isn't!

        typeof imported.default === "object"

        ⧙imported⧘ is:

        {"default": {}}

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("wrong default export, with console.log and console.error", async () => {
      expect(await run("postprocess/variants/wrong-default-export", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- MISSING POSTPROCESS DEFAULT EXPORT ------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/wrong-default-export/postprocess.js

        I imported your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/wrong-default-export/postprocess.js")

        I expected ⧙imported.default⧘ to be a function, but it isn't!

        typeof imported.default === "object"

        ⧙imported⧘ is:

        {"default": Object(1), "postprocess": function "postprocess"}

        STDOUT:
        This is stdout
        on two lines

        STDERR:
        This is stderr

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("throw error, with process.stdout.write", async () => {
      expect(await run("postprocess/variants/throw-error", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-error/postprocess.js

        I tried to run your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/throw-error/postprocess.js")
        const result = await imported.default(["(function(...;}(this));","main","standard","make"])

        But that resulted in this error:

        Error: Failed to run postprocess!
            at fake/stacktrace.js

        STDOUT:
        Some debug message

        STDERR:

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("throw null", async () => {
      expect(await run("postprocess/variants/throw-null", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-null/postprocess.js

        I tried to run your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/throw-null/postprocess.js")
        const result = await imported.default(["(function(...;}(this));","main","standard","make"])

        But that resulted in this error:

        null

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("reject promise", async () => {
      expect(await run("postprocess/variants/reject-promise", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/reject-promise/postprocess.js

        I tried to run your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/reject-promise/postprocess.js")
        const result = await imported.default(["(function(...;}(this));","main","standard","make"])

        But that resulted in this error:

        "rejected!"

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });

    test("return undefined, with process.stderr.write", async () => {
      expect(await run("postprocess/variants/return-undefined", ["make"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 main

        ⧙-- INVALID POSTPROCESS RESULT --------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/return-undefined/postprocess.js

        I ran your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/variants/return-undefined/postprocess.js")
        const result = await imported.default(["(function(...;}(this));","main","standard","make"])

        I expected ⧙result⧘ to be a string, but it is:

        undefined

        STDOUT:


        STDERR:
        Stderr!

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
      `);
    });
  });

  describe("elm-watch-stuff.json errors", () => {
    test("is a folder", async () => {
      expect(await run("elm-watch-stuff-json-is-folder", ["hot"]))
        .toMatchInlineSnapshot(`
        ⧙-- TROUBLE READING elm-stuff/elm-watch-stuff.json ------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-is-folder/elm-stuff/elm-watch-stuff.json

        I read stuff from ⧙elm-stuff/elm-watch-stuff.json⧘ to remember some things between runs.

        ⧙I had trouble reading it as JSON:⧘

        EISDIR: illegal operation on a directory, read

        This file is created by elm-watch, so reading it should never fail really.
        You could try removing that file (it contains nothing essential).
      `);
    });

    test("bad json", async () => {
      expect(await run("elm-watch-stuff-json-bad-json", ["hot"]))
        .toMatchInlineSnapshot(`
        ⧙-- TROUBLE READING elm-stuff/elm-watch-stuff.json ------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-bad-json/elm-stuff/elm-watch-stuff.json

        I read stuff from ⧙elm-stuff/elm-watch-stuff.json⧘ to remember some things between runs.

        ⧙I had trouble reading it as JSON:⧘

        Unexpected end of JSON input

        This file is created by elm-watch, so reading it should never fail really.
        You could try removing that file (it contains nothing essential).
      `);
    });

    test("bad compilation mode", async () => {
      expect(await run("elm-watch-stuff-json-bad-compilation-mode", ["hot"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-stuff/elm-watch-stuff.json FORMAT -------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-bad-compilation-mode/elm-stuff/elm-watch-stuff.json

        I read stuff from ⧙elm-stuff/elm-watch-stuff.json⧘ to remember some things between runs.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["Main"]["compilationMode"]:
        Expected one of these variants: "debug", "optimize"
        Got: "standard"

        This file is created by elm-watch, so reading it should never fail really.
        You could try removing that file (it contains nothing essential).
      `);
    });

    test("write error", async () => {
      const dir = path.join(FIXTURES_DIR, "elm-watch-stuff-json-write-error");
      const elmWatchStuffJson: ElmWatchStuffJsonWritable = {
        port: 59999,
        targets: {},
      };
      fs.mkdirSync(path.join(dir, "elm-stuff"), { recursive: true });
      try {
        fs.writeFileSync(
          path.join(dir, "elm-stuff", "elm-watch-stuff.json"),
          JSON.stringify(elmWatchStuffJson),
          { mode: "0444" } // readonly
        );
      } catch {
        // Ignore write errors (readonly).
      }
      expect(
        await runAbsolute(dir, ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        })
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ Main⧙                                             1 ms Q | 765 ms T ¦  50 ms W⧘

        ⧙-- TROUBLE WRITING elm-stuff/elm-watch-stuff.json ------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-write-error/elm-stuff/elm-watch-stuff.json

        I write stuff to ⧙elm-stuff/elm-watch-stuff.json⧘ to remember some things between runs.

        ⧙I had trouble writing that file:⧘

        EACCES: permission denied, open '/Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-write-error/elm-stuff/elm-watch-stuff.json'

        The file contains nothing essential, but something weird is going on.

        📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
      `);
    });
  });

  test("import walker file system error", async () => {
    expect(
      await run("import-walker-file-system-error", ["hot"], {
        env: elmBinAlwaysSucceedEnv,
        exitHotOnError: true,
      })
    ).toMatchInlineSnapshot(`
      ✅ Dependencies
      🚨 Main

      ⧙-- TROUBLE READING ELM FILES ---------------------------------------------------⧘
      ⧙Target: Main⧘

      When figuring out all Elm files that your inputs depend on I read a lot of Elm files.
      Doing so I encountered this error:

      EISDIR: illegal operation on a directory, read

      (I still managed to compile your code, but the watcher will not work properly
      and "postprocess" was not run.)

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);
  });

  describe("port conflict", () => {
    let server: http.Server;

    beforeEach(() => {
      server = http.createServer();
      server.listen(9123);
    });

    afterEach(() => {
      server.close();
    });

    test("for persisted port", async () => {
      expect(
        await run("port-conflict-for-persisted-port", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        })
      ).toMatchInlineSnapshot(`
        ⧙-- PORT CONFLICT ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/port-conflict-for-persisted-port/elm-stuff/elm-watch-stuff.json

        I ask the operating system for an arbitrary available port for the
        web socket server.

        I then save the port I got to ⧙elm-stuff/elm-watch-stuff.json⧘. Otherwise I would
        get a new port number on each restart, which means that if you had tabs
        open in the browser they would try to connect to the old port number.

        I tried to use such a saved port number from a previous run (or from previous
        configuration). But now that port (9123) wasn't available!

        Most likely you already have elm-watch running somewhere else! If so,
        find it and use that, or kill it.

        If not, something else could have started using port 9123
        (though it's not very likely.) Then you can either try to find what that is,
        or remove ⧙elm-stuff/elm-watch-stuff.json⧘ here:

        /Users/you/project/tests/fixtures/errors/port-conflict-for-persisted-port/elm-stuff/elm-watch-stuff.json

        Then I will ask the operating system for a new arbitrary available port.
      `);
    });

    test("from config", async () => {
      expect(
        await run("port-conflict-for-port-from-config", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        })
      ).toMatchInlineSnapshot(`
        ⧙-- PORT CONFLICT ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/port-conflict-for-port-from-config/elm-watch.json

        In your ⧙elm-watch.json⧘ you have this:

        "port": 9123

        But something else seems to already be running on that port!
        You might already have elm-watch running somewhere, or it could be a completely
        different program.

        You need to either find and stop that other thing, switch to another port or
        remove "port" from ⧙elm-watch.json⧘ (which will use an arbitrary available port.)
      `);
    });
  });

  test("typecheck only should mark only relevant targets with errors", async () => {
    expect(await run("typecheck-only", ["hot"], { exitHotOnError: true }))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ Main1⧙                                            1 ms Q | 765 ms T ¦  50 ms W⧘
      🚨 Main2
      🚨 Main3

      ⧙-- UNKNOWN EXPORT --------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/errors/typecheck-only/src/Main2.elm:1:24

      You are trying to expose a value named \`forMainTypo\` but I cannot find its
      definition.

      These names seem close though:

          ⧙forMain3⧘
          ⧙main⧘

      🚨 ⧙1⧘ error found

      📊 ⧙web socket connections:⧘ 0 ⧙(ws://0.0.0.0:59123)⧘

      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123⧘ ms.
    `);
  });

  describe("CI", () => {
    const appPath = path.join(FIXTURES_DIR, "ci", "build", "app.js");

    test("CI scenario", async () => {
      rm(appPath);

      // Note: Postprocess is skipped when there are `elm make` errors.
      expect(await run("ci", ["make"], { isTTY: false }))
        .toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ admin: elm make
        ⚪️ app: queued
        ⚪️ postprocess-error: queued
        🚨 admin
        ⏳ app: elm make
        🟢 app: elm make done
        ⏳ postprocess-error: elm make
        🟢 postprocess-error: elm make done

        ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/ci/src/Admin.elm:8:15

        The 1st argument to \`text\` is not what I expect:

        8|     Html.text Shared.greet "Admin"
                         ⧙^^^^^^^^^^^^⧘
        This \`greet\` value is a:

            ⧙String -> String⧘

        But \`text\` needs the 1st argument to be:

            ⧙String⧘

        ⧙-- TOO MANY ARGS ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/ci/src/Admin.elm:8:5

        The \`text\` function expects 1 argument, but it got 2 instead.

        8|     Html.text Shared.greet "Admin"
               ⧙^^^^^^^^^⧘
        Are there any missing commas? Or missing parentheses?

        🚨 ⧙2⧘ errors found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);

      expect(fs.existsSync(appPath)).toBe(true);

      // Postprocess error.
      expect(
        await run("ci", ["make", "postprocess-error"], {
          isTTY: false,
        })
      ).toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ postprocess-error: elm make
        🟢 postprocess-error: elm make done
        ⏳ postprocess-error: postprocess
        🚨 postprocess-error

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: postprocess-error⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/ci
        printf '(function(...;}(this));' | node -e 'process.exit(1)' postprocess-error standard make

        ⧙It exited with an error:⧘

        exit 1
        ⧙(no output)⧘

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123⧘ ms.
      `);
    });

    test("CI scenario – no color", async () => {
      rm(appPath);

      // Note: Postprocess is skipped when there are `elm make` errors.
      expect(
        await run("ci", ["make"], {
          env: {
            ...process.env,
            ...TEST_ENV,
            [NO_COLOR]: "",
          },
          isTTY: false,
        })
      ).toMatchInlineSnapshot(`
        Dependencies: in progress
        Dependencies: success
        admin: elm make
        app: queued
        postprocess-error: queued
        admin: error
        app: elm make
        app: elm make done
        postprocess-error: elm make
        postprocess-error: elm make done

        -- TYPE MISMATCH ---------------------------------------------------------------
        /Users/you/project/tests/fixtures/errors/ci/src/Admin.elm:8:15

        The 1st argument to \`text\` is not what I expect:

        8|     Html.text Shared.greet "Admin"
                         ^^^^^^^^^^^^
        This \`greet\` value is a:

            String -> String

        But \`text\` needs the 1st argument to be:

            String

        -- TOO MANY ARGS ---------------------------------------------------------------
        /Users/you/project/tests/fixtures/errors/ci/src/Admin.elm:8:5

        The \`text\` function expects 1 argument, but it got 2 instead.

        8|     Html.text Shared.greet "Admin"
               ^^^^^^^^^
        Are there any missing commas? Or missing parentheses?

        2 errors found

        Compilation finished in 123 ms.
      `);

      expect(fs.existsSync(appPath)).toBe(true);

      // Postprocess error.
      expect(
        await run("ci", ["make", "postprocess-error"], {
          env: {
            ...process.env,
            ...TEST_ENV,
            [NO_COLOR]: "",
          },
          isTTY: false,
        })
      ).toMatchInlineSnapshot(`
        Dependencies: in progress
        Dependencies: success
        postprocess-error: elm make
        postprocess-error: elm make done
        postprocess-error: postprocess
        postprocess-error: error

        -- POSTPROCESS ERROR -----------------------------------------------------------
        Target: postprocess-error

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/ci
        printf '(function(...;}(this));' | node -e 'process.exit(1)' postprocess-error standard make

        It exited with an error:

        exit 1
        (no output)

        1 error found

        Compilation finished in 123 ms.
      `);
    });
  });

  test("stuck in progress", async () => {
    expect(
      await run("valid", ["make"], {
        env: {
          ...process.env,
          ...TEST_ENV,
          [__ELM_WATCH_MAX_PARALLEL]: "0",
        },
      })
    ).toMatchInlineSnapshot(`
      ✅ Dependencies
      ⚪️ app: queued
      ⚪️ admin: queued

      ⧙-- STUCK IN PROGRESS -----------------------------------------------------------⧘
      ⧙Target: app⧘

      I thought that all outputs had finished compiling, but my inner state says
      this target is still in the ⧙QueuedForElmMake⧘ phase.

      ⧙This is not supposed to ever happen.⧘

      ⧙-- STUCK IN PROGRESS -----------------------------------------------------------⧘
      ⧙Target: admin⧘

      I thought that all outputs had finished compiling, but my inner state says
      this target is still in the ⧙QueuedForElmMake⧘ phase.

      ⧙This is not supposed to ever happen.⧘

      🚨 ⧙2⧘ errors found

      🚨 Compilation finished in ⧙123⧘ ms.
    `);
  });

  describe("hard to test errors", () => {
    test("noCommonRoot", () => {
      expect(
        printError(
          Errors.noCommonRoot([
            { tag: "AbsolutePath", absolutePath: "C:\\project\\elm.json" },
            { tag: "AbsolutePath", absolutePath: "D:\\stuff\\elm\\elm.json" },
          ])
        )
      ).toMatchInlineSnapshot(`
        ⧙-- NO COMMON ROOT --------------------------------------------------------------⧘

        I could not find a common ancestor for these paths:

        C:\\project\\elm.json
        D:\\stuff\\elm\\elm.json

        ⧙Compiling files on different drives is not supported.⧘
      `);
    });

    test("otherSpawnError", () => {
      expect(
        printError(
          Errors.otherSpawnError(
            {
              tag: "ElmJsonPath",
              theElmJsonPath: {
                tag: "AbsolutePath",
                absolutePath: "/Users/you/project/elm.json",
              },
            },
            new Error("Wingardium Leviosa"),
            {
              command: "elm",
              args: ["make", "src/Main.elm"],
              options: {
                cwd: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project",
                },
                env: {},
              },
            }
          )
        )
      ).toMatchInlineSnapshot(`
        ⧙-- TROUBLE SPAWNING COMMAND ----------------------------------------------------⧘
        /Users/you/project/elm.json

        I tried to execute ⧙elm⧘, but I ran into an error!

        Wingardium Leviosa

        This happened when trying to run the following commands:

        cd /Users/you/project
        elm make src/Main.elm
      `);
    });

    test("ExitReason Signal", () => {
      expect(
        printError(
          Errors.postprocessNonZeroExit(
            {
              tag: "OutputPath",
              theOutputPath: {
                tag: "AbsolutePath",
                absolutePath: "/build/main.js",
              },

              originalString: "main.js",
              targetName: "main",
            },
            { tag: "Signal", signal: "SIGABRT" },
            "",
            "",
            {
              command: "node",
              args: ["postprocess.js"],
              options: {
                cwd: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project",
                },
                env: {},
              },
            }
          )
        )
      ).toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project
        node postprocess.js

        ⧙It exited with an error:⧘

        signal SIGABRT
        ⧙(no output)⧘
      `);
    });

    test("ExitReason Unknown", () => {
      expect(
        printError(
          Errors.postprocessNonZeroExit(
            {
              tag: "OutputPath",
              theOutputPath: {
                tag: "AbsolutePath",
                absolutePath: "/build/main.js",
              },

              originalString: "main.js",
              targetName: "main",
            },
            { tag: "Unknown" },
            "",
            "",
            {
              command: "node",
              args: ["postprocess.js"],
              options: {
                cwd: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project",
                },
                env: {},
              },
            }
          )
        )
      ).toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project
        node postprocess.js

        ⧙It exited with an error:⧘

        unknown exit reason
        ⧙(no output)⧘
      `);
    });

    test("portConflictForNoPort", () => {
      expect(
        printError(Errors.portConflictForNoPort(new Error("The error message")))
      ).toMatchInlineSnapshot(`
        ⧙-- PORT CONFLICT ---------------------------------------------------------------⧘

        I ask the operating system for an arbitrary available port for the
        web socket server.

        The operating system is supposed to always be able to find an available port,
        but it looks like that wasn't the case this time!

        This is the error message I got:

        The error message
      `);
    });
  });
});
