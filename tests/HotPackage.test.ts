import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import { elmWatch } from "../src/ElmWatch.ts";
import type { HotTestHooks } from "../src/Hot.ts";
import { copyFixture } from "./FixtureCopies.ts";
import {
  clean,
  CursorWriteStream,
  logDebug,
  MemoryWriteStream,
  onlyErrorMessages,
  SilentReadStream,
  stringSnapshotSerializer,
  TEST_ENV,
  waitFor,
} from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

let kill: (() => Promise<void>) | undefined = undefined;

afterEach(async () => {
  await kill?.();
  kill = undefined;
});

// Package targets never connect to a browser, so we can’t use the browser
// based test helpers. Instead, wait for compilations to finish in the terminal.
async function start(): Promise<{
  dir: string;
  // Runs `change`, and waits for the next compilation to finish.
  change: (change: () => void) => Promise<void>;
  terminal: () => string;
}> {
  const dir = copyFixture(".", "package");
  let isIdle = false;
  let watcherIsReady = false;

  const hotTestHooks: HotTestHooks = {
    kill: undefined,
    onUpdate: (_msg, idle) => {
      isIdle = idle;
    },
    onWatcherReadyChange: (isReady) => {
      watcherIsReady = isReady;
    },
  };

  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();
  stdout.isTTY = false;
  stderr.isTTY = false;

  const done = elmWatch({
    root: dir,
    runMode: "hot",
    targets: [
      { type: "package", name: "Package", elmJson: "elm.json" },
      {
        type: "application",
        name: "Example",
        elmJson: "example/elm.json",
        inputs: ["example/src/Main.elm"],
        output: "build/example.js",
      },
    ],
    env: { ...process.env, ...TEST_ENV },
    stdin: new SilentReadStream(),
    stdout,
    stderr,
    logDebug,
    hotTestHooks,
  });

  kill = async () => {
    await waitFor(() => isIdle);
    await hotTestHooks.kill?.();
    await done;
    expect(stderr.content).toBe("");
  };

  const countFinished = (): number =>
    stdout.getOutput().split("Compiled in").length - 1;

  const waitForIdle = (): Promise<void> =>
    waitFor(() => isIdle && watcherIsReady);

  await waitFor(() => countFinished() > 0);
  await waitForIdle();

  return {
    dir,
    change: async (change) => {
      const before = countFinished();
      change();
      await waitFor(() => countFinished() > before);
      await waitForIdle();
    },
    terminal: () => clean(stdout.getOutput()),
  };
}

describe("package targets in hot mode", () => {
  test("changes to the package", async () => {
    const { dir, change, terminal } = await start();
    const internal = path.join(dir, "src", "Package", "Internal.elm");
    const internalString = fs.readFileSync(internal, "utf8");

    // A module that is not exposed (but used by an exposed one). Both the
    // package and the example application are affected.
    await change(() => {
      fs.writeFileSync(internal, internalString.replace('"Hello"', "1"));
    });
    await change(() => {
      fs.writeFileSync(internal, internalString);
    });

    // The targets are compiled in parallel, so the order of the status lines
    // varies.
    expect(onlyErrorMessages(terminal())).toMatchInlineSnapshot(`
      ⧙-- TYPE MISMATCH ---------------------------------------------------------------⧘
      /Users/you/project/tests/fixtures/package/src/Package/Internal.elm:6:5

      Something is off with the body of the \`greeting\` definition:

      6|     1
             ⧙^⧘
      The body is a number of type:

          ⧙number⧘

      But the type annotation on \`greeting\` says it should be:

          ⧙String⧘

      ⧙Hint⧘: Try using ⧙String.fromInt⧘ to convert it to a string?
    `);
    expect(terminal().trimEnd().split("\n").slice(-5).sort().join("\n"))
      .toMatchInlineSnapshot(`
        ⏳ Package: elm make (typecheck only)
        ✅ Example⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
        ✅ Package⧙     1 ms Q | 765 ms T⧘
        ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed src/Package/Internal.elm⧘
      `);
  });

  test("elm.json changes type", async () => {
    const { dir, change, terminal } = await start();
    const elmJsonPath = path.join(dir, "elm.json");
    const elmJsonString = fs.readFileSync(elmJsonPath, "utf8");

    // Flipping the "type" of elm.json is an error for the package target.
    await change(() => {
      fs.writeFileSync(
        elmJsonPath,
        fs.readFileSync(path.join(dir, "example", "elm.json"), "utf8"),
      );
    });
    await change(() => {
      fs.writeFileSync(elmJsonPath, elmJsonString);
    });

    expect(onlyErrorMessages(terminal())).toMatchInlineSnapshot(`
      ⧙-- elm.json TYPE MISMATCH ------------------------------------------------------⧘
      ⧙Target: Package⧘

      This target has ⧙"type": "package"⧘, but its ⧙elm.json⧘ has ⧙"type": "application"⧘:

      /Users/you/project/tests/fixtures/package/elm.json

      Either change the "type" of the target, or use another ⧙elm.json⧘.

      Note: Package targets typecheck an Elm package, like running \`elm make\` without
      arguments. To compile Elm files with \`main\` to JavaScript, use
      "type": "application" (with inputs and output) instead.
    `);
    expect(terminal().trimEnd().split("\n").slice(-5).sort().join("\n"))
      .toMatchInlineSnapshot(`
        ⏳ Package: elm make (typecheck only)
        ✅ Example⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
        ✅ Package⧙     1 ms Q | 765 ms T⧘
        ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed elm.json⧘
      `);
  });
});
