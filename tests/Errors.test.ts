import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { elmWatchCli } from "../src";
import { Env, sha256 } from "../src/Helpers";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  failGetNow,
  FailReadStream,
  MemoryWriteStream,
  prependPATH,
  stringSnapshotSerializer,
} from "./Helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "errors");

const NO_DELAY = { __ELM_WATCH_LOADING_MESSAGE_DELAY: "0" };

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
            ...NO_DELAY,
          }
        : env,
    stdin: new FailReadStream(),
    stdout,
    stderr,
    getNow: failGetNow,
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
    PATH: prependPATH(path.join(dir, "bad-bin", fixture)),
    // The default timeout is optimized for calling Elm directly.
    // The bad-bin `elm`s are Node.js scripts – just starting Node.js can take
    // 100ms. So raise the bar to stabilize the tests.
    __ELM_WATCH_LOADING_MESSAGE_DELAY: "10000",
  };
}

async function runWithBadElmBin(fixture: string): Promise<string> {
  const dir = path.join(FIXTURES_DIR, "valid");
  return runAbsolute(dir, ["make", "build/app.js"], {
    env: badElmBinEnv(dir, fixture),
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
    env: badElmBinEnv(dir, fixture),
  });

  let writtenJson;
  try {
    writtenJson = fs.readFileSync(jsonPath, "utf8");
  } catch (errorAny) {
    const error = errorAny as Error;
    throw new Error(
      `Expected ${jsonPath} to exist.\n\n${error.message}\n\n${output}`
    );
  }
  expect(writtenJson).toBe(expectedWrittenJson);

  return output;
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
      /Users/you/project/tests/fixtures/errors/elm-tooling-json-is-folder/elm-tooling.json

      I read inputs, outputs and options from ⧙elm-tooling.json⧘.

      ⧙I had trouble reading it as JSON:⧘

      EISDIR: illegal operation on a directory, read
    `);
  });

  test("elm-tooling.json bad json", async () => {
    expect(await run("elm-tooling-json-bad-json", ["make"]))
      .toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING elm-tooling.json --------------------------------------------⧘
      /Users/you/project/tests/fixtures/errors/elm-tooling-json-bad-json/elm-tooling.json

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
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/missing-x-elm-watch/elm-tooling.json

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
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/empty-outputs/elm-tooling.json

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
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/bad-output-extension/elm-tooling.json

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
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/bad-output-extension-just-dot-js/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"][".js"]:
        Outputs must end with .js or be /dev/null
      `);
    });

    test("/dev/null must be exactly that", async () => {
      expect(await run("elm-tooling-json-decode-error/bad-dev-null", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/bad-dev-null/elm-tooling.json

        I read inputs, outputs and options from ⧙elm-tooling.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["x-elm-watch"]["outputs"]["/usr/../dev/null"]:
        Outputs must end with .js or be /dev/null
      `);
    });

    test("unknown field", async () => {
      expect(await run("elm-tooling-json-decode-error/unknown-field", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-tooling.json FORMAT ---------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/unknown-field/elm-tooling.json

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
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/empty-inputs/elm-tooling.json

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
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/bad-input-extension/elm-tooling.json

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
        /Users/you/project/tests/fixtures/errors/elm-tooling-json-decode-error/bad-input-module-name/elm-tooling.json

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

        /Users/you/project/tests/fixtures/errors/valid/elm-tooling.json

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

        /Users/you/project/tests/fixtures/errors/valid/elm-tooling.json

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

        /Users/you/project/tests/fixtures/errors/valid/elm-tooling.json

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
          "--output=.js",
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
        --output=.js
        --docs
        docs.json

        You either need to remove those arguments or move them to the ⧙elm-tooling.json⧘ I found here:

        /Users/you/project/tests/fixtures/errors/valid/elm-tooling.json

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
      /Users/you/project/tests/fixtures/errors/valid/elm-tooling.json

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

  test("duplicate outputs", async () => {
    expect(await run("duplicate-outputs", ["make"])).toMatchInlineSnapshot(`
⧙-- DUPLICATE OUTPUTS -----------------------------------------------------------⧘
/Users/you/project/tests/fixtures/errors/duplicate-outputs/elm-tooling.json

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
        🚨 /dev/null

        ⧙-- INPUTS NOT FOUND ------------------------------------------------------------⧘
        ⧙When compiling to /dev/null⧘

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
        🚨 main.js

        ⧙-- INPUTS FAILED TO RESOLVE ----------------------------------------------------⧘
        ⧙When compiling: main.js⧘

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
        🚨 main.js

        ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
        ⧙When compiling: main.js⧘

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
        🚨 main.js

        ⧙-- DUPLICATE INPUTS ------------------------------------------------------------⧘
        ⧙When compiling: main.js⧘

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
        -> /Users/you/project/tests/fixtures/errors/elm-json-not-found-for-all/pages/elm.json

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
        -> /Users/you/project/tests/fixtures/errors/non-unique-elm-json/elm.json

        pages/About.elm
        -> /Users/you/project/tests/fixtures/errors/non-unique-elm-json/pages/elm.json

        It doesn't make sense to compile Elm files from different projects into one output.

        Either split this output, or move the inputs to the same project with the same
        ⧙elm.json⧘.

        🚨 ⧙1⧘ error found
      `);
    });

    test("elm not found", async () => {
      expect(
        await run("valid", ["make"], {
          env: {
            ...process.env,
            ...NO_DELAY,
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

    test("elm not found – undefined PATH", async () => {
      expect(await run("valid", ["make", "build/app.js"], { env: {} }))
        .toMatchInlineSnapshot(`
        🚨 Dependencies

        ⧙-- ELM NOT FOUND ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/valid/elm.json

        I tried to execute ⧙elm⧘, but it does not appear to exist!

        This is what the PATH environment variable looks like:

        process.env.PATH is somehow undefined!

        Is Elm installed?

        Note: If you have installed Elm locally (for example using npm or elm-tooling),
        execute elm-watch using npx to make elm-watch automatically pick up that local
        installation: ⧙npx elm-watch⧘
      `);
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
        expect(await run("valid", ["make", "build/app.js"]))
          .toMatchInlineSnapshot(`
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
        🚨 build/app.js

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙When compiling: build/app.js⧘

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
        🚨 build/app.js

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙When compiling: build/app.js⧘

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
        🚨 build/app.js

        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙When compiling: build/app.js⧘

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

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
          🚨 build/app.js

          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙When compiling: build/app.js⧘

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
        🚨 main.js

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
      expect(await run("compilation-errors", ["make", "Dir.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 Dir.js

        ⧙-- FILE NOT FOUND --------------------------------------------------------------⧘
        ⧙When compiling: Dir.js⧘

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
      expect(await run("compilation-errors", ["make", "SyntaxError.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 SyntaxError.js

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
      expect(await run("compilation-errors", ["make", "ModuleNameMismatch.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 ModuleNameMismatch.js

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
      expect(await run("compilation-errors", ["make", "TypeError.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 TypeError.js

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
      expect(await run("compilation-errors", ["make", "MissingMain.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 MissingMain.js

        ⧙-- NO MAIN ---------------------------------------------------------------------⧘
        ⧙When compiling: MissingMain.js⧘

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
        await run("compilation-errors", ["make", "DebugLog.js", "--optimize"])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 DebugLog.js

        ⧙-- DEBUG REMNANTS --------------------------------------------------------------⧘
        ⧙When compiling: DebugLog.js⧘

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

  describe("postprocess errors", () => {
    test("command not found", async () => {
      expect(
        await run("postprocess", ["make", "build/command-not-found.js"], {
          env: {
            ...process.env,
            ...NO_DELAY,
            PATH: path.join(path.dirname(__dirname), "node_modules", ".bin"),
          },
        })
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/command-not-found.js

        ⧙-- COMMAND NOT FOUND -----------------------------------------------------------⧘
        ⧙When compiling: build/command-not-found.js⧘

        I tried to execute ⧙nope⧘, but it does not appear to exist!

        This is what the PATH environment variable looks like:

        /Users/you/project/node_modules/.bin

        Is ⧙nope⧘ installed?

        🚨 ⧙1⧘ error found
      `);
    });

    test("exit 1 + stdout", async () => {
      expect(await run("postprocess", ["make", "build/exit-1-stdout.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/exit-1-stdout.js

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙When compiling: build/exit-1-stdout.js⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess
        node -e 'console.log('\\''some stdout'\\''); process.exit(1)' /Users/you/project/tests/fixtures/errors/postprocess/build/exit-1-stdout.js standard

        ⧙It exited with an error:⧘

        exit 1
        some stdout

        🚨 ⧙1⧘ error found
      `);
    });

    test("exit 2 + stderr + debug", async () => {
      expect(
        await run("postprocess", ["make", "build/exit-2-stderr.js", "--debug"])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/exit-2-stderr.js

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙When compiling: build/exit-2-stderr.js⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess
        node -e 'console.error('\\''some stderr'\\''); process.exit(2)' /Users/you/project/tests/fixtures/errors/postprocess/build/exit-2-stderr.js debug

        ⧙It exited with an error:⧘

        exit 2
        some stderr

        🚨 ⧙1⧘ error found
      `);
    });

    test("exit 3 + no output + optimize", async () => {
      expect(
        await run("postprocess", [
          "make",
          "build/exit-3-no-output.js",
          "--optimize",
        ])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/exit-3-no-output.js

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙When compiling: build/exit-3-no-output.js⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess
        node -e 'process.exit(3)' /Users/you/project/tests/fixtures/errors/postprocess/build/exit-3-no-output.js optimize

        ⧙It exited with an error:⧘

        exit 3
        (no output)

        🚨 ⧙1⧘ error found
      `);
    });

    test("exit 4 + both stdout and stderr", async () => {
      expect(
        await run("postprocess", [
          "make",
          "build/exit-4-both-stdout-and-stderr.js",
        ])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/exit-4-both-stdout-and-stderr.js

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙When compiling: build/exit-4-both-stdout-and-stderr.js⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess
        node -e 'console.log("stdout"); console.error("stderr"); process.exit(4)' /Users/you/project/tests/fixtures/errors/postprocess/build/exit-4-both-stdout-and-stderr.js standard

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
      expect(await run("postprocess", ["make", "build/exit-5-tricky-args.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/exit-5-tricky-args.js

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙When compiling: build/exit-5-tricky-args.js⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess
        node -e 'process.exit(5)' -- '' \\'a\\'b\\' '$x' /Users/you/project/tests/fixtures/errors/postprocess/build/exit-5-tricky-args.js standard

        ⧙It exited with an error:⧘

        exit 5
        (no output)

        🚨 ⧙1⧘ error found
      `);
    });
  });

  describe("elm-watch-node errors", () => {
    test("missing script", async () => {
      expect(await run("postprocess", ["make", "build/missing-script.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/missing-script.js

        ⧙-- MISSING POSTPROCESS SCRIPT --------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/elm-tooling.json

        You have specified this in ⧙elm-tooling.json⧘:

        "postprocess": ["elm-watch-node"]

        You need to specify a JavaScript file to run as well, like so:

        "postprocess": ["elm-watch-node", "postprocess.js"]

        🚨 ⧙1⧘ error found
      `);
    });

    test("script not found", async () => {
      expect(await run("postprocess", ["make", "build/script-not-found.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/script-not-found.js

        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/not-found.js

        I tried to import your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/not-found.js")

        But that resulted in this error:

        Cannot find module '/Users/you/project/tests/fixtures/errors/postprocess/not-found.js' from 'src/Postprocess.ts'

        🚨 ⧙1⧘ error found
      `);
    });

    test("throw at import", async () => {
      expect(await run("postprocess", ["make", "build/throw-at-import.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/throw-at-import.js

        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/throw-at-import.js

        I tried to import your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/throw-at-import.js")

        But that resulted in this error:

        Error: Failed to initialize!
            at fake/stacktrace.js

        🚨 ⧙1⧘ error found
      `);
    });

    test("throw non-error at import", async () => {
      expect(
        await run("postprocess", ["make", "build/throw-non-error-at-import.js"])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/throw-non-error-at-import.js

        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/throw-non-error-at-import.js

        I tried to import your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/throw-non-error-at-import.js")

        But that resulted in this error:

        [null, "error"]

        🚨 ⧙1⧘ error found
      `);
    });

    test("empty file", async () => {
      expect(await run("postprocess", ["make", "build/empty-file.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/empty-file.js

        ⧙-- MISSING POSTPROCESS DEFAULT EXPORT ------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/empty-file.js

        I imported your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/empty-file.js")

        I expected ⧙imported.default⧘ to be a function, but it isn't!

        typeof imported.default === "undefined"

        These are the keys of ⧙imported⧘:

        []

        🚨 ⧙1⧘ error found
      `);
    });

    test("wrong default export", async () => {
      expect(
        await run("postprocess", ["make", "build/wrong-default-export.js"])
      ).toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/wrong-default-export.js

        ⧙-- MISSING POSTPROCESS DEFAULT EXPORT ------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/wrong-default-export.js

        I imported your postprocess file:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/wrong-default-export.js")

        I expected ⧙imported.default⧘ to be a function, but it isn't!

        typeof imported.default === "object"

        🚨 ⧙1⧘ error found
      `);
    });

    test("throw error", async () => {
      expect(await run("postprocess", ["make", "build/throw-error.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/throw-error.js

        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/throw-error.js

        I tried to run your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/throw-error.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/throw-error.js","standard"])

        But that resulted in this error:

        Error: Failed to run postprocess!
            at fake/stacktrace.js

        🚨 ⧙1⧘ error found
      `);
    });

    test("throw null", async () => {
      expect(await run("postprocess", ["make", "build/throw-null.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/throw-null.js

        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/throw-null.js

        I tried to run your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/throw-null.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/throw-null.js","standard"])

        But that resulted in this error:

        null

        🚨 ⧙1⧘ error found
      `);
    });

    test("reject promise", async () => {
      expect(await run("postprocess", ["make", "build/reject-promise.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/reject-promise.js

        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/reject-promise.js

        I tried to run your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/reject-promise.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/reject-promise.js","standard"])

        But that resulted in this error:

        "rejected!"

        🚨 ⧙1⧘ error found
      `);
    });

    test("return undefined", async () => {
      expect(await run("postprocess", ["make", "build/return-undefined.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/return-undefined.js

        ⧙-- INVALID POSTPROCESS RESULT --------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/return-undefined.js

        I ran your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/return-undefined.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/return-undefined.js","standard"])

        But ⧙result⧘ doesn't look like I expected:

        At root:
        Expected an object
        Got: undefined

        🚨 ⧙1⧘ error found
      `);
    });

    test("exitCode typo", async () => {
      expect(await run("postprocess", ["make", "build/exit-code-typo.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/exit-code-typo.js

        ⧙-- INVALID POSTPROCESS RESULT --------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/exit-code-typo.js

        I ran your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/exit-code-typo.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/exit-code-typo.js","standard"])

        But ⧙result⧘ doesn't look like I expected:

        At root["exitCode"]:
        Expected a number
        Got: undefined

        🚨 ⧙1⧘ error found
      `);
    });

    test("stdout typo", async () => {
      expect(await run("postprocess", ["make", "build/stdout-typo.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/stdout-typo.js

        ⧙-- INVALID POSTPROCESS RESULT --------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/postprocess/stdout-typo.js

        I ran your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/stdout-typo.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/stdout-typo.js","standard"])

        But ⧙result⧘ doesn't look like I expected:

        At root:
        Expected only these fields: "exitCode", "stdout", "stderr"
        Found extra fields: "stdOut"

        🚨 ⧙1⧘ error found
      `);
    });

    test("exit 1 + stderr", async () => {
      expect(await run("postprocess", ["make", "build/exit-1-stderr.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/exit-1-stderr.js

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙When compiling: build/exit-1-stderr.js⧘

        I ran your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/exit-1-stderr.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/exit-1-stderr.js","standard"])

        ⧙It exited with an error:⧘

        exit 1
        Some text on stderr

        🚨 ⧙1⧘ error found
      `);
    });

    test("invalid stdout JSON", async () => {
      expect(await run("postprocess", ["make", "build/invalid-stdout-json.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/invalid-stdout-json.js

        ⧙-- INVALID POSTPROCESS STDOUT --------------------------------------------------⧘

        I ran your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/invalid-stdout-json.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/invalid-stdout-json.js","standard"])

        But ⧙stdout⧘ doesn't look like I expected:

        Unexpected token } in JSON at position 17

        🚨 ⧙1⧘ error found
      `);
    });

    test("stdout JSON newOutputPath typo", async () => {
      expect(await run("postprocess", ["make", "build/invalid-stdout-typo.js"]))
        .toMatchInlineSnapshot(`
        ✅ Dependencies
        🚨 build/invalid-stdout-typo.js

        ⧙-- INVALID POSTPROCESS STDOUT --------------------------------------------------⧘

        I ran your postprocess command:

        const imported = await import("/Users/you/project/tests/fixtures/errors/postprocess/postprocess/invalid-stdout-typo.js")
        const result = await imported.default(["/Users/you/project/tests/fixtures/errors/postprocess/build/invalid-stdout-typo.js","standard"])

        But ⧙stdout⧘ doesn't look like I expected:

        At root:
        Expected only these fields: "newOutputPath"
        Found extra fields: "newOutput"

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

      expect(await run("ci", ["make"], { isTTY: false }))
        .toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ build/admin.js: elm make
        ⏳ build/app.js: elm make
        ⏳ build/postprocess-error.js: elm make
        🚨 build/admin.js
        ✅ build/app.js
        ⏳ build/postprocess-error.js: postprocess
        🚨 build/postprocess-error.js

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

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙When compiling: build/postprocess-error.js⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/ci
        node -e 'process.exit(1)' /Users/you/project/tests/fixtures/errors/ci/build/postprocess-error.js standard

        ⧙It exited with an error:⧘

        exit 1
        (no output)

        🚨 ⧙3⧘ errors found
      `);

      expect(fs.existsSync(appPath)).toBe(true);
    });

    test("CI scenario – no color", async () => {
      if (fs.existsSync(appPath)) {
        fs.unlinkSync(appPath);
      }

      expect(
        await run("ci", ["make"], {
          env: {
            ...process.env,
            ...NO_DELAY,
            NO_COLOR: "",
          },

          isTTY: false,
        })
      ).toMatchInlineSnapshot(`
        Dependencies: in progress
        Dependencies: success
        build/admin.js: elm make
        build/app.js: elm make
        build/postprocess-error.js: elm make
        build/admin.js: error
        build/app.js: success
        build/postprocess-error.js: postprocess
        build/postprocess-error.js: error

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

        -- POSTPROCESS ERROR -----------------------------------------------------------
        When compiling: build/postprocess-error.js

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/ci
        node -e 'process.exit(1)' /Users/you/project/tests/fixtures/errors/ci/build/postprocess-error.js standard

        It exited with an error:

        exit 1
        (no output)

        3 errors found
      `);

      expect(fs.existsSync(appPath)).toBe(true);
    });
  });
});
