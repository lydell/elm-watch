import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "vitest";

import { fixtureDir, run, runWithBadElmBin } from "./ErrorsHelpers";
import { rm, stringSnapshotSerializer, testExceptLinux } from "./Helpers";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("errors", () => {
  describe("postprocess errors", () => {
    test("fail to read Elm’s output", async () => {
      expect(await runWithBadElmBin("exit-0-no-write", { postprocess: true }))
        .toMatchInlineSnapshot(`
        ⧙-- TROUBLE READING OUTPUT ------------------------------------------------------⧘
        ⧙Target: app⧘

        I managed to compile your code. Then I tried to read the output:

        /Users/you/project/tests/fixtures/errors/valid/postprocess/elm-stuff/elm-watch/0.js

        Doing so I encountered this error:

        ENOENT: no such file or directory, open '/Users/you/project/tests/fixtures/errors/valid/postprocess/elm-stuff/elm-watch/0.js'
      `);
    });

    test("fail to write output after postprocess", async () => {
      const fixture = "readonly-output";
      const dir = fixtureDir(fixture);
      const readonlyFile = path.join(dir, "readonly.js");
      rm(readonlyFile);
      fs.writeFileSync(readonlyFile, "", { mode: "0444" }); // readonly
      expect(await run(fixture, ["make"])).toMatchInlineSnapshot(`
        ⧙-- TROUBLE WRITING OUTPUT ------------------------------------------------------⧘
        ⧙Target: Main⧘

        I managed to compile your code and read the generated file:

        /Users/you/project/tests/fixtures/errors/readonly-output/elm-stuff/elm-watch/0.js

        After running your postprocess command, I tried to write the result of that to the output path:

        /Users/you/project/tests/fixtures/errors/readonly-output/readonly.js

        But I encountered this error:

        EACCES: permission denied, open '/Users/you/project/tests/fixtures/errors/readonly-output/readonly.js'
      `);
    });

    test("fail to write dummy output", async () => {
      const fixture = "readonly-output";
      const dir = fixtureDir(fixture);
      const readonlyFile = path.join(dir, "readonly.js");
      rm(readonlyFile);
      fs.writeFileSync(readonlyFile, "", { mode: "0444" }); // readonly
      expect(
        await run(fixture, ["hot"], {
          exitHotOnError: true,
        }),
      ).toMatchInlineSnapshot(`
        ⧙-- TROUBLE WRITING DUMMY OUTPUT ------------------------------------------------⧘
        ⧙Target: Main⧘

        There are no WebSocket connections for this target, so I only typecheck the
        code. That went well. Then I tried to write a dummy output file here:

        /Users/you/project/tests/fixtures/errors/readonly-output/readonly.js

        Doing so I encountered this error:

        EACCES: permission denied, open '/Users/you/project/tests/fixtures/errors/readonly-output/readonly.js'
      `);
    });

    test("command not found", async () => {
      const output = await run("postprocess/variants/command-not-found", [
        "make",
      ]);

      expect(
        output.replace(/PATH(.*:\n\n)(.+\n)+/i, "PATH$1/some/fake/bin/path\n"),
      ).toMatchInlineSnapshot(`
        ⧙-- COMMAND NOT FOUND -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I tried to execute ⧙nope⧘, but it does not appear to exist!

        This is what the PATH environment variable looks like:

        /some/fake/bin/path

        Is ⧙nope⧘ installed?
      `);
    });

    test("exit 1 + stdout", async () => {
      expect(await run("postprocess/variants/exit-1-stdout", ["make"]))
        .toMatchInlineSnapshot(`
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
      `);
    });

    test("exit 2 + stderr + debug", async () => {
      expect(
        await run("postprocess/variants/exit-2-stderr", ["make", "--debug"]),
      ).toMatchInlineSnapshot(`
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
      `);
    });

    test("exit 3 + no output + optimize", async () => {
      expect(
        await run("postprocess/variants/exit-3-no-output", [
          "make",
          "--optimize",
        ]),
      ).toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/exit-3-no-output
        printf '(function(...;}(this));' | node -e 'process.exit(3)' main optimize make

        ⧙It exited with an error:⧘

        exit 3
        ⧙(no output)⧘
      `);
    });

    test("exit 4 + both stdout and stderr", async () => {
      expect(
        await run("postprocess/variants/exit-4-both-stdout-and-stderr", [
          "make",
        ]),
      ).toMatchInlineSnapshot(`
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
      `);
    });

    test("exit 5 + tricky args", async () => {
      expect(await run("postprocess/variants/exit-5-tricky-args", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS ERROR -----------------------------------------------------------⧘
        ⧙Target: main⧘

        I ran your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/exit-5-tricky-args
        printf '(function(...;}(this));' | node -e 'process.exit(5)' -- '' \\'a\\'b\\' '$x' main standard make

        ⧙It exited with an error:⧘

        exit 5
        ⧙(no output)⧘
      `);
    });

    testExceptLinux("forgot to read stdin", async () => {
      const fixture = "postprocess/variants/no-stdin-read";
      const dir = fixtureDir(fixture);
      const elmWatchJson = fs.readFileSync(
        path.join(dir, "elm-watch.template.json"),
        "utf8",
      );
      // `echo` works for the test on all platforms, except on Linux it
      // _sometimes_ does not trigger the stdin error. `true` works on Linux and
      // macOS, but not Windows. I also tried `node -e ''` but that never seems
      // to trigger the stdin error on Linux. Solution: Use `true` on Linux and
      // `echo` otherwise.
      const newElmWatchJson =
        process.platform === "linux"
          ? elmWatchJson.replace("echo", "true")
          : elmWatchJson;
      fs.writeFileSync(path.join(dir, "elm-watch.json"), newElmWatchJson);
      const output = (await run(fixture, ["make"])).replace("true", "echo");
      expect(output).toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS STDIN TROUBLE ---------------------------------------------------⧘
        ⧙Target: main⧘

        I tried to run your postprocess command:

        cd /Users/you/project/tests/fixtures/errors/postprocess/variants/no-stdin-read
        printf '(function(...;}(this));' | echo main standard make

        Trying to write to its ⧙stdin⧘, I got an error!
        ⧙Did you forget to read stdin, maybe?⧘

        Note: If you don't need stdin in some case, you can pipe it to stdout!

        This is the error message I got:

        write EPIPE
      `);
    });
  });

  describe("elm-watch-node errors", () => {
    test("missing script", async () => {
      expect(await run("postprocess/variants/missing-script", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- MISSING POSTPROCESS SCRIPT --------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/missing-script/elm-watch.json

        You have specified this in ⧙elm-watch.json⧘:

        "postprocess": ["elm-watch-node"]

        You need to specify a JavaScript file to run as well, like so:

        "postprocess": ["elm-watch-node", "postprocess.js"]
      `);
    });

    test("script not found", async () => {
      expect(await run("postprocess/variants/script-not-found", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/script-not-found/not-found.js

        I tried to import your postprocess file:

        const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/script-not-found/not-found.js")

        But that resulted in this error:

        Cannot find module '/Users/you/project/tests/fixtures/errors/postprocess/variants/script-not-found/not-found.js' imported from /Users/you/project/src/PostprocessWorker.ts
      `);
    });

    test("throw at import", async () => {
      expect(await run("postprocess/variants/throw-at-import", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-at-import/postprocess.js

        I tried to import your postprocess file:

        const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/throw-at-import/postprocess.js")

        But that resulted in this error:

        Error: Failed to initialize!
            at fake/stacktrace.js
      `);
    });

    test("throw non-error at import, with console.log", async () => {
      expect(
        await run("postprocess/variants/throw-non-error-at-import", ["make"]),
      ).toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS IMPORT ERROR ----------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-non-error-at-import/postprocess.js

        I tried to import your postprocess file:

        const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/throw-non-error-at-import/postprocess.js")

        But that resulted in this error:

        [
          null,
          "error"
        ]

        STDOUT:
        My debug message

        STDERR:
      `);
    });

    test("empty file", async () => {
      expect(await run("postprocess/variants/empty-file", ["make"]))
        .toMatchInlineSnapshot(`
          ⧙-- MISSING POSTPROCESS DEFAULT EXPORT ------------------------------------------⧘
          /Users/you/project/tests/fixtures/errors/postprocess/variants/empty-file/postprocess.js

          I imported your postprocess file:

          const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/empty-file/postprocess.js")

          I expected ⧙imported.default⧘ to be a function, but it isn't!

          typeof imported.default === "undefined"

          ⧙imported⧘ is:

          {}

          Here is a sample function to get you started:

          // CJS
          module.exports = async function postprocess({ code, targetName, compilationMode }) {
            return code;
          };

          // MJS
          export default async function postprocess({ code, targetName, compilationMode }) {
            return code;
          };
        `);
    });

    test("wrong default export, with console.log and console.error", async () => {
      const output = await run("postprocess/variants/wrong-default-export", [
        "make",
      ]);
      const normalized = output.replace(
        // Only Node.js 24+ includes this line.
        /\s+"module\.exports": Object\(1\),/,
        "",
      );
      expect(normalized).toMatchInlineSnapshot(`
        ⧙-- MISSING POSTPROCESS DEFAULT EXPORT ------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/wrong-default-export/postprocess.cjs

        I imported your postprocess file:

        const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/wrong-default-export/postprocess.cjs")

        I expected ⧙imported.default⧘ to be a function, but it isn't!

        typeof imported.default === "object"

        ⧙imported⧘ is:

        {
          "default": Object(1),
          "postprocess": function "postprocess"
        }

        Here is a sample function to get you started:

        // CJS
        module.exports = async function postprocess({ code, targetName, compilationMode }) {
          return code;
        };

        // MJS
        export default async function postprocess({ code, targetName, compilationMode }) {
          return code;
        };

        STDOUT:
        This is stdout
        on two lines

        STDERR:
        This is stderr
      `);
    });

    test("throw error, with process.stdout.write", async () => {
      expect(await run("postprocess/variants/throw-error", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-error/postprocess.js

        I tried to run your postprocess command:

        const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/throw-error/postprocess.js")
        const result = await imported.default({
          "code": "(function(...;}(this));",
          "targetName": "main",
          "compilationMode": "standard",
          "runMode": "make",
          "argv": [
            "elm-watch-node",
            "/Users/you/project/tests/fixtures/errors/postprocess/variants/throw-error/postprocess.js"
          ]
        })

        But that resulted in this error:

        Error: Failed to run postprocess!
            at fake/stacktrace.js

        STDOUT:
        Some debug message

        STDERR:
      `);
    });

    test("throw null", async () => {
      expect(await run("postprocess/variants/throw-null", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/throw-null/postprocess.js

        I tried to run your postprocess command:

        const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/throw-null/postprocess.js")
        const result = await imported.default({
          "code": "(function(...;}(this));",
          "targetName": "main",
          "compilationMode": "standard",
          "runMode": "make",
          "argv": [
            "elm-watch-node",
            "/Users/you/project/tests/fixtures/errors/postprocess/variants/throw-null/postprocess.js"
          ]
        })

        But that resulted in this error:

        null
      `);
    });

    test("reject promise", async () => {
      expect(await run("postprocess/variants/reject-promise", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- POSTPROCESS RUN ERROR -------------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/reject-promise/postprocess.js

        I tried to run your postprocess command:

        const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/reject-promise/postprocess.js")
        const result = await imported.default({
          "code": "(function(...;}(this));",
          "targetName": "main",
          "compilationMode": "standard",
          "runMode": "make",
          "argv": [
            "elm-watch-node",
            "/Users/you/project/tests/fixtures/errors/postprocess/variants/reject-promise/postprocess.js"
          ]
        })

        But that resulted in this error:

        "rejected!"
      `);
    });

    test("return undefined, with process.stderr.write", async () => {
      expect(await run("postprocess/variants/return-undefined", ["make"]))
        .toMatchInlineSnapshot(`
        ⧙-- INVALID POSTPROCESS RESULT --------------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/postprocess/variants/return-undefined/postprocess.js

        I ran your postprocess command:

        const imported = await import("file:///Users/you/project/tests/fixtures/errors/postprocess/variants/return-undefined/postprocess.js")
        const result = await imported.default({
          "code": "(function(...;}(this));",
          "targetName": "main",
          "compilationMode": "standard",
          "runMode": "make",
          "argv": [
            "elm-watch-node",
            "/Users/you/project/tests/fixtures/errors/postprocess/variants/return-undefined/postprocess.js"
          ]
        })

        I expected ⧙result⧘ to be a string, but it is:

        undefined

        STDOUT:


        STDERR:
        Stderr!
      `);
    });
  });
});
