import * as path from "path";

import elmWatchCli from "../src";
import {
  clean,
  FailReadStream,
  MemoryWriteStream,
  stringSnapshotSerializer,
} from "./helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "input-validation");

async function validateFailHelper(
  fixture: string,
  args: Array<string>
): Promise<string> {
  return validateFailHelperAbsolute(path.join(FIXTURES_DIR, fixture), args);
}

async function validateFailHelperAbsolute(
  dir: string,
  args: Array<string>
): Promise<string> {
  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(args, {
    cwd: dir,
    env: {},
    stdin: new FailReadStream(),
    stdout,
    stderr,
  });

  expect(stdout.content).toBe("");
  expect(exitCode).toBe(1);

  return clean(stderr.content);
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("input validation", () => {
  test("elm-tooling.json is a folder", async () => {
    expect(await validateFailHelper("elm-tooling-json-is-folder", ["make"]))
      .toMatchInlineSnapshot(`
      I read inputs, outputs and options from ⧙elm-tooling.json⧘.

      I found an ⧙elm-tooling.json⧘ here:

      /Users/you/project/fixtures/input-validation/elm-tooling-json-is-folder/elm-tooling.json

      ⧙But I had trouble reading it as JSON:⧘

      EISDIR: illegal operation on a directory, read

    `);
  });

  test("elm-tooling.json bad json", async () => {
    expect(await validateFailHelper("elm-tooling-json-bad-json", ["make"]))
      .toMatchInlineSnapshot(`
      I read inputs, outputs and options from ⧙elm-tooling.json⧘.

      I found an ⧙elm-tooling.json⧘ here:

      /Users/you/project/fixtures/input-validation/elm-tooling-json-bad-json/elm-tooling.json

      ⧙But I had trouble reading it as JSON:⧘

      Unexpected end of JSON input

    `);
  });

  describe("elm-tooling.json decode errors", () => {
    test("missing x-elm-watch", async () => {
      expect(
        await validateFailHelper(
          "elm-tooling-json-decode-error/missing-x-elm-watch",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/missing-x-elm-watch/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]:
        Expected an object
        Got: undefined

      `);
    });

    test("empty outputs", async () => {
      expect(
        await validateFailHelper(
          "elm-tooling-json-decode-error/empty-outputs",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/empty-outputs/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]:
        Expected a non-empty object
        Got: {}

      `);
    });

    test("bad output extension", async () => {
      expect(
        await validateFailHelper(
          "elm-tooling-json-decode-error/bad-output-extension",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/bad-output-extension/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["index.html"]:
        Outputs must end with .js or be /dev/null

      `);
    });

    test("bad output extension – just .js", async () => {
      // The error message isn’t the best here but this very much an edge case anyway.
      expect(
        await validateFailHelper(
          "elm-tooling-json-decode-error/bad-output-extension-just-dot-js",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/bad-output-extension-just-dot-js/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"][".js"]:
        Outputs must end with .js or be /dev/null

      `);
    });

    test("unknown field", async () => {
      expect(
        await validateFailHelper(
          "elm-tooling-json-decode-error/unknown-field",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/unknown-field/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]:
        Expected only these fields: "inputs", "mode"
        Found extra fields: "node"

    `);
    });

    test("empty list of inputs", async () => {
      expect(
        await validateFailHelper("elm-tooling-json-decode-error/empty-inputs", [
          "make",
        ])
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/empty-inputs/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]["inputs"]:
        Expected a non-empty array
        Got: []

      `);
    });

    test("bad input extension", async () => {
      expect(
        await validateFailHelper(
          "elm-tooling-json-decode-error/bad-input-extension",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/bad-input-extension/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]["inputs"][0]:
        Inputs must have a valid module name and end with .elm
        Got: "src/Main.js"

      `);
    });

    test("bad input module name", async () => {
      expect(
        await validateFailHelper(
          "elm-tooling-json-decode-error/bad-input-module-name",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/bad-input-module-name/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]["inputs"][0]:
        Inputs must have a valid module name and end with .elm
        Got: "src/main.elm"

      `);
    });

    test("bad compilation mode", async () => {
      expect(
        await validateFailHelper(
          "elm-tooling-json-decode-error/bad-compilation-mode",
          ["make"]
        )
      ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        I found an ⧙elm-tooling.json⧘ here:

        /Users/you/project/fixtures/input-validation/elm-tooling-json-decode-error/bad-compilation-mode/elm-tooling.json

        ⧙But I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["main.js"]["mode"] (optional):
        Expected one of these variants: "standard", "debug", "optimize"
        Got: "production"

      `);
    });
  });

  test("elm-tooling.json not found", async () => {
    expect(
      await validateFailHelperAbsolute(path.parse(__dirname).root, ["make"])
    ).toMatchInlineSnapshot(`
        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙But I couldn’t find one!⧘

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
        await validateFailHelper("valid-elm-tooling-json", [
          "make",
          "src/App.elm",
          "src/Admin.elm",
          "--output",
          "bundle.js",
          "--debug",
        ])
      ).toMatchInlineSnapshot(`
        ⧙I only accept JS file paths as arguments, but I got some that don’t look like that:⧘

        src/App.elm
        src/Admin.elm
        --output
        --debug

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/input-validation/valid-elm-tooling-json/elm-tooling.json

        For example, you could add some JSON like this:

        {
            "x-elm-watch": {
                "outputs": {
                    "bundle.js": {
                        "inputs": [
                            "src/App.elm",
                            "src/Admin.elm"
                        ],
                        "mode": "debug"
                    }
                }
            }
        }

      `);
    });

    test("suggested inputs are relative to elm-tooling.json, not cwd", async () => {
      expect(
        await validateFailHelper("valid-elm-tooling-json/src", [
          "make",
          "src/App.elm",
          "../lib/Admin.elm",
        ])
      ).toMatchInlineSnapshot(`
        ⧙I only accept JS file paths as arguments, but I got some that don’t look like that:⧘

        src/App.elm
        ../lib/Admin.elm

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/input-validation/valid-elm-tooling-json/elm-tooling.json

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
      expect(
        await validateFailHelper("valid-elm-tooling-json", [
          "make",
          "--output=/dev/null",
        ])
      ).toMatchInlineSnapshot(`
        ⧙I only accept JS file paths as arguments, but I got some that don’t look like that:⧘

        --output=/dev/null

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/input-validation/valid-elm-tooling-json/elm-tooling.json

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
        await validateFailHelper("valid-elm-tooling-json", [
          "make",
          "src/app.elm",
          "--output",
          ".js",
          "ignored.js",
          "--docs",
          "docs.json",
        ])
      ).toMatchInlineSnapshot(`
        ⧙I only accept JS file paths as arguments, but I got some that don’t look like that:⧘

        src/app.elm
        --output
        .js
        --docs
        docs.json

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/input-validation/valid-elm-tooling-json/elm-tooling.json

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

    test("the last of --debug and --optimize wins", async () => {
      expect(
        await validateFailHelper("valid-elm-tooling-json", [
          "make",
          "--debug",
          "--optimize",
        ])
      ).toMatchInlineSnapshot(`
        ⧙I only accept JS file paths as arguments, but I got some that don’t look like that:⧘

        --debug
        --optimize

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/input-validation/valid-elm-tooling-json/elm-tooling.json

        For example, you could add some JSON like this:

        {
            "x-elm-watch": {
                "outputs": {
                    "build/main.js": {
                        "inputs": [
                            "src/Main.elm"
                        ],
                        "mode": "optimize"
                    }
                }
            }
        }

      `);

      expect(
        await validateFailHelper("valid-elm-tooling-json", [
          "make",
          "--optimize",
          "--debug",
        ])
      ).toMatchInlineSnapshot(`
        ⧙I only accept JS file paths as arguments, but I got some that don’t look like that:⧘

        --optimize
        --debug

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/fixtures/input-validation/valid-elm-tooling-json/elm-tooling.json

        For example, you could add some JSON like this:

        {
            "x-elm-watch": {
                "outputs": {
                    "build/main.js": {
                        "inputs": [
                            "src/Main.elm"
                        ],
                        "mode": "debug"
                    }
                }
            }
        }

      `);
    });
  });

  test("unknown outputs", async () => {
    expect(
      await validateFailHelper("valid-elm-tooling-json", [
        "make",
        "build/app.js",
        "build/adnim.js",
        "app.js",
      ])
    ).toMatchInlineSnapshot(`
      I read inputs, outputs and options from ⧙elm-tooling.json⧘.

      I found an ⧙elm-tooling.json⧘ here:

      /Users/you/project/fixtures/input-validation/valid-elm-tooling-json/elm-tooling.json

      It contains these outputs:

      build/app.js
      build/admin.js

      ⧙But those don’t include these outputs you asked me to build:⧘

      build/adnim.js
      app.js

      Is something misspelled? (You need to type them exactly the same.)
      Or do you need to add some more outputs?

    `);
  });
});
