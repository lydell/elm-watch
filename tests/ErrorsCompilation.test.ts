import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import * as Codec from "tiny-decoders";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ElmWatchStuffJson } from "../src/ElmWatchStuffJson";
import {
  __ELM_WATCH_EXIT_ON_ERROR,
  __ELM_WATCH_MAX_PARALLEL,
  NO_COLOR,
} from "../src/Env";
import * as Errors from "../src/Errors";
import { markAsPort } from "../src/Port";
import {
  markAsAbsolutePath,
  markAsElmJsonPath,
  markAsTargetName,
} from "../src/Types";
import {
  elmBinAlwaysSucceedEnv,
  fixtureDir,
  printError,
  run,
  runAbsolute,
  runWithBadElmBin,
} from "./ErrorsHelpers";
import {
  badElmBinEnv,
  fixtureOptions,
  rimraf,
  rm,
  stringSnapshotSerializer,
  TEST_ENV,
  wait,
} from "./Helpers";
import { spawnSync } from "./Spawn.js";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("errors", () => {
  describe("elm compilation errors", () => {
    test('wrong "type" in elm.json', async () => {
      expect(await run("wrong-elm-json-type", ["make"])).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED TYPE -------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/wrong-elm-json-type/elm.json

        I got stuck while reading your elm.json file. I cannot handle a "type" like
        this:

        1|⧙>⧘{
        2|⧙>⧘  "type": "pakage"
        3|⧙>⧘}

        Try changing the "type" to ⧙"application"⧘ or ⧙"package"⧘ instead.
      `);
    });

    test("Elm file is actually a directory", async () => {
      // Elm’s message is a bit odd.
      expect(await run("compilation-errors", ["make", "Dir"]))
        .toMatchInlineSnapshot(`
          ⧙-- FILE NOT FOUND --------------------------------------------------------------⧘
          ⧙Target: Dir⧘

          I cannot find this file:

              ⧙src/Dir.elm⧘

          Is there a typo?

          ⧙Note⧘: If you are just getting started, try working through the examples in the
          official guide https://guide.elm-lang.org to get an idea of the kinds of things
          that typically go in a src/Main.elm file.
        `);
    });

    test("Elm syntax error", async () => {
      expect(await run("compilation-errors", ["make", "SyntaxError"]))
        .toMatchInlineSnapshot(`
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
      `);
    });

    test("Elm syntax error – tabs", async () => {
      expect(await run("compilation-errors", ["make", "Tabs"]))
        .toMatchInlineSnapshot(`
        ⧙-- NO TABS ---------------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/compilation-errors/src/Tabs.elm:6:1

        I ran into a tab, but tabs are not allowed in Elm files.

        6| 	Html.text "Hello"
           ⧙^⧘
        Replace the tab with spaces.
      `);
    });

    test("module name and file name mismatch", async () => {
      expect(await run("compilation-errors", ["make", "ModuleNameMismatch"]))
        .toMatchInlineSnapshot(`
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
      `);
    });

    test("type error", async () => {
      expect(await run("compilation-errors", ["make", "TypeError"]))
        .toMatchInlineSnapshot(`
        ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/compilation-errors/src/TypeError.elm:3:9

        I cannot do addition with ⧙String⧘ values like this one:

        3| error = "a" + 1
                   ⧙^^^⧘
        The (+) operator only works with ⧙Int⧘ and ⧙Float⧘ values.

        ⧙Hint⧘: Switch to the ⧙(++)⧘ operator to append strings!
      `);
    });

    test("type error with Elm 0.19.2", async () => {
      // This is supposed to be identical to the above test, despite Elm reporting
      // line 2 column 8 instead of line 3 column 9.
      expect(await runWithBadElmBin("elm-0.19.2-off-by-one"))
        .toMatchInlineSnapshot(`
        ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/compilation-errors/src/TypeError.elm:3:9

        I cannot do addition with ⧙String⧘ values like this one:

        3| error = "a" + 1
                   ⧙^^^⧘
        The (+) operator only works with ⧙Int⧘ and ⧙Float⧘ values.

        ⧙Hint⧘: Switch to the ⧙(++)⧘ operator to append strings!
      `);
    });

    test("missing main", async () => {
      expect(await run("compilation-errors", ["make", "MissingMain"]))
        .toMatchInlineSnapshot(`
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
      `);
    });

    test("--optimize with Debug.log", async () => {
      expect(
        await run("compilation-errors", ["make", "DebugLog", "--optimize"]),
      ).toMatchInlineSnapshot(`
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
      `);
    });

    test("not enough bytes error", async () => {
      const fixture = "not-enough-bytes";
      const dir = fixtureDir(fixture);
      const elmStuff = path.join(dir, "elm-stuff");
      const iDat = path.join(elmStuff, "0.19.1", "i.dat");
      await rimraf(elmStuff);
      const result = spawnSync(
        "elm",
        ["make", "--output=/dev/null", "src/Main.elm"],
        {
          cwd: dir,
        },
      );
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!(result.error === undefined || result.error === null)) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(
          `elm make failed with status ${result.status ?? "null"}.\n\n${
            result.stdout
          }\n\n${result.stderr}`,
        );
      }
      fs.writeFileSync(iDat, fs.readFileSync(iDat).subarray(0, 128));
      expect(await run(fixture, ["make", "Main"])).toMatchInlineSnapshot(`
        ⧙-- CORRUPT CACHE ---------------------------------------------------------------⧘
        ⧙Target: Main⧘

        +-------------------------------------------------------------------------------
        |  Corrupt File: /Users/you/project/tests/fixtures/errors/not-enough-bytes/elm-stuff/0.19.1/i.dat
        |   Byte Offset: 127
        |       Message: not enough bytes
        |
        | Please report this to https://github.com/elm/compiler/issues
        | Trying to continue anyway.
        +-------------------------------------------------------------------------------

        It looks like some of the information cached in elm-stuff/ has been corrupted.

        Try deleting your elm-stuff/ directory to get unstuck.

        ⧙Note⧘: This almost certainly means that a 3rd party tool (or editor plugin) is
        causing problems your the elm-stuff/ directory. Try disabling 3rd party tools
        one by one until you figure out which it is!
      `);
    });

    test("Elm crash immediately", async () => {
      expect(await runWithBadElmBin("elm-crash")).toMatchInlineSnapshot(`
        ⧙-- ELM CRASHED -----------------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        Elm crashed with this error:

        elm: Map.!: given key is not an element in the map
        CallStack (from HasCallStack):
          error, called at ./Data/Map/Internal.hs:610:17 in containers-0.5.11.0-FmkfE5FIiXiCSIJBVRC1nU:Data.Map.Internal
      `);
    });

    test("Elm crash half-way through printing JSON", async () => {
      expect(await runWithBadElmBin("elm-crash-json")).toMatchInlineSnapshot(`
        ⧙-- ELM CRASHED -----------------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I got back 242 characters of JSON, but then Elm crashed with this error:

        elm: Map.!: given key is not an element in the map
        CallStack (from HasCallStack):
          error, called at ./Data/Map/Internal.hs:610:17 in containers-0.5.11.0-FmkfE5FIiXiCSIJBVRC1nU:Data.Map.Internal
      `);
    });

    test("Elm crash with non-JSON printed before", async () => {
      expect(await runWithBadElmBin("elm-crash-extra")).toMatchInlineSnapshot(`
        ⧙-- ELM CRASHED -----------------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        Elm printed this text:

        Text before crash

        Then it crashed with this error:

        elm: Map.!: given key is not an element in the map
        CallStack (from HasCallStack):
          error, called at ./Data/Map/Internal.hs:610:17 in containers-0.5.11.0-FmkfE5FIiXiCSIJBVRC1nU:Data.Map.Internal
      `);
    });

    test("interrupt typecheck with compilation error", async () => {
      const fixture = "interrupt-typecheck";
      const dir = fixtureDir(fixture);
      const src = path.join(dir, "src");
      const lock = path.join(dir, "lock");
      const mainFile = path.join(src, "Main.elm");
      const mainFileTemplate = path.join(src, "Main1.elm");
      const mainFileString = fs
        .readFileSync(mainFileTemplate, "utf8")
        .replace(/\r\n/g, "\n")
        .replace("Main1", "Main");
      fs.writeFileSync(mainFile, mainFileString);
      fs.writeFileSync(lock, "");

      const [output] = await Promise.all([
        run(fixture, ["hot"], {
          isTTY: false,
          env: {
            ...badElmBinEnv(path.join(dir, "bad-bin")),
            [__ELM_WATCH_EXIT_ON_ERROR]: "",
          },
          originalStdout: true,
        }),
        (async () => {
          while (fs.readFileSync(lock, "utf8") !== "typecheck-only-started") {
            await wait(100);
          }
          fs.writeFileSync(mainFile, mainFileString.slice(0, -5));
          await wait(100);
          fs.writeFileSync(lock, "typecheck-only-ok-to-exit");
        })(),
      ]);

      // Sometimes the same change is reported twice by the OS. Change it to just once.
      const adjustedOutput = output.replace(
        /^(.+Changed.+)\n.+Changed.+/m,
        "$1",
      );

      expect(adjustedOutput).toMatchInlineSnapshot(`
        📊 ⧙server:⧘ http://localhost:59123
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

        ℹ️ ⧙13:10:05⧘ ⧙Changed /Users/you/project/tests/fixtures/errors/interrupt-typecheck/src/Main.elm⧘
        🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      `);
    });
  });

  test("fail to read the size of Elm’s output", async () => {
    expect(await runWithBadElmBin("exit-0-no-write")).toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING OUTPUT ------------------------------------------------------⧘
      ⧙Target: app⧘

      I managed to compile your code. Then I tried to read the output:

      /Users/you/project/tests/fixtures/errors/valid/build/app.js

      Doing so I encountered this error:

      ENOENT: no such file or directory, stat '/Users/you/project/tests/fixtures/errors/valid/build/app.js'
    `);
  });

  describe("elm-stuff/elm-watch/stuff.json errors", () => {
    test("is a folder", async () => {
      expect(await run("elm-watch-stuff-json-is-folder", ["hot"]))
        .toMatchInlineSnapshot(`
        ⧙-- TROUBLE READING elm-stuff/elm-watch/stuff.json ------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-is-folder/elm-stuff/elm-watch/stuff.json

        I read stuff from ⧙elm-stuff/elm-watch/stuff.json⧘ to remember some things between runs.

        ⧙I had trouble reading it:⧘

        EISDIR: illegal operation on a directory, read

        This file is created by elm-watch, so reading it should never fail really.
        You could try removing that file (it contains nothing essential).
      `);
    });

    test("bad json", async () => {
      expect(await run("elm-watch-stuff-json-bad-json", ["hot"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-stuff/elm-watch/stuff.json FORMAT -------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-bad-json/elm-stuff/elm-watch/stuff.json

        I read stuff from ⧙elm-stuff/elm-watch/stuff.json⧘ to remember some things between runs.

        ⧙I had trouble with the JSON inside:⧘

        At root:
        SyntaxError: (JSON syntax error)

        This file is created by elm-watch, so reading it should never fail really.
        You could try removing that file (it contains nothing essential).
      `);
    });

    test("bad compilation mode", async () => {
      expect(await run("elm-watch-stuff-json-bad-compilation-mode", ["hot"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID elm-stuff/elm-watch/stuff.json FORMAT -------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-bad-compilation-mode/elm-stuff/elm-watch/stuff.json

        I read stuff from ⧙elm-stuff/elm-watch/stuff.json⧘ to remember some things between runs.

        ⧙I had trouble with the JSON inside:⧘

        At root["targets"]["Main"]["compilationMode"]:
        Expected one of these variants:
          "debug",
          "standard",
          "optimize"
        Got: "normal"

        This file is created by elm-watch, so reading it should never fail really.
        You could try removing that file (it contains nothing essential).
      `);
    });

    test("write error", async () => {
      const dir = fixtureDir("elm-watch-stuff-json-write-error");
      const elmWatchStuffJson: ElmWatchStuffJson = {
        port: markAsPort(59999),
        targets: {},
      };
      const elmWatchStuffJsonPath = path.join(
        dir,
        "elm-stuff",
        "elm-watch",
        "stuff.json",
      );
      fs.mkdirSync(path.dirname(elmWatchStuffJsonPath), {
        recursive: true,
      });
      try {
        rm(elmWatchStuffJsonPath);
        fs.writeFileSync(
          elmWatchStuffJsonPath,
          Codec.JSON.stringify(ElmWatchStuffJson, elmWatchStuffJson),
          { mode: "0444" }, // readonly
        );
      } catch {
        // Ignore write errors (readonly).
      }
      expect(
        await runAbsolute(dir, ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        }),
      ).toMatchInlineSnapshot(`
        ⧙-- TROUBLE WRITING elm-stuff/elm-watch/stuff.json ------------------------------⧘
        /Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-write-error/elm-stuff/elm-watch/stuff.json

        I write stuff to ⧙elm-stuff/elm-watch/stuff.json⧘ to remember some things between runs.

        ⧙I had trouble writing that file:⧘

        EACCES: permission denied, open '/Users/you/project/tests/fixtures/errors/elm-watch-stuff-json-write-error/elm-stuff/elm-watch/stuff.json'

        The file contains nothing essential, but something weird is going on.

        📊 ⧙server:⧘ http://localhost:59123
        📊 ⧙web socket connections:⧘ 0

        ✅ ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
      `);
    });
  });

  test("import walker file system error", async () => {
    expect(
      await run("import-walker-file-system-error", ["hot"], {
        env: elmBinAlwaysSucceedEnv,
        exitHotOnError: true,
      }),
    ).toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING ELM FILES ---------------------------------------------------⧘
      ⧙Target: Main⧘

      When figuring out all Elm files that your inputs depend on I read a lot of Elm files.
      Doing so I encountered this error:

      EISDIR: illegal operation on a directory, read

      (I still managed to compile your code, but the watcher will not work properly
      and postprocess was not run.)
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
        }),
      ).toMatchInlineSnapshot(`
        ⧙-- PORT CONFLICT ---------------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/port-conflict-for-persisted-port/elm-stuff/elm-watch/stuff.json

        I ask the operating system for an arbitrary available port for the
        web socket server.

        I then save the port I got to ⧙elm-stuff/elm-watch/stuff.json⧘. Otherwise I would
        get a new port number on each restart, which means that if you had tabs
        open in the browser they would try to connect to the old port number.

        I tried to use such a saved port number from a previous run (or from previous
        configuration). But now that port (9123) wasn't available!

        Most likely you already have elm-watch running somewhere else! If so,
        find it and use that, or kill it.

        If not, something else could have started using port 9123
        (though it's not very likely.) Then you can either try to find what that is,
        or remove ⧙elm-stuff/elm-watch/stuff.json⧘ here:

        /Users/you/project/tests/fixtures/errors/port-conflict-for-persisted-port/elm-stuff/elm-watch/stuff.json

        Then I will ask the operating system for a new arbitrary available port.
      `);
    });

    test("from config", async () => {
      expect(
        await run("port-conflict-for-port-from-config", ["hot"], {
          env: elmBinAlwaysSucceedEnv,
          exitHotOnError: true,
        }),
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
    expect(
      await run("typecheck-only", ["hot"], {
        exitHotOnError: true,
        originalStdout: true,
      }),
    ).toMatchInlineSnapshot(`
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

      📊 ⧙server:⧘ http://localhost:59123
      📊 ⧙web socket connections:⧘ 0

      🚨 ⧙13:10:05⧘ Compilation finished in ⧙123 ms⧘.
    `);
  });

  describe("CI", () => {
    const getAppPath = (): string =>
      path.join(fixtureDir("ci"), "build", "app.js");

    const ciOptions = async (
      onlyTarget?: string,
    ): Promise<Record<string, unknown>> => {
      const options = await fixtureOptions(fixtureDir("ci"));
      return {
        ...options,
        runMode: "make",
        targets: options.targets.filter(
          (target) => onlyTarget === undefined || target.name === onlyTarget,
        ),
      };
    };

    test("CI scenario", async () => {
      rm(getAppPath());

      // Note: Postprocess is skipped when there are `elm make` errors.
      expect(
        await run("ci", [], {
          isTTY: false,
          originalStdout: true,
          elmWatchOptions: await ciOptions(),
        }),
      ).toMatchInlineSnapshot(`
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

        🚨 Compilation finished in ⧙123 ms⧘.
      `);

      // Not written since postprocess was skipped – full compilation is atomic.
      expect(fs.existsSync(getAppPath())).toBe(false);

      // Postprocess error.
      expect(
        await run("ci", [], {
          isTTY: false,
          originalStdout: true,
          elmWatchOptions: await ciOptions("postprocess-error"),
        }),
      ).toMatchInlineSnapshot(`
        ⏳ Dependencies
        ✅ Dependencies
        ⏳ postprocess-error: elm make
        🟢 postprocess-error: elm make done
        ⏳ postprocess-error: postprocess
        🚨 postprocess-error

        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: postprocess-error⧘

        I ran your postprocess function for this target.

        ⧙It threw an error:⧘

        "Postprocess failed"

        🚨 ⧙1⧘ error found

        🚨 Compilation finished in ⧙123 ms⧘.
      `);
    });

    test("CI scenario – no color", async () => {
      rm(getAppPath());

      // Note: Postprocess is skipped when there are `elm make` errors.
      expect(
        await run("ci", [], {
          env: {
            ...process.env,
            ...TEST_ENV,
            [NO_COLOR]: "",
          },
          isTTY: false,
          originalStdout: true,
          elmWatchOptions: await ciOptions(),
        }),
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

      // Not written since postprocess was skipped – full compilation is atomic.
      expect(fs.existsSync(getAppPath())).toBe(false);

      // Postprocess error.
      expect(
        await run("ci", [], {
          env: {
            ...process.env,
            ...TEST_ENV,
            [NO_COLOR]: "",
          },
          isTTY: false,
          originalStdout: true,
          elmWatchOptions: await ciOptions("postprocess-error"),
        }),
      ).toMatchInlineSnapshot(`
        Dependencies: in progress
        Dependencies: success
        postprocess-error: elm make
        postprocess-error: elm make done
        postprocess-error: postprocess
        postprocess-error: error

        -- POSTPROCESS ERROR -----------------------------------------------------------
        Target: postprocess-error

        I ran your postprocess function for this target.

        It threw an error:

        "Postprocess failed"

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
        originalStdout: true,
      }),
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

      🚨 Compilation finished in ⧙123 ms⧘.
    `);
  });

  describe("hard to test errors", () => {
    test("otherSpawnError", () => {
      expect(
        printError(
          Errors.otherSpawnError(
            {
              tag: "ElmJsonPath",
              theElmJsonPath: markAsElmJsonPath(
                markAsAbsolutePath("/Users/you/project/elm.json"),
              ),
            },
            new Error("Wingardium Leviosa"),
            {
              command: "elm",
              args: ["make", "src/Main.elm"],
              options: {
                cwd: markAsAbsolutePath("/Users/you/project"),
                env: {},
              },
            },
          ),
        ),
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
          Errors.unexpectedElmMakeOutput(
            {
              tag: "OutputPath",
              theOutputPath: markAsAbsolutePath("/build/main.js"),
              temporaryOutputPath: markAsAbsolutePath(
                "/elm-stuff/elm-watch/1.js",
              ),
              originalString: "main.js",
              targetName: markAsTargetName("main"),
            },
            { tag: "Signal", signal: "SIGABRT" },
            "",
            "",
            {
              command: "elm",
              args: ["make", "src/Main.elm"],
              options: {
                cwd: markAsAbsolutePath("/Users/you/project"),
                env: {},
              },
            },
          ),
        ),
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran the following commands:

        cd /Users/you/project
        elm make src/Main.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        signal SIGABRT
        ⧙(no output)⧘
      `);
    });

    test("ExitReason Unknown", () => {
      expect(
        printError(
          Errors.unexpectedElmMakeOutput(
            {
              tag: "OutputPath",
              theOutputPath: markAsAbsolutePath("/build/main.js"),
              temporaryOutputPath: markAsAbsolutePath(
                "/elm-stuff/elm-watch/1.js",
              ),
              originalString: "main.js",
              targetName: markAsTargetName("main"),
            },
            { tag: "Unknown" },
            "",
            "",
            {
              command: "elm",
              args: ["make", "src/Main.elm"],
              options: {
                cwd: markAsAbsolutePath("/Users/you/project"),
                env: {},
              },
            },
          ),
        ),
      ).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran the following commands:

        cd /Users/you/project
        elm make src/Main.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        unknown exit reason
        ⧙(no output)⧘
      `);
    });

    test("portConflictForPortFromConfig with options", () => {
      expect(
        printError(
          Errors.portConflictForPortFromConfig(
            { tag: "Options" },
            markAsPort(9876),
          ),
        ),
      ).toMatchInlineSnapshot(`
        ⧙-- PORT CONFLICT ---------------------------------------------------------------⧘

        In your ⧙elm-watch options⧘ you have this:

        port: 9876

        But something else seems to already be running on that port!
        You might already have elm-watch running somewhere, or it could be a completely
        different program.

        You need to either find and stop that other thing, switch to another port or
        remove "port" from ⧙elm-watch options⧘ (which will use an arbitrary available port.)
      `);
    });

    describe("long stdout and stderr", () => {
      const unexpectedOutput = (stdout: string, stderr: string): string =>
        printError(
          Errors.unexpectedElmMakeOutput(
            {
              tag: "OutputPath",
              theOutputPath: markAsAbsolutePath("/build/main.js"),
              temporaryOutputPath: markAsAbsolutePath(
                "/elm-stuff/elm-watch/1.js",
              ),
              originalString: "main.js",
              targetName: markAsTargetName("main"),
            },
            { tag: "ExitCode", exitCode: 2 },
            stdout,
            stderr,
            {
              command: "elm",
              args: ["make", "src/Main.elm"],
              options: {
                cwd: markAsAbsolutePath("/Users/you/project"),
                env: {},
              },
            },
          ),
        );

      test("many lines", () => {
        const output = unexpectedOutput(
          Array.from({ length: 102 }, (_, i) => `line ${i + 1}`).join("\n"),
          "",
        );
        expect(output.split("\n").slice(-3).join("\n")).toMatchInlineSnapshot(`
          line 99
          line 100
          ⧙2 more lines⧘
        `);
      });

      test("one more line", () => {
        const output = unexpectedOutput(
          Array.from({ length: 101 }, (_, i) => `line ${i + 1}`).join("\n"),
          "",
        );
        expect(output.split("\n").slice(-2).join("\n")).toMatchInlineSnapshot(`
          line 100
          ⧙1 more line⧘
        `);
      });

      test("long line", () => {
        const output = unexpectedOutput("", "x".repeat(80 * 100 + 1));
        expect(output.split("\n").at(-1)?.slice(-30)).toMatchInlineSnapshot(
          `xxxxxxxxxxx ⧙1 more character⧘`,
        );
      });

      test("long line, many characters", () => {
        const output = unexpectedOutput("", "x".repeat(80 * 100 + 5));
        expect(output.split("\n").at(-1)?.slice(-30)).toMatchInlineSnapshot(
          `xxxxxxxxxx ⧙5 more characters⧘`,
        );
      });

      test("both stdout and stderr", () => {
        expect(unexpectedOutput("out", "err")).toMatchInlineSnapshot(`
          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          ⧙Target: main⧘

          I ran the following commands:

          cd /Users/you/project
          elm make src/Main.elm

          I expected it to either exit 0 with no output (success),
          or exit 1 with JSON on stderr (compile errors).

          ⧙But it exited like this:⧘

          exit 2
          STDOUT:
          out

          STDERR:
          err
        `);
      });
    });

    test("portConflictForNoPort", () => {
      expect(
        printError(
          Errors.portConflictForNoPort(new Error("The error message")),
        ),
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
