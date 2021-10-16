import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { elmWatchCli } from "../src";
import * as Errors from "../src/Errors";
import { Env, sha256, toError } from "../src/Helpers";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  FailReadStream,
  MemoryWriteStream,
  prependPATH,
  stringSnapshotSerializer,
} from "./Helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "errors");

const TEST_ENV = {
  __ELM_WATCH_LOADING_MESSAGE_DELAY: "0",
  ELM_WATCH_MAX_PARALLEL: "2",
};

async function run(
  fixture: string,
  args: Array<string>,
  options?: { env?: Env; isTTY?: boolean }
): Promise<string> {
  return runAbsolute(path.join(FIXTURES_DIR, fixture), args, options);
}

async function runAbsolute(
  dir: string,
  args: Array<string>,
  { env, isTTY = true }: { env?: Env; isTTY?: boolean } = {}
): Promise<string> {
  const stdout = new MemoryWriteStream();
  const stderr = new CursorWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const exitCode = await elmWatchCli(args, {
    cwd: dir,
    env:
      env === undefined
        ? {
            ...process.env,
            ...TEST_ENV,
          }
        : env,
    stdin: new FailReadStream(),
    stdout,
    stderr,
    getNow: () => new Date(),
    onIdle: undefined,
  });

  const stderrString = clean(stderr.getOutput());

  assertExitCode(1, exitCode, stdout.content, stderrString);
  expect(stdout.content).toBe("");

  return stderrString;
}

function badElmBinEnv(dir: string, fixture: string): Env {
  return {
    ...process.env,
    ...TEST_ENV,
    PATH: prependPATH(path.join(dir, "bad-bin", fixture)),
    // The default timeout is optimized for calling Elm directly.
    // The bad-bin `elm`s are Node.js scripts – just starting Node.js can take
    // 100ms. So raise the bar to stabilize the tests.
    __ELM_WATCH_LOADING_MESSAGE_DELAY: "10000",
  };
}

async function runWithBadElmBin(
  fixture: string,
  { postprocess = false } = {}
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
    ["make", "app"],
    {
      env: badElmBinEnv(dir, fixture),
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
    `elm-watch-ElmMakeJsonParseError-${sha256(expectedWrittenJson)}.json`
  );

  if (fs.existsSync(jsonPath)) {
    fs.unlinkSync(jsonPath);
  }

  const output = await runAbsolute(dir, ["make", "app"], {
    env: badElmBinEnv(dir, fixture),
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
          "make",
          "src/App.elm",
          "../lib/Admin.elm",
          "--output=dist/main.js",
        ])
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED FLAGS ------------------------------------------------------------⧘

        The ⧙make⧘ command only accepts the flags ⧙--debug⧘ and ⧙--optimize⧘.

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
      `);
    });

    test("symlink loop", async () => {
      expect(await run("symlink-loop", ["make"])).toMatchInlineSnapshot(`
        🚨 main

        ⧙-- INPUTS FAILED TO RESOLVE ----------------------------------------------------⧘
        ⧙Target: main⧘

        I start by checking if the inputs you give me exist,
        but doing so resulted in errors!

        Main.elm:
        ELOOP: too many symbolic links encountered, stat '/Users/you/project/tests/fixtures/errors/symlink-loop/Main.elm'

        ⧙That's all I know, unfortunately!⧘

        🚨 ⧙1⧘ error found
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
      `);
    });
  });

  describe("elm.json errors", () => {
    test("elm.json not found", async () => {
      expect(await run("elm-json-not-found", ["make"])).toMatchInlineSnapshot(`
        🚨 main

        ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
        ⧙Target: main⧘

        I could not find an ⧙elm.json⧘ for these inputs:

        Main.elm
        pages/About.elm

        Has it gone missing? Maybe run ⧙elm init⧘ to create one?

        🚨 ⧙1⧘ error found
      `);
    });

    test("elm.json not found for all inputs", async () => {
      expect(await run("elm-json-not-found-for-all", ["make"]))
        .toMatchInlineSnapshot(`
        🚨 main

        ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
        ⧙Target: main⧘

        I could not find an ⧙elm.json⧘ for these inputs:

        Main.elm

        Has it gone missing? Maybe run ⧙elm init⧘ to create one?

        Note that I did find an ⧙elm.json⧘ for some inputs:

        pages/About.elm
        -> /Users/you/project/tests/fixtures/errors/elm-json-not-found-for-all/pages/elm.json

        Make sure that one single ⧙elm.json⧘ covers all the inputs together!

        🚨 ⧙1⧘ error found
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

        Either split this output, or move the inputs to the same project with the same
        ⧙elm.json⧘.

        🚨 ⧙1⧘ error found
      `);
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

    describe("elm install dummy file creation error", () => {
      const dummy = path.join(os.tmpdir(), "ElmWatchDummy.elm");

      beforeEach(() => {
        if (fs.existsSync(dummy)) {
          fs.unlinkSync(dummy);
        }
        fs.mkdirSync(dummy);
      });

      afterEach(() => {
        if (fs.existsSync(dummy) && fs.statSync(dummy).isDirectory()) {
          fs.rmdirSync(dummy);
        }
      });

      test("is directory", async () => {
        expect(await run("valid", ["make", "app"])).toMatchInlineSnapshot(`
          🚨 Dependencies

          ⧙-- FILE SYSTEM TROUBLE ---------------------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/valid/elm.json

          I tried to make sure that all packages are installed. To do that, I need to
          create a temporary dummy .elm file but that failed:

          EISDIR: illegal operation on a directory, open '/tmp/fake/ElmWatchDummy.elm'
        `);
      });
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
          (no output)
        `);
      });
    });

    test("elm make json syntax error", async () => {
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

        I wrote the JSON to this file so you can inspect it:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96.json

        🚨 ⧙1⧘ error found
      `);
    });

    test("elm make json decode error", async () => {
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

        I wrote the JSON to this file so you can inspect it:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fe311e7464d5d116f8fa1ddccbc22767d9b6c74bfdd28d0719fb55ef7c1037a6.json

        🚨 ⧙1⧘ error found
      `);
    });

    test("elm make json error failed to write", async () => {
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

        I tried to write the JSON to this file:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fb337d3432f9465ea0a23c33debf6525c68f21f95061a35ff08c271f6c8e176b.json

        ⧙But that failed too:⧘

        EISDIR: illegal operation on a directory, open '/Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fb337d3432f9465ea0a23c33debf6525c68f21f95061a35ff08c271f6c8e176b.json'

        🚨 ⧙1⧘ error found
      `);
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
        `);
      });

      test("exit 2 + no output", async () => {
        expect(await runWithBadElmBin("exit-2-no-output"))
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
          (no output)

          🚨 ⧙1⧘ error found
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
        `);
      });
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
      `);
    });

    test("fail to overwrite Elm’s output", async () => {
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
        printf '(function(...;}(this));' | node -e 'console.log('\\''some stdout'\\''); process.exit(1)' main standard make

        ⧙It exited with an error:⧘

        exit 1
        some stdout

        🚨 ⧙1⧘ error found
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
        printf '(function(...;}(this));' | node -e 'console.error('\\''some stderr'\\''); process.exit(2)' main debug make

        ⧙It exited with an error:⧘

        exit 2
        some stderr

        🚨 ⧙1⧘ error found
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
        (no output)

        🚨 ⧙1⧘ error found
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
        printf '(function(...;}(this));' | node -e 'console.log("stdout"); console.error("stderr"); process.exit(4)' main standard make

        ⧙It exited with an error:⧘

        exit 4
        STDOUT:
        stdout

        STDERR:
        stderr

        🚨 ⧙1⧘ error found
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
        (no output)

        🚨 ⧙1⧘ error found
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
        printf '(function(...;}(this));' | node -e 'process.exit(0)' main standard make

        Trying to write to its ⧙stdin⧘, I got an error!
        ⧙Did you forget to read stdin, maybe?⧘

        Note: If you don't need stdin in some case, you can pipe it to stdout!

        This is the error message I got:

        write EPIPE

        🚨 ⧙1⧘ error found
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

        Cannot find module '/Users/you/project/tests/fixtures/errors/postprocess/variants/script-not-found/not-found.js' from 'src/Postprocess.ts'

        🚨 ⧙1⧘ error found
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
      `);
    });

    test("throw non-error at import", async () => {
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

        🚨 ⧙1⧘ error found
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

        typeof imported.default === "undefined"

        These are the keys of ⧙imported⧘:

        []

        🚨 ⧙1⧘ error found
      `);
    });

    test("wrong default export", async () => {
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

        🚨 ⧙1⧘ error found
      `);
    });

    test("throw error", async () => {
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

        🚨 ⧙1⧘ error found
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
      `);
    });

    test("return undefined", async () => {
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

        🚨 ⧙1⧘ error found
      `);
    });
  });

  describe("CI", () => {
    const appPath = path.join(FIXTURES_DIR, "ci", "build", "app.js");

    test("CI scenario", async () => {
      if (fs.existsSync(appPath)) {
        fs.unlinkSync(appPath);
      }

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
        (no output)

        🚨 ⧙1⧘ error found
      `);
    });

    test("CI scenario – no color", async () => {
      if (fs.existsSync(appPath)) {
        fs.unlinkSync(appPath);
      }

      // Note: Postprocess is skipped when there are `elm make` errors.
      expect(
        await run("ci", ["make"], {
          env: {
            ...process.env,
            ...TEST_ENV,
            NO_COLOR: "",
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
      `);

      expect(fs.existsSync(appPath)).toBe(true);

      // Postprocess error.
      expect(
        await run("ci", ["make", "postprocess-error"], {
          env: {
            ...process.env,
            ...TEST_ENV,
            NO_COLOR: "",
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
      `);
    });
  });

  test("stuck in progress", async () => {
    expect(
      await run("valid", ["make"], {
        env: {
          ...process.env,
          ...TEST_ENV,
          ELM_WATCH_MAX_PARALLEL: "0",
        },
      })
    ).toMatchInlineSnapshot(`
      ✅ Dependencies
      ⚪️ app: queued
      ⚪️ admin: queued

      ⧙-- STUCK IN PROGRESS -----------------------------------------------------------⧘
      ⧙Target: app⧘

      I thought that all outputs had finished compiling, but my inner state says
      this output is still in the ⧙QueuedForElmMake⧘ phase.

      ⧙This is not supposed to ever happen.⧘

      ⧙-- STUCK IN PROGRESS -----------------------------------------------------------⧘
      ⧙Target: admin⧘

      I thought that all outputs had finished compiling, but my inner state says
      this output is still in the ⧙QueuedForElmMake⧘ phase.

      ⧙This is not supposed to ever happen.⧘

      🚨 ⧙2⧘ errors found
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

    test("elmWatchNodeImportError with null error", () => {
      expect(
        printError(
          Errors.elmWatchNodeImportError(
            {
              tag: "ElmWatchNodeScriptPath",
              theElmWatchNodeScriptPath: {
                tag: "AbsolutePath",
                absolutePath: "/Users/you/project/postprocess.cjs",
              },
            },
            // It’s not possible to test `throw null` at import – Jest crashes then.
            null
          )
        )
      ).toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/postprocess.cjs

        I tried to import your postprocess file:

        const imported = await import("/Users/you/project/postprocess.cjs")

        But that resulted in this error:

        null
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
        (no output)
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
        (no output)
      `);
    });
  });
});
