// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import { __ELM_WATCH_ELM_TIMEOUT_MS } from "../src/Env.ts";
import {
  grep,
  stringSnapshotSerializer,
  TEST_ENV,
  touch,
  waitFor,
} from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  fixtureDir,
  run,
  sendSigterm,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot", () => {
  afterEach(cleanupAfterEachTest);

  test("kill Elm", async () => {
    const fixture = "kill-elm";
    const dir = fixtureDir(fixture);
    const input = path.join(dir, "src", "Main.elm");
    const lock = path.join(dir, "lock");

    // Hang on installing dependencies.
    // `bad-bin/compile-forever/elm` then updates `lock` to hang on typecheck
    // only, and then succeed.
    fs.writeFileSync(lock, "LockAll");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["main.js"],
      isTTY: false,
      bin: "compile-forever",
      env: {
        ...TEST_ENV,
        [__ELM_WATCH_ELM_TIMEOUT_MS]: "0",
      },
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: ({ idle }) => {
        switch (idle) {
          case 1:
            // Hang on compile.
            // `bad-bin/compile-forever/elm` then updates `lock` to succeed.
            fs.writeFileSync(lock, "LockExceptInstall");
            touch(input);
            return "KeepGoing";

          default:
            return "Stop";
        }
      },
    });

    // The middle “Dependencies” line is when it’s interrupted.
    expect(grep(terminal, /[⏳✅]/u)).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ⏳ Dependencies
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ Main: elm make (typecheck only)
      ⏳ Main: interrupted
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed src/Main.elm +1 more⧘
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Main⧘
      ⏳ Main: elm make
      ⏳ Main: interrupted
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed src/Main.elm +1 more⧘
    `);
  });

  test("kill Elm while installing dependencies in TTY mode", async () => {
    const fixture = "kill-elm";
    const dir = fixtureDir(fixture);
    const lock = path.join(dir, "lock");

    // Hang on installing dependencies.
    fs.writeFileSync(lock, "LockAll");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["main.js"],
      isTTY: true,
      bin: "compile-forever",
      env: {
        ...TEST_ENV,
        [__ELM_WATCH_ELM_TIMEOUT_MS]: "0",
      },
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: () => "Stop",
    });

    expect(terminal).toMatchInlineSnapshot(`
      ✅ Main⧙                                  1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      🌐 http://localhost:59123

      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Main⧘
    `);
  });

  test("SIGTERM waits for Elm to finish", async () => {
    const fixture = "kill-elm";
    const dir = fixtureDir(fixture);
    const input = path.join(dir, "src", "Main.elm");
    const lock = path.join(dir, "lock");
    const readLock = (): string => fs.readFileSync(lock, "utf8");
    fs.writeFileSync(lock, "");

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["main.js"],
      isTTY: false,
      bin: "slow-compile",
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1:
            fs.writeFileSync(lock, "Slow");
            touch(input);
            await waitFor(() => readLock() === "Started");
            sendSigterm();
            fs.writeFileSync(lock, "Continue");
            return "KeepGoing" as const;

          default:
            throw new Error("Expected elm-watch to exit after SIGTERM.");
        }
      },
    });

    // If elm-watch had not waited for Elm, this would still be “Continue”.
    expect(readLock()).toBe("Done");

    expect(grep(terminal, /[⏳✅]/u)).toMatchInlineSnapshot(`
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Main⧘
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed src/Main.elm⧘
    `);
  });

  test("abort signal waits for Elm to finish", async () => {
    const fixture = "kill-elm";
    const dir = fixtureDir(fixture);
    const input = path.join(dir, "src", "Main.elm");
    const lock = path.join(dir, "lock");
    const readLock = (): string => fs.readFileSync(lock, "utf8");
    fs.writeFileSync(lock, "");

    const controller = new AbortController();

    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["main.js"],
      isTTY: false,
      bin: "slow-compile",
      useElmWatchFunction: { signal: controller.signal },
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: async ({ idle }) => {
        switch (idle) {
          case 1:
            fs.writeFileSync(lock, "Slow");
            touch(input);
            await waitFor(() => readLock() === "Started");
            controller.abort();
            fs.writeFileSync(lock, "Continue");
            return "KeepGoing" as const;

          default:
            throw new Error("Expected elm-watch to exit after abort.");
        }
      },
    });

    // If elm-watch had not waited for Elm, this would still be “Continue”.
    expect(readLock()).toBe("Done");

    expect(grep(terminal, /[⏳✅]/u)).toMatchInlineSnapshot(`
      ⏳ Main: elm make (typecheck only)
      ✅ Main⧙     1 ms Q | 765 ms T ¦  50 ms W⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: Main⧘
      ⏳ Main: elm make
      ✅ Main⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘
      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed src/Main.elm⧘
    `);
  });

  test("kill postprocess", async () => {
    const fixture = "kill-postprocess";
    const input = path.join(fixtureDir(fixture), "src", "Main.elm");
    const tmp = path.join(fixtureDir(fixture), "postprocess.tmp");
    fs.writeFileSync(tmp, "1");
    const { terminal } = await run({
      fixture,
      args: [],
      scripts: ["Main.js"],
      isTTY: false,
      useElmWatchFunction: true,
      init: (node) => {
        window.Elm?.["Main"]?.init({ node });
      },
      onIdle: async ({ idle, div }) => {
        switch (idle) {
          case 1:
            assert1(div);
            touch(input);
            // Wait for Elm to finish and postprocess to start.
            await waitFor(() => fs.readFileSync(tmp, "utf8") === "3");
            touch(input); // Touch while postprocessing.
            return "KeepGoing";
          default:
            assert2(div);
            return "Stop";
        }
      },
    });

    expect(grep(terminal, /: (?:postprocess|interrupted)/))
      .toMatchInlineSnapshot(`
        ⏳ Main: postprocess
        ⏳ Main: postprocess
        ⏳ Main: interrupted
        ⏳ Main: postprocess
      `);

    function assert1(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content before</div>`,
      );
    }

    function assert2(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(
        `<div>postprocess content after</div>`,
      );
    }
  });
});
