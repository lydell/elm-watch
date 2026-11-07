import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "vitest";

import { fixtureDir, run, runWithBadElmBin } from "./ErrorsHelpers.ts";
import { fixtureOptions, rm, stringSnapshotSerializer } from "./Helpers.ts";

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
      expect(
        await run(fixture, [], {
          elmWatchOptions: {
            ...(await fixtureOptions(dir)),
            runMode: "make",
          },
        }),
      ).toMatchInlineSnapshot(`
        ⧙-- TROUBLE WRITING OUTPUT ------------------------------------------------------⧘
        ⧙Target: Main⧘

        I managed to compile your code and read the generated file:

        /Users/you/project/tests/fixtures/errors/readonly-output/elm-stuff/elm-watch/0.js

        After running your postprocess function, I tried to write the result of that to the output path:

        /Users/you/project/tests/fixtures/errors/readonly-output/readonly.js

        But I encountered this error:

        EACCES: permission denied, open '/Users/you/project/tests/fixtures/errors/readonly-output/readonly.js'
      `);
    });

    test("postprocess in elm-watch.json is no longer supported", async () => {
      expect(await run("old-postprocess", ["make"])).toMatchInlineSnapshot(`
        ⧙-- INVALID elm-watch.json FORMAT -----------------------------------------------⧘
        /Users/you/project/tests/fixtures/errors/old-postprocess/elm-watch.json

        I read inputs, outputs and options from ⧙elm-watch.json⧘.

        ⧙I had trouble with the JSON inside:⧘

        At root["postprocess"]:
        "postprocess" is no longer supported in elm-watch.json.
        Instead, create a JavaScript file that imports elm-watch and calls \`elmWatch()\`
        with your targets, and give each target a \`postprocess\` function.
        Run \`elm-watch init --javascript\` to create such a file from your
        elm-watch.json.
        Learn more: https://lydell.github.io/elm-watch/postprocess/
        Got: [
          "elm-watch-node",
          "postprocess.js"
        ]
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
  });
});
