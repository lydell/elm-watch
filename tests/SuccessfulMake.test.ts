import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "vitest";

import elmWatchCli, { elmWatch } from "../src/ElmWatch.ts";
import { type Env, NO_COLOR } from "../src/Env.ts";
import { copyFixture } from "./FixtureCopies.ts";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  fixtureOptions,
  grep,
  logDebug,
  MemoryWriteStream,
  prependPATH,
  rimraf,
  SilentReadStream,
  stringSnapshotSerializer,
  TEST_ENV,
} from "./Helpers.ts";

function fixtureDir(fixture: string): string {
  return copyFixture(".", fixture);
}

async function run(
  fixture: string,
  args: Array<string>,
  {
    isTTY = true,
    rows = Infinity,
    bin,
    env,
    elmWatchOptions,
  }: {
    isTTY?: boolean;
    rows?: number;
    bin?: string;
    env?: Env;
    // Use `elmWatch()` with these options instead of the CLI with `args`.
    elmWatchOptions?: (dir: string) => Promise<Record<string, unknown>>;
  } = {},
): Promise<string> {
  const dir = fixtureDir(fixture);
  const build = path.join(dir, "build");

  await rimraf(build);

  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;
  stdout.rows = rows;

  const sharedOptions = {
    env: {
      ...process.env,
      ...TEST_ENV,
      ...env,
      ...(bin === undefined ? {} : { PATH: prependPATH(path.join(dir, bin)) }),
    },
    stdin: new SilentReadStream(),
    stdout,
    stderr,
    logDebug,
  };

  const exitCode =
    elmWatchOptions === undefined
      ? await elmWatchCli(args, { cwd: dir, ...sharedOptions })
      : await elmWatch({ ...(await elmWatchOptions(dir)), ...sharedOptions });

  const stdoutString = clean(stdout.getOutput());

  assertExitCode(0, exitCode, stdoutString, stderr.content, dir);
  expect(stderr.content).toBe("");

  return stdoutString;
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("successful make", () => {
  test("standard mode", async () => {
    expect(await run("successful-make", ["make"])).toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙                                                        1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("--debug", async () => {
    expect(await run("successful-make", ["make", "--debug"]))
      .toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ main⧙                                                        1 ms Q | 1.23 s E⧘

        ✅ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("--optimize", async () => {
    expect(await run("successful-make", ["make", "--optimize"]))
      .toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ main⧙                                           88.5 KiB     1 ms Q | 1.23 s E⧘

        ✅ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("installed packages output", async () => {
    expect(
      await run("successful-make", ["make"], {
        bin: "installed-packages-output-bin",
      }),
    ).toMatchInlineSnapshot(`
      ✅ Dependencies
         ● elm/html 1.0.0
         ● elm/browser 1.0.2
         ● elm/virtual-dom 1.0.3
         ● elm/time 1.0.0
         ● elm/json 1.1.3
         ● elm/url 1.0.0
         ● elm/core 1.0.5
      ✅ main⧙                                                        1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("CI", async () => {
    expect(
      await run("successful-make", ["make", "--optimize"], { isTTY: false }),
    ).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ main: elm make --optimize
      ✅ main⧙   88.5 KiB     1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("CI, non-fancy", async () => {
    expect(
      await run("successful-make", ["make", "--optimize"], {
        isTTY: false,
        env: { [NO_COLOR]: "" },
      }),
    ).toMatchInlineSnapshot(`
      Dependencies: in progress
      Dependencies: success
      main: elm make --optimize
      main: success   88.5 KiB     1 ms Q | 1.23 s E

      Compilation finished in 123 ms.
    `);
  });

  test("multiple elm.json", async () => {
    expect(await run("multiple-elm-json/config", ["make"]))
      .toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ Dependencies (2/2)
        ✅ app⧙                                                         1 ms Q | 1.23 s E⧘
        ✅ admin⧙                                                       1 ms Q | 1.23 s E⧘

        ✅ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("status lines scrolled out of view are not updated", async () => {
    // The cursor is on the row below the status lines, so only the admin line
    // is visible. Moving the cursor up to the app line would stop at the top of
    // the screen and overwrite the admin line instead.
    expect(await run("multiple-elm-json/config", ["make"], { rows: 2 }))
      .toMatchInlineSnapshot(`
        ✅ Dependencies
        ✅ Dependencies (2/2)

        ✅ admin⧙                                                       1 ms Q | 1.23 s E⧘

        ✅ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("multiple postprocess, with queued postprocess", async () => {
    const fixture = "multiple-postprocess";
    const lock = path.join(fixtureDir(fixture), "lock");
    fs.writeFileSync(lock, "");
    const output = await run(fixture, [], {
      isTTY: false,
      bin: "test-bin",
      elmWatchOptions: async (dir) => ({
        ...(await fixtureOptions(dir)),
        runMode: "make",
      }),
    });

    // The order of the lines in the middle depends on timing, so only
    // snapshot the lines that are deterministic.
    expect(grep(output, /queued|✅/)).toMatchInlineSnapshot(`
      ✅ Dependencies
      ⚪️ second: queued
      ⚪️ third: queued
      ✅ main⧙     1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘
      ✅ second⧙     1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘
      ✅ third⧙     1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘
      ✅ Compilation finished in ⧙123 ms⧘.
    `);

    // Only 2 things run in parallel (`__ELM_WATCH_MAX_PARALLEL` in the tests),
    // so postprocess for the third target has to wait until the first one is done.
    expect(output.indexOf("⏳ third: postprocess")).toBeGreaterThan(
      output.indexOf("✅ main"),
    );
  });

  test("no postprocess", async () => {
    expect(await run("successful-make-no-postprocess", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ 💣  Mine Sweeper Clone⧙                                       1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("no postprocess with optimize", async () => {
    expect(await run("successful-make-no-postprocess", ["make", "--optimize"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ 💣  Mine Sweeper Clone⧙                          88.5 KiB     1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("alignment and truncation and emoji", async () => {
    // Note: It’s really difficult to tell how these align in the editor:
    // - It depends on how your editor renders the emoji: 1, 1.5 or 2 columns?
    // - It depends on how the ad-hoc test terminal escape interpreter handles characters of length 2.
    // - The non-emoji symbol used to not count as emoji, but now it does. It’s ok, though.
    expect(await run("emoji", ["make"])).toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ No emoji⧙                                                    1 ms Q | 1.23 s E⧘
      ✅ No emoji but really long target name that needs to be cut off to fit in the …
      ✅ 😎  Cool emoji⧙                                               1 ms Q | 1.23 s E⧘
      ✅ 🇸🇪 Flag emoji and really long target name that needs to be cut off to fit in…
      ✅ 👋🏻 Skin tone⧙                                                1 ms Q | 1.23 s E⧘
      ✅ ↪  Non-emoji symbol⧙                                         1 ms Q | 1.23 s E⧘
      ✅ ↪️  Emoji version of symbol⧙                                  1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("alignment and truncation and emoji – non-fancy", async () => {
    expect(
      await run("emoji", ["make"], {
        env: { [NO_COLOR]: "" },
      }),
    ).toMatchInlineSnapshot(`
      Dependencies: success
      No emoji: success                                              1 ms Q | 1.23 s E
      No emoji but really long target name that needs to be cut off to fit in the t...
      Cool emoji: success                                            1 ms Q | 1.23 s E
      Flag emoji and really long target name that needs to be cut off to fit in the...
      Skin tone: success                                             1 ms Q | 1.23 s E
      Non-emoji symbol: success                                      1 ms Q | 1.23 s E
      Emoji version of symbol: success                               1 ms Q | 1.23 s E

      Compilation finished in 123 ms.
    `);
  });

  test("alignment and truncation and emoji – non-TTY", async () => {
    expect(
      await run("emoji", ["make"], {
        isTTY: false,
      }),
    ).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ No emoji: elm make
      ⚪️ No emoji but really long target name that needs to be cut off to fit in the terminal: queued
      ⚪️ 😎 Cool emoji: queued
      ⚪️ 🇸🇪 Flag emoji and really long target name that needs to be cut off to fit in the terminal: queued
      ⚪️ 👋🏻 Skin tone: queued
      ⚪️ ↪ Non-emoji symbol: queued
      ⚪️ ↪️ Emoji version of symbol: queued
      ✅ No emoji⧙     1 ms Q | 1.23 s E⧘
      ⏳ No emoji but really long target name that needs to be cut off to fit in the terminal: elm make
      ✅ No emoji but really long target name that needs to be cut off to fit in the terminal⧙     1 ms Q | 1.23 s E⧘
      ⏳ 😎 Cool emoji: elm make
      ✅ 😎 Cool emoji⧙     1 ms Q | 1.23 s E⧘
      ⏳ 🇸🇪 Flag emoji and really long target name that needs to be cut off to fit in the terminal: elm make
      ✅ 🇸🇪 Flag emoji and really long target name that needs to be cut off to fit in the terminal⧙     1 ms Q | 1.23 s E⧘
      ⏳ 👋🏻 Skin tone: elm make
      ✅ 👋🏻 Skin tone⧙     1 ms Q | 1.23 s E⧘
      ⏳ ↪ Non-emoji symbol: elm make
      ✅ ↪ Non-emoji symbol⧙     1 ms Q | 1.23 s E⧘
      ⏳ ↪️ Emoji version of symbol: elm make
      ✅ ↪️ Emoji version of symbol⧙     1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });
});
