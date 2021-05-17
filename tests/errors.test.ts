import * as fs from "fs";
import * as path from "path";

import { elmWatchCli } from "../src";
import { Env, sha256 } from "../src/helpers";
import {
  clean,
  CursorWriteStream,
  FailReadStream,
  MemoryWriteStream,
  stringSnapshotSerializer,
} from "./helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "errors");

async function run(
  fixture: string,
  args: Array<string>,
  env: Env = {}
): Promise<string> {
  return runAbsolute(path.join(FIXTURES_DIR, fixture), args, env);
}

async function runAbsolute(
  dir: string,
  args: Array<string>,
  env: Env = {}
): Promise<string> {
  const stdout = new MemoryWriteStream();
  const stderr = new CursorWriteStream();

  const exitCode = await elmWatchCli(args, {
    cwd: dir,
    env,
    stdin: new FailReadStream(),
    stdout,
    stderr,
  });

  expect(stdout.content).toBe("");
  expect(exitCode).toBe(1);

  return clean(stderr.getOutput());
}

async function runWithBadElmBin(fixture: string): Promise<string> {
  const dir = path.join(FIXTURES_DIR, "valid");
  return runAbsolute(dir, ["make", "build/app.js"], {
    PATH: prependPATH(path.join(dir, "bad-bin", fixture)),
  });
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

  const output = await runAbsolute(dir, ["make", "build/app.js"], {
    PATH: prependPATH(path.join(dir, "bad-bin", fixture)),
  });

  const writtenJson = fs.readFileSync(jsonPath, "utf8");
  expect(writtenJson).toBe(expectedWrittenJson);

  return output;
}

function prependPATH(folder: string): string {
  return `${folder}${path.delimiter}${process.env.PATH ?? ""}`;
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("errors", () => {
  test("unknown command", async () => {
    expect(await run("wherever", ["nope"])).toMatchInlineSnapshot(
      `Unknown command: nope`
    );
  });

  test("elm-tooling.json is a folder", async () => {
    expect(await run("elm-tooling-json-is-folder", ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING elm-tooling.json --------------------------------------------⧘
      /Users/you/project/fixtures/errors/elm-tooling-json-is-folder/elm-tooling.json

      I read inputs, outputs and options from ⧙elm-tooling.json⧘.

      ⧙I had trouble reading it as JSON:⧘

      EISDIR: illegal operation on a directory, read
    `);
  });

  test("elm-tooling.json bad json", async () => {
    expect(await run("elm-tooling-json-bad-json", ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING elm-tooling.json --------------------------------------------⧘
      /Users/you/project/fixtures/errors/elm-tooling-json-bad-json/elm-tooling.json

      I read inputs, outputs and options from ⧙elm-tooling.json⧘.

      ⧙I had trouble reading it as JSON:⧘

      Unexpected end of JSON input
    `);
  });

  describe("elm-tooling.json decode errors", () => {
    test("missing x-elm-watch", async () => {
      expect(
        await run("elm-tooling-json-decode-error/missing-x-elm-watch", ["make"])
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/fixtures/errors/elm-tooling-json-decode-error/missing-x-elm-watch/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]:
        Expected an object
        Got: undefined
      `);
    });

    test("empty outputs", async () => {
      expect(await run("elm-tooling-json-decode-error/empty-outputs", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/fixtures/errors/elm-tooling-json-decode-error/empty-outputs/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]:
        Expected a non-empty object
        Got: {}
      `);
    });

    test("bad output extension", async () => {
      expect(
        await run("elm-tooling-json-decode-error/bad-output-extension", [
          "make",
        ])
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/fixtures/errors/elm-tooling-json-decode-error/bad-output-extension/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["index.html"]:
        Outputs must end with .js or be /dev/null
      `);
    });

    test("bad output extension – just .js", async () => {
      // The error message isn’t the best here but this very much an edge case anyway.
      expect(
        await run(
          "elm-tooling-json-decode-error/bad-output-extension-just-dot-js",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/fixtures/errors/elm-tooling-json-decode-error/bad-output-extension-just-dot-js/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"][".js"]:
        Outputs must end with .js or be /dev/null
      `);
    });

    test("unknown field", async () => {
      expect(await run("elm-tooling-json-decode-error/unknown-field", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/fixtures/errors/elm-tooling-json-decode-error/unknown-field/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]:
        Expected only these fields: "inputs", "postprocess"
        Found extra fields: "mode"
      `);
    });

    test("empty list of inputs", async () => {
      expect(await run("elm-tooling-json-decode-error/empty-inputs", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/fixtures/errors/elm-tooling-json-decode-error/empty-inputs/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]["inputs"]:
        Expected a non-empty array
        Got: []
      `);
    });

    test("bad input extension", async () => {
      expect(
        await run("elm-tooling-json-decode-error/bad-input-extension", ["make"])
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/fixtures/errors/elm-tooling-json-decode-error/bad-input-extension/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]["inputs"][0]:
        Inputs must have a valid module name and end with .elm
        Got: "src/Main.js"
      `);
    });

    test("bad input module name", async () => {
      expect(
        await run("elm-tooling-json-decode-error/bad-input-module-name", [
          "make",
        ])
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/fixtures/errors/elm-tooling-json-decode-error/bad-input-module-name/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]["inputs"][0]:
        Inputs must have a valid module name and end with .elm
        Got: "src/main.elm"
      `);
    });
  });

  test("elm-tooling.json not found", async () => {
    expect(await runAbsolute(path.parse(__dirname).root, ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- elm-tooling.json NOT FOUND --------------------------------------------------⧘

      I read inputs, outputs and options from ⧙elm-tooling.json⧘.

      ⧙But I couldn't find one!⧘

      You need to create one with JSON like this:

      {
          "x-elm-watch": {
              "outputs": {
                  "build/main.js": {
                      "inputs": [
                          "src/Main.elm"
                      ]
                  }
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
        ⧙-- UNEXPECTED ARGUMENTS --------------------------------------------------------⧘

        ⧙I only accept JS file paths as arguments, but I got some that don't look like that:⧘

        src/App.elm
        src/Admin.elm
        --output

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/errors/valid/elm-tooling.json

        For example, you could add some JSON like this:

        {
            "x-elm-watch": {
                "outputs": {
                    "bundle.js": {
                        "inputs": [
                            "src/App.elm",
                            "src/Admin.elm"
                        ]
                    }
                }
            }
        }
      `);
    });

    test("suggested inputs are relative to elm-tooling.json, not cwd", async () => {
      expect(
        await run("valid/src", ["make", "src/App.elm", "../lib/Admin.elm"])
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ARGUMENTS --------------------------------------------------------⧘

        ⧙I only accept JS file paths as arguments, but I got some that don't look like that:⧘

        src/App.elm
        ../lib/Admin.elm

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/errors/valid/elm-tooling.json

        For example, you could add some JSON like this:

        {
            "x-elm-watch": {
                "outputs": {
                    "build/main.js": {
                        "inputs": [
                            "src/src/App.elm",
                            "lib/Admin.elm"
                        ]
                    }
                }
            }
        }
      `);
    });

    test("support --output=/dev/null", async () => {
      expect(await run("valid", ["make", "--output=/dev/null"]))
        .toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ARGUMENTS --------------------------------------------------------⧘

        ⧙I only accept JS file paths as arguments, but I got some that don't look like that:⧘

        --output=/dev/null

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/errors/valid/elm-tooling.json

        For example, you could add some JSON like this:

        {
            "x-elm-watch": {
                "outputs": {
                    "/dev/null": {
                        "inputs": [
                            "src/Main.elm"
                        ]
                    }
                }
            }
        }
      `);
    });

    test("ignore invalid stuff", async () => {
      expect(
        await run("valid", [
          "make",
          "src/app.elm",
          "--output",
          ".js",
          "ignored.js",
          "--docs",
          "docs.json",
        ])
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ARGUMENTS --------------------------------------------------------⧘

        ⧙I only accept JS file paths as arguments, but I got some that don't look like that:⧘

        src/app.elm
        --output
        .js
        --docs
        docs.json

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/errors/valid/elm-tooling.json

        For example, you could add some JSON like this:

        {
            "x-elm-watch": {
                "outputs": {
                    "build/main.js": {
                        "inputs": [
                            "src/Main.elm"
                        ]
                    }
                }
            }
        }
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

  test("unknown outputs", async () => {
    expect(
      await run("valid", ["make", "build/app.js", "build/adnim.js", "app.js"])
    ).toMatchInlineSnapshot(`
      ⧙-- UNKNOWN OUTPUTS -------------------------------------------------------------⧘
      /Users/you/project/fixtures/errors/valid/elm-tooling.json

      I read inputs, outputs and options from ⧙elm-tooling.json⧘.

      It contains these outputs:

      build/app.js
      build/admin.js

      ⧙But those don't include these outputs you asked me to build:⧘

      build/adnim.js
      app.js

      Is something misspelled? (You need to type them exactly the same.)
      Or do you need to add some more outputs?
    `);
  });

  describe("inputs errors", () => {
    test("inputs not found", async () => {
      expect(await run("inputs-not-found", ["make"])).toMatchInlineSnapshot(`
        🚨 main.js

        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙When compiling: main.js⧘

        You asked me to compile these inputs:

        Main.elm ⧙(/Users/you/project/fixtures/errors/inputs-not-found/Main.elm)⧘
        pages/About.elm ⧙(/Users/you/project/fixtures/errors/inputs-not-found/pages/About.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?

        🚨 ⧙1⧘ error found
      `);
    });

    test("symlink loop", async () => {
      expect(await run("symlink-loop", ["make"])).toMatchInlineSnapshot(`
        🚨 main.js

        ⧙-- INPUTS FAILED TO RESOLVE ----------------------------------------------------⧘
        ⧙When compiling: main.js⧘

        I start by checking if the inputs you give me exist,
        but doing so resulted in errors!

        Main.elm:
        ELOOP: too many symbolic links encountered, stat '/Users/you/project/fixtures/errors/symlink-loop/Main.elm'

        ⧙That's all I know, unfortunately!⧘

        🚨 ⧙1⧘ error found
      `);
    });

    test("duplicate inputs", async () => {
      expect(await run("duplicate-inputs", ["make"])).toMatchInlineSnapshot(`
        🚨 main.js

        ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
        ⧙When compiling: main.js⧘

        Some of your inputs seem to be duplicates!

        Main.elm
        ../duplicate-inputs/./Main.elm
        -> /Users/you/project/fixtures/errors/duplicate-inputs/Main.elm

        Make sure every input is listed just once!

        🚨 ⧙1⧘ error found
      `);
    });

    test("duplicate inputs with symlinks", async () => {
      expect(await run("duplicate-inputs-with-symlinks", ["make"]))
        .toMatchInlineSnapshot(`
        🚨 main.js

        ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
        ⧙When compiling: main.js⧘

        Some of your inputs seem to be duplicates!

        Main.elm
        Symlink1.elm ⧙(symlink)⧘
        Symlink2.elm ⧙(symlink)⧘
        -> /Users/you/project/fixtures/errors/duplicate-inputs-with-symlinks/Main.elm

        Other.elm
        Other.elm
        -> /Users/you/project/fixtures/errors/duplicate-inputs-with-symlinks/Other.elm

        Make sure every input is listed just once!

        Note that at least one of the inputs seems to be a symlink. They can be tricky!

        🚨 ⧙1⧘ error found
      `);
    });
  });

  describe("elm.json errors", () => {
    test("elm.json not found", async () => {
      expect(await run("elm-json-not-found", ["make"])).toMatchInlineSnapshot(`
        🚨 main.js

        ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
        ⧙When compiling: main.js⧘

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
        🚨 main.js

        ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
        ⧙When compiling: main.js⧘

        I could not find an ⧙elm.json⧘ for these inputs:

        Main.elm

        Has it gone missing? Maybe run ⧙elm init⧘ to create one?

        Note that I did find an ⧙elm.json⧘ for some inputs:

        pages/About.elm
        -> /Users/you/project/fixtures/errors/elm-json-not-found-for-all/pages/elm.json

        Make sure that one single ⧙elm.json⧘ covers all the inputs together!

        🚨 ⧙1⧘ error found
      `);
    });

    test("non unique elm.json", async () => {
      expect(await run("non-unique-elm-json", ["make"])).toMatchInlineSnapshot(`
        🚨 main.js

        ⧙-- NO UNIQUE elm.json ----------------------------------------------------------⧘
        ⧙When compiling: main.js⧘

        I went looking for an ⧙elm.json⧘ for your inputs, but I found more than one!

        Main.elm
        -> /Users/you/project/fixtures/errors/non-unique-elm-json/elm.json

        pages/About.elm
        -> /Users/you/project/fixtures/errors/non-unique-elm-json/pages/elm.json

        It doesn't make sense to compile Elm files from different projects into one output.

        Either split this output, or move the inputs to the same project with the same
        ⧙elm.json⧘.

        🚨 ⧙1⧘ error found
      `);
    });

    test("elm not found", async () => {
      expect(
        await run("valid", ["make"], {
          PATH: [__dirname, path.join(__dirname, "some", "bin")].join(
            path.delimiter
          ),
        })
      ).toMatchInlineSnapshot(`
        🚨 build/app.js
        🚨 build/admin.js

        ⧙-- ELM NOT FOUND ---------------------------------------------------------------⧘
        ⧙When compiling: build/app.js⧘

        I tried to execute ⧙elm⧘, but it does not appear to exist!

        This is what the PATH environment variable looks like:

        /Users/you/project
        /Users/you/project/some/bin

        Is Elm installed?

        Note: If you have installed Elm locally (for example using npm or elm-tooling),
        execute elm-watch using npx to make elm-watch automatically pick up that local
        installation: ⧙npx elm-watch⧘

        ⧙-- ELM NOT FOUND ---------------------------------------------------------------⧘
        ⧙When compiling: build/admin.js⧘

        I tried to execute ⧙elm⧘, but it does not appear to exist!

        This is what the PATH environment variable looks like:

        /Users/you/project
        /Users/you/project/some/bin

        Is Elm installed?

        Note: If you have installed Elm locally (for example using npm or elm-tooling),
        execute elm-watch using npx to make elm-watch automatically pick up that local
        installation: ⧙npx elm-watch⧘

        🚨 ⧙2⧘ errors found
      `);
    });

    test("elm make json syntax error", async () => {
      expect(await runWithBadElmBinAndExpectedJson("json-syntax-error", "{"))
        .toMatchInlineSnapshot(`
        🚨 build/app.js

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙When compiling: build/app.js⧘

        I ran the following commands:

        cd /Users/you/project/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        Unexpected end of JSON input

        I wrote the JSON to this file so you can inspect it:

        /Users/you/project/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96.json

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
        🚨 build/app.js

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙When compiling: build/app.js⧘

        I ran the following commands:

        cd /Users/you/project/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        At root["type"]:
        Expected one of these tags: "error", "compile-errors"
        Got: "laser-error"

        I wrote the JSON to this file so you can inspect it:

        /Users/you/project/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fe311e7464d5d116f8fa1ddccbc22767d9b6c74bfdd28d0719fb55ef7c1037a6.json

        🚨 ⧙1⧘ error found
      `);
    });

    test("elm make json error failed to write", async () => {
      expect(await runWithBadElmBin("json-error-failed-write"))
        .toMatchInlineSnapshot(`
        🚨 build/app.js

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙When compiling: build/app.js⧘

        I ran the following commands:

        cd /Users/you/project/fixtures/errors/valid
        elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        Unexpected token { in JSON at position 1

        I tried to write the JSON to this file:

        /Users/you/project/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fb337d3432f9465ea0a23c33debf6525c68f21f95061a35ff08c271f6c8e176b.json

        ⧙But that failed too:⧘

        EISDIR: illegal operation on a directory, open '/Users/you/project/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fb337d3432f9465ea0a23c33debf6525c68f21f95061a35ff08c271f6c8e176b.json'

        🚨 ⧙1⧘ error found
      `);
    });

    describe("unexpected `elm make` output", () => {
      test("exit 0 + stdout", async () => {
        expect(await runWithBadElmBin("exit-0-stdout")).toMatchInlineSnapshot(`
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

          I ran the following commands:

          cd /Users/you/project/fixtures/errors/valid
          elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

          I ran the following commands:

          cd /Users/you/project/fixtures/errors/valid
          elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

          I ran the following commands:

          cd /Users/you/project/fixtures/errors/valid
          elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

          I ran the following commands:

          cd /Users/you/project/fixtures/errors/valid
          elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

          I ran the following commands:

          cd /Users/you/project/fixtures/errors/valid
          elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

          I ran the following commands:

          cd /Users/you/project/fixtures/errors/valid
          elm make --report=json --output=/Users/you/project/fixtures/errors/valid/build/app.js /Users/you/project/fixtures/errors/valid/src/App.elm

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
});
