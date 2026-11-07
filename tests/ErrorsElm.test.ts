import * as path from "path";
import { describe, expect, test } from "vitest";

import type { Env } from "../src/Env.ts";
import * as Errors from "../src/Errors.ts";
import {
  run,
  runWithBadElmBin,
  runWithBadElmBinAndWrittenError,
} from "./ErrorsHelpers.ts";
import {
  clean,
  stringSnapshotSerializer,
  TEST_ENV,
  testExceptWindows,
} from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("errors", () => {
  describe("elm not found", () => {
    test("basic", async () => {
      expect(
        await run("valid", ["make"], {
          env: {
            ...TEST_ENV,
            PATH: [
              import.meta.dirname,
              path.join(import.meta.dirname, "some", "bin"),
            ].join(path.delimiter),
          },
        }),
      ).toMatchInlineSnapshot(`
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

    // On Windows, this causes `elm` to be found after all, but fail with `openBinaryFile: permission denied`.
    testExceptWindows("undefined PATH", async () => {
      expect(await run("valid", ["make", "app"], { env: {} }))
        .toMatchInlineSnapshot(`
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
      clean(Errors.printPATH(env, true)(80, (piece) => piece.text));

    test("Windows basic", () => {
      expect(
        printPATHWindows({
          Path: [
            import.meta.dirname,
            path.join(import.meta.dirname, "some", "bin"),
          ].join(path.delimiter),
        }),
      ).toMatchInlineSnapshot(`
          This is what the Path environment variable looks like:

          /Users/you/project/tests
          /Users/you/project/tests/some/bin
        `);
    });

    test("Windows no PATH-like", () => {
      expect(printPATHWindows({})).toMatchInlineSnapshot(
        `I can't find any program, because I can't find any PATH-like environment variables!`,
      );
    });

    test("Windows multiple PATH-like", () => {
      expect(
        printPATHWindows({
          Path: [
            import.meta.dirname,
            path.join(import.meta.dirname, "some", "bin"),
          ].join(path.delimiter),
          PATH: [
            path.join(import.meta.dirname, "that", "bin"),
            path.join(import.meta.dirname, "final", "bin"),
          ].join(path.delimiter),
          notPath: "should not be seen",
        }),
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
    test("elm install error", async () => {
      expect(
        await runWithBadElmBin("install-error", {
          originalStdout: true, // Check that we get "🚨 Dependencies" below (one test is enough).
        }),
      ).toMatchInlineSnapshot(`
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
          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/valid/elm.json

          I tried to make sure all packages are installed by running the following commands:

          cd /Users/you/project/tests/fixtures/errors/valid
          elm make --output=/dev/null elm.json/ElmWatchNonExistentFile.elm

          The file is not supposed to exist, so I expected it to exit 1 with
          a FILE NOT FOUND error (success), or with another error I can recognize
          (using regex) on stderr.

          ⧙But it exited like this:⧘

          exit 0
          some output
          on stderr
        `);
      });

      test("exit 1 + stderr not matching", async () => {
        expect(await runWithBadElmBin("exit-1-stderr-not-install-error-match"))
          .toMatchInlineSnapshot(`
          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/valid/elm.json

          I tried to make sure all packages are installed by running the following commands:

          cd /Users/you/project/tests/fixtures/errors/valid
          elm make --output=/dev/null elm.json/ElmWatchNonExistentFile.elm

          The file is not supposed to exist, so I expected it to exit 1 with
          a FILE NOT FOUND error (success), or with another error I can recognize
          (using regex) on stderr.

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
          ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/valid/elm.json

          I tried to make sure all packages are installed by running the following commands:

          cd /Users/you/project/tests/fixtures/errors/valid
          elm make --output=/dev/null elm.json/ElmWatchNonExistentFile.elm

          The file is not supposed to exist, so I expected it to exit 1 with
          a FILE NOT FOUND error (success), or with another error I can recognize
          (using regex) on stderr.

          ⧙But it exited like this:⧘

          exit 2
          ⧙(no output)⧘
        `);
      });
    });
  });

  describe("elm make json errors", () => {
    test("syntax error", async () => {
      const { output, writtenError } =
        await runWithBadElmBinAndWrittenError("json-syntax-error");

      expect(output).toMatchInlineSnapshot(`
        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        At root:
        SyntaxError: (JSON syntax error)

        I wrote that to this file so you can inspect it:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-021fb596db81e6d02bf3d2586ee3981fe519f275c0ac9ca76bbcf2ebb4097d96.txt
      `);

      expect(writtenError).toMatchInlineSnapshot(`
        -- TROUBLE WITH JSON REPORT ----------------------------------------------------

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        At root:
        SyntaxError: (JSON syntax error)

        I wrote this error to a file so you can inspect and possibly report it more easily.

        This is the data that caused the error:

        {
      `);
    });

    test("decode error", async () => {
      const { output, writtenError } =
        await runWithBadElmBinAndWrittenError("json-decode-error");

      expect(output).toMatchInlineSnapshot(`
        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        At root["type"]:
        Expected one of these tags:
          "error",
          "compile-errors"
        Got: "laser-error"

        I wrote that to this file so you can inspect it:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-9e9d3029b9417772915e06e1add0feb00f6b8db2f9bc1ce17979df8b8db666c5.txt
      `);

      expect(writtenError).toMatchInlineSnapshot(`
        -- TROUBLE WITH JSON REPORT ----------------------------------------------------

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        At root["type"]:
        Expected one of these tags:
          "error",
          "compile-errors"
        Got: "laser-error"

        I wrote this error to a file so you can inspect and possibly report it more easily.

        This is the data that caused the error:

        {"type":"laser-error"}
      `);
    });

    test("error failed to write", async () => {
      expect(await runWithBadElmBin("json-error-failed-write"))
        .toMatchInlineSnapshot(`
        ⧙-- TROUBLE WITH JSON REPORT ----------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I seem to have gotten some JSON back as expected,
        but I ran into an error when decoding it:

        At root:
        SyntaxError: (JSON syntax error)

        I tried to write that to this file:

        /Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fb337d3432f9465ea0a23c33debf6525c68f21f95061a35ff08c271f6c8e176b.txt

        ⧙But that failed too:⧘

        EISDIR: illegal operation on a directory, open '/Users/you/project/tests/fixtures/errors/valid/elm-watch-ElmMakeJsonParseError-fb337d3432f9465ea0a23c33debf6525c68f21f95061a35ff08c271f6c8e176b.txt'
      `);
    });
  });

  describe("unexpected `elm make` output", () => {
    test("exit 0 + stdout", async () => {
      expect(await runWithBadElmBin("exit-0-stdout")).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 0
        some output
        on stdout
      `);
    });

    test("exit 0 + stderr", async () => {
      expect(await runWithBadElmBin("exit-0-stderr")).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 0
        some output
        on stderr
      `);
    });

    test("exit 1 + stdout", async () => {
      expect(await runWithBadElmBin("exit-1-stdout")).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 1
        some output
        on stdout
      `);
    });

    test("exit 1 + stderr that isn’t json", async () => {
      expect(await runWithBadElmBin("exit-1-stderr-not-{"))
        .toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

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
      `);
    });

    test("exit 2 + no output", async () => {
      expect(await runWithBadElmBin("exit-2-no-output")).toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 2
        ⧙(no output)⧘
      `);
    });

    test("exit 2 + both stdout and stderr", async () => {
      expect(await runWithBadElmBin("exit-2-both-stdout-and-stderr"))
        .toMatchInlineSnapshot(`
        ⧙-- UNEXPECTED ELM OUTPUT -------------------------------------------------------⧘
        ⧙Target: app⧘

        I ran the following commands:

        cd /Users/you/project/tests/fixtures/errors/valid
        elm make --report=json --output=build/app.js src/App.elm

        I expected it to either exit 0 with no output (success),
        or exit 1 with JSON on stderr (compile errors).

        ⧙But it exited like this:⧘

        exit 2
        STDOUT:
        stuff on stdout
        second write to stdout

        STDERR:
        stuff on stderr
      `);
    });
  });
});
