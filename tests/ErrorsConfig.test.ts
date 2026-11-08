import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import type * as ElmWatchJson from "../src/ElmWatchJson.ts";
import { NO_COLOR } from "../src/Env.ts";
import {
  elmBinAlwaysSucceedEnv,
  fixtureDir,
  run,
  runAbsolute,
} from "./ErrorsHelpers.ts";
import {
  describeExceptWindows,
  rimraf,
  stringSnapshotSerializer,
  TEST_ENV,
  testExceptWindows,
} from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("errors", () => {
  test("unknown command", async () => {
    expect(
      await run("wherever", ["nope"], { originalStdout: true }),
    ).toMatchInlineSnapshot(`Unknown command: nope`);
  });

  test("elm-watch.json is a folder", async () => {
    expect(await run("elm-watch-json-is-folder", ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING elm-watch.json ----------------------------------------------⧘
      /Users/you/project/tests/fixtures/errors/elm-watch-json-is-folder/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble reading it:⧘

      EISDIR: illegal operation on a directory, read
    `);
  });

  test("elm-watch.json bad json", async () => {
    expect(await run("elm-watch-json-bad-json", ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
      /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-json/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble with the JSON inside:⧘

      At root:
      SyntaxError: (JSON syntax error)
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
          await run("elm-watch-json-bad-target-name/starts-with-dash", [
            "make",
          ]),
        ).toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-target-name/starts-with-dash/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["-main"]:
          Target names must start with a non-whitespace character except \`-\`,
          cannot contain newlines and must end with a non-whitespace character
          Got: "-main"
        `);
      });

      test("starts with whitespace", async () => {
        expect(
          await run("elm-watch-json-bad-target-name/starts-with-whitespace", [
            "make",
          ]),
        ).toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-target-name/starts-with-whitespace/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["\\tmain"]:
          Target names must start with a non-whitespace character except \`-\`,
          cannot contain newlines and must end with a non-whitespace character
          Got: "\\tmain"
        `);
      });

      test("contains newline", async () => {
        expect(
          await run("elm-watch-json-bad-target-name/contains-newline", [
            "make",
          ]),
        ).toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-target-name/contains-newline/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["main\\ntarget"]:
          Target names must start with a non-whitespace character except \`-\`,
          cannot contain newlines and must end with a non-whitespace character
          Got: "main\\ntarget"
        `);
      });

      test("ends with whitespace", async () => {
        expect(
          await run("elm-watch-json-bad-target-name/ends-with-whitespace", [
            "make",
          ]),
        ).toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-bad-target-name/ends-with-whitespace/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["main "]:
          Target names must start with a non-whitespace character except \`-\`,
          cannot contain newlines and must end with a non-whitespace character
          Got: "main "
        `);
      });
    });

    test("bad output extension", async () => {
      expect(
        await run("elm-watch-json-decode-error/bad-output-extension", ["make"]),
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/bad-output-extension/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["index"]["output"]:
        Outputs must end with .js
        Got: "index.html"
      `);
    });

    test("bad output extension – just .js", async () => {
      // The error message isn’t the best here but this very much an edge case anyway.
      expect(
        await run(
          "elm-watch-json-decode-error/bad-output-extension-just-dot-js",
          ["make"],
        ),
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/bad-output-extension-just-dot-js/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]["output"]:
        Outputs must end with .js
        Got: ".js"
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
        Got: "/dev/null"
      `);
    });

    test("old target format", async () => {
      expect(
        await run("elm-watch-json-decode-error/old-target-format", ["make"]),
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/old-target-format/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]:
        Targets now need "type" and "elmJson" fields, for example:
        "type": "application",
        "elmJson": "elm.json",
        Run \`elm-watch init\` to add them automatically.
        Got: {
          "inputs": Array(1),
          "output": "main.js"
        }
      `);
    });

    test("unknown target type", async () => {
      expect(await run("elm-watch-json-decode-error/unknown-type", ["make"]))
        .toMatchInlineSnapshot(`
          ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/unknown-type/elm-watch.json

          I read inputs, outputs and options from ⧙elm-watch.json⧘.

          ⧙I had trouble with the JSON inside:⧘

          At root["targets"]["main"]["type"]:
          Expected one of these tags:
            "application",
            "package"
          Got: "app"
        `);
    });

    test("elmJson must point to elm.json", async () => {
      expect(
        await run("elm-watch-json-decode-error/bad-elm-json-path", ["make"]),
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-json-decode-error/bad-elm-json-path/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["main"]["elmJson"]:
        Expected a path to a file called elm.json
        Got: "src"
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
          Expected only these fields:
            "type",
            "elmJson",
            "inputs",
            "output"
          Found extra fields:
            "mode"
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
        await run("elm-watch-json-decode-error/bad-input-extension", ["make"]),
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
        await run("elm-watch-json-decode-error/bad-input-module-name", [
          "make",
        ]),
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

        At root["port"]:
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

        At root["port"]:
        Expected an integer where 1 <= port <= 65535
        Got: 65536
      `);
    });
  });

  test("elm-watch.json not found", async () => {
    expect(await runAbsolute(path.parse(import.meta.dirname).root, ["make"]))
      .toMatchInlineSnapshot(`
        ⧙-- elm-watch.json NOT FOUND ----------------------------------------------------⧘

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙But I couldn't find one!⧘

        You need to create one with JSON like this:

        {
            "targets": {
                "My target name": {
                    "type": "application",
                    "elmJson": "elm.json",
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
      await runAbsolute(path.parse(import.meta.dirname).root, [
        "make",
        "src/Game.elm",
        "--output",
        "dist/game.js",
      ]),
    ).toMatchInlineSnapshot(`
      ⧙-- elm-watch.json NOT FOUND ----------------------------------------------------⧘

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙But I couldn't find one!⧘

      You need to create one with JSON like this:

      {
          "targets": {
              "My target name": {
                  "type": "application",
                  "elmJson": "elm.json",
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
        ]),
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
                "My target name": {
                    "type": "application",
                    "elmJson": "elm.json",
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
        await run("valid", ["make", "src/App.elm", "--loglevel=silent", "-f"]),
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
        ]),
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
                "My target name": {
                    "type": "application",
                    "elmJson": "elm.json",
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
        ]),
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
      await run("valid", ["make", "build/app.js", "build/adnim.js", "app.js"]),
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
        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙Target: main⧘

        You asked me to compile these inputs:

        Main.elm ⧙(/Users/you/project/tests/fixtures/errors/inputs-not-found/Main.elm)⧘
        pages/About.elm ⧙(/Users/you/project/tests/fixtures/errors/inputs-not-found/pages/About.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?
      `);
    });

    describeExceptWindows("symlink loop", () => {
      // This has to be done in a directory outside the repo,
      // to avoid Vitest’s watcher crashing when it tries to stat the symlinks.
      const dir = path.join(os.tmpdir(), "elm-watch-symlink-loop");
      const symlink1 = path.join(dir, "Main.elm");
      const symlink2 = path.join(dir, "Other.elm");
      const elmWatchJsonFile = path.join(dir, "elm-watch.json");
      const elmWatchJson: ElmWatchJson.ElmWatchJson = {
        targets: {
          main: {
            type: "application",
            elmJson: "elm.json",
            inputs: ["Main.elm"],
            output: "main.js",
          },
        },
      };

      async function deleteTempDir(): Promise<void> {
        await rimraf(dir);
      }

      beforeEach(async () => {
        await deleteTempDir();
        fs.mkdirSync(dir);
        fs.writeFileSync(
          elmWatchJsonFile,
          JSON.stringify(elmWatchJson, null, 2),
        );
        fs.symlinkSync(symlink1, symlink2);
        fs.symlinkSync(symlink2, symlink1);
      });

      afterEach(deleteTempDir);

      test("make", async () => {
        expect(await runAbsolute(dir, ["make"])).toMatchInlineSnapshot(`
          ⧙-- INPUTS FAILED TO RESOLVE ----------------------------------------------------⧘
          ⧙Target: main⧘

          I start by checking if the inputs you give me exist,
          but doing so resulted in errors!

          Main.elm:
          ELOOP: too many symbolic links encountered, stat '/tmp/fake/elm-watch-symlink-loop/Main.elm'

          ⧙That's all I know, unfortunately!⧘
        `);
      });

      test("hot", async () => {
        expect(await runAbsolute(dir, ["hot"], { exitHotOnError: true }))
          .toMatchInlineSnapshot(`
            ⧙-- INPUTS FAILED TO RESOLVE ----------------------------------------------------⧘
            ⧙Target: main⧘

            I start by checking if the inputs you give me exist,
            but doing so resulted in errors!

            Main.elm:
            ELOOP: too many symbolic links encountered, stat '/tmp/fake/elm-watch-symlink-loop/Main.elm'

            ⧙That's all I know, unfortunately!⧘
          `);
      });
    });

    test("hot failure to read previous output file", async () => {
      expect(await run("output-is-folder", ["hot"], { exitHotOnError: true }))
        .toMatchInlineSnapshot(`
        ⧙-- TROUBLE CHECKING OUTPUT -----------------------------------------------------⧘
        ⧙Target: Main⧘

        I managed to typecheck your code. Then I tried to read part of the previous output,
        to see if I need to write a dummy output file there:

        /Users/you/project/tests/fixtures/errors/output-is-folder/output/Main.js

        Doing so I encountered this error:

        EISDIR: illegal operation on a directory, read
      `);
    });

    test("duplicate inputs", async () => {
      expect(await run("duplicate-inputs", ["make"])).toMatchInlineSnapshot(`
        ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
        ⧙Target: main⧘

        Some of your inputs seem to be duplicates!

        Main.elm
        ../duplicate-inputs/./Main.elm
        -> /Users/you/project/tests/fixtures/errors/duplicate-inputs/Main.elm

        Make sure every input is listed just once!
      `);
    });

    testExceptWindows("duplicate inputs with symlinks", async () => {
      // elm-watch.json refers to ../duplicate-inputs/.
      fixtureDir("duplicate-inputs");
      expect(await run("duplicate-inputs-with-symlinks", ["make"]))
        .toMatchInlineSnapshot(`
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
      `);
    });
  });

  describe("elm.json errors", () => {
    test("elm.json not found, with long target name", async () => {
      expect(await run("elm-json-not-found", ["make"])).toMatchInlineSnapshot(`
        ⧙-- elm.json NOT FOUND ----------------------------------------------------------⧘
        ⧙Target: yooooooooooooooooooooooooooooloooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo⧘

        I could not find the ⧙elm.json⧘ for this target:

        /Users/you/project/tests/fixtures/errors/elm-json-not-found/elm.json

        Is "elmJson" misspelled? Or do you need to run ⧙elm init⧘ to create it?
      `);
    });

    test("elm.json not found (non-fancy)", async () => {
      expect(
        await run("elm-json-not-found", ["make"], {
          env: {
            ...process.env,
            ...TEST_ENV,
            [NO_COLOR]: "",
          },
        }),
      ).toMatchInlineSnapshot(`
        -- elm.json NOT FOUND ----------------------------------------------------------
        Target: yooooooooooooooooooooooooooooloooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo

        I could not find the elm.json for this target:

        /Users/you/project/tests/fixtures/errors/elm-json-not-found/elm.json

        Is "elmJson" misspelled? Or do you need to run elm init to create it?

        1 error found

        Compilation finished in 123 ms.
      `);
    });

    test("package target with application elm.json", async () => {
      expect(await run("elm-json-type-mismatch-package", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- elm.json TYPE MISMATCH ------------------------------------------------------⧘
        ⧙Target: main⧘

        This target has ⧙"type": "package"⧘, but its ⧙elm.json⧘ has ⧙"type": "application"⧘:

        /Users/you/project/tests/fixtures/errors/elm-json-type-mismatch-package/elm.json

        Either change the "type" of the target, or use another ⧙elm.json⧘.

        Note: Package targets typecheck an Elm package, like running \`elm make\` without
        arguments. To compile Elm files with \`main\` to JavaScript, use
        "type": "application" (with inputs and output) instead.
      `);
    });

    test("package elm.json used by several targets", async () => {
      expect(await run("non-unique-package-elm-json", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- PACKAGE elm.json USED BY SEVERAL TARGETS ------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/non-unique-package-elm-json/elm-watch.json

        A package target typechecks everything in its package, so it must be the only
        target using its ⧙elm.json⧘. But these are used by several targets:

        /Users/you/project/tests/fixtures/errors/non-unique-package-elm-json/elm.json
        -> Package (package)
        -> Package again (package)
        -> Demo (application)

        Make sure that every package target has an ⧙elm.json⧘ of its own!
      `);
    });

    test("package target with type error", async () => {
      expect(await run("package-type-error", ["make"])).toMatchInlineSnapshot(`
        ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/package-type-error/src/Package/Internal.elm:6:5

        Something is off with the body of the \`greeting\` definition:

        6|     1
               ⧙^⧘
        The body is a number of type:

            ⧙number⧘

        But the type annotation on \`greeting\` says it should be:

            ⧙String⧘

        ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?
      `);
    });

    test("application target with package elm.json", async () => {
      expect(await run("elm-json-type-mismatch-application", ["make"]))
        .toMatchInlineSnapshot(`
          ⧙-- elm.json TYPE MISMATCH ------------------------------------------------------⧘
          ⧙Target: main⧘

          This target has ⧙"type": "application"⧘, but its ⧙elm.json⧘ has ⧙"type": "package"⧘:

          /Users/you/project/tests/fixtures/errors/elm-json-type-mismatch-application/elm.json

          Either change the "type" of the target, or use another ⧙elm.json⧘.

          Note: Application targets compile Elm files with \`main\` to JavaScript. To
          typecheck a package, use "type": "package" (without inputs and output) instead.
          To try out a package in the browser, make an application with its own elm.json
          (for example in examples/), with the package's src/ in "source-directories".
        `);
    });

    test("is a folder", async () => {
      expect(
        await run("elm-json-is-folder", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        }),
      ).toMatchInlineSnapshot(`
        ⧙-- TROUBLE READING elm.json ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-json-is-folder/elm.json

        I read "source-directories" from ⧙elm.json⧘ when figuring out all Elm files that
        your inputs depend on.

        ⧙I had trouble reading it:⧘

        EISDIR: illegal operation on a directory, read

        (I still managed to compile your code, but the watcher will not work properly
        and postprocess was not run.)
      `);
    });

    test("bad json", async () => {
      expect(
        await run("elm-json-bad-json", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        }),
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm.json FORMAT -----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-json-bad-json/elm.json

        I read "source-directories" from ⧙elm.json⧘ when figuring out all Elm files that
        your inputs depend on.

        ⧙I had trouble with the JSON inside:⧘

        At root:
        SyntaxError: (JSON syntax error)

        (I still managed to compile your code, but the watcher will not work properly
        and postprocess was not run.)
      `);
    });

    test("decode error", async () => {
      expect(
        await run("elm-json-decode-error", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        }),
      ).toMatchInlineSnapshot(`
        ⧙-- INVALID elm.json FORMAT -----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-json-decode-error/elm.json

        I read "source-directories" from ⧙elm.json⧘ when figuring out all Elm files that
        your inputs depend on.

        ⧙I had trouble with the JSON inside:⧘

        At root["type"]:
        Expected one of these tags:
          "application",
          "package"
        Got: "hackage"

        (I still managed to compile your code, but the watcher will not work properly
        and postprocess was not run.)
      `);
    });
  });
});
