import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "vitest";

import elmWatchCli, { elmWatch } from "../src/ElmWatch.ts";
import { __ELM_WATCH_MOCKED_TIMINGS, type Env, NO_COLOR } from "../src/Env.ts";
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
      ✅ main⧙                                                        1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("--debug", async () => {
    expect(await run("successful-make", ["make", "--debug"]))
      .toMatchInlineSnapshot(`
        ✅ main⧙                                                        1 ms Q | 1.23 s E⧘

        ✅ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("--optimize", async () => {
    expect(await run("successful-make", ["make", "--optimize"]))
      .toMatchInlineSnapshot(`
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
        env: { [NO_COLOR]: "1" },
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
        ✅ app⧙                                                         1 ms Q | 1.23 s E⧘
        ✅ admin⧙                                                       1 ms Q | 1.23 s E⧘

        ✅ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("different compilers for the same elm.json", async () => {
    expect(await run("mixed-compilers", ["make"])).toMatchInlineSnapshot(`
      ✅ elm⧙                                                         1 ms Q | 1.23 s E⧘
      ✅ lamdera⧙                                                     1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);

    // Only Lamdera’s elm/core has `Elm.hot`.
    const hasElmHot = (name: string): boolean =>
      fs
        .readFileSync(fixtureDir(`mixed-compilers/build/${name}.js`), "utf8")
        .includes("'hot', {");
    expect(hasElmHot("elm")).toBe(false);
    expect(hasElmHot("lamdera")).toBe(true);
  });

  test("package target, and an example application using the package", async () => {
    expect(await run("package", ["make"])).toMatchInlineSnapshot(`
      ✅ Example⧙                                                     1 ms Q | 1.23 s E⧘
      ✅ Package⧙                                                     1 ms Q | 765 ms T⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("package target via elmWatch()", async () => {
    expect(
      await run("package", [], {
        elmWatchOptions: (dir) =>
          Promise.resolve({
            root: dir,
            runMode: "make",
            targets: [
              { type: "package", name: "Package", elmJson: "elm.json" },
            ],
          }),
      }),
    ).toMatchInlineSnapshot(`
      ✅ Package⧙                                                     1 ms Q | 765 ms T⧘

      ✅ Compilation finished in ⧙123 ms⧘.
    `);
  });

  test("status lines scrolled out of view are not updated", async () => {
    // The cursor is on the row below the status lines, so only the admin line
    // is visible. Moving the cursor up to the app line would stop at the top of
    // the screen and overwrite the admin line instead.
    expect(await run("multiple-elm-json/config", ["make"], { rows: 2 }))
      .toMatchInlineSnapshot(`
        ✅ admin⧙                                                       1 ms Q | 1.23 s E⧘

        ✅ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("postprocess does not count towards maxParallel", async () => {
    const fixture = "multiple-postprocess";
    const lock = path.join(fixtureDir(fixture), "lock");
    fs.writeFileSync(lock, "");
    const output = await run(fixture, [], {
      isTTY: false,
      elmWatchOptions: async (dir) => ({
        ...(await fixtureOptions(dir)),
        runMode: "make",
      }),
    });

    // The order of the lines depends on timing, so only snapshot the
    // finished lines, sorted.
    expect(grep(output, /✅/).split("\n").sort().join("\n"))
      .toMatchInlineSnapshot(`
        ✅ Compilation finished in ⧙123 ms⧘.
        ✅ Dependencies
        ✅ main⧙     1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘
        ✅ second⧙     1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘
        ✅ third⧙     1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘
      `);
  });

  test("synchronous postprocess shows up as postprocess (not queued)", async () => {
    const dir = fixtureDir("successful-make");
    await rimraf(path.join(dir, "build"));
    const stdout = new CursorWriteStream();
    const stderr = new MemoryWriteStream();
    stdout.isTTY = true;
    stderr.isTTY = true;
    let outputDuringPostprocess = "";
    // Real timings, not mocked ones.
    const env: Env = { ...process.env, ...TEST_ENV };
    delete env[__ELM_WATCH_MOCKED_TIMINGS];
    const { targets, ...options } = await fixtureOptions(dir);

    const exitCode = await elmWatch({
      ...options,
      targets: targets.map((target) => ({
        ...target,
        postprocess: (code: string) => {
          outputDuringPostprocess = clean(stdout.getOutput());
          const start = Date.now();
          while (Date.now() - start < 200) {
            // Busy wait, like heavy synchronous work.
          }
          return code;
        },
      })),
      runMode: "make",
      env,
      stdin: new SilentReadStream(),
      stdout,
      stderr,
      logDebug,
    });

    const output = clean(stdout.getOutput());
    assertExitCode(0, exitCode, output, stderr.content, dir);

    expect(outputDuringPostprocess).toMatch("⏳ main: postprocess");

    const regex = /(\d+) ms R \| (\d+) ms P/u;
    expect(output).toMatch(regex);
    const [, queued = "", postprocess = ""] = regex.exec(output) ?? [];
    expect(Number(queued)).toBeLessThan(200);
    expect(Number(postprocess)).toBeGreaterThanOrEqual(200);
  });

  test("no postprocess", async () => {
    expect(await run("successful-make-no-postprocess", ["make"]))
      .toMatchInlineSnapshot(`
        ✅ 💣  Mine Sweeper Clone⧙                                       1 ms Q | 1.23 s E⧘

        ✅ Compilation finished in ⧙123 ms⧘.
      `);
  });

  test("no postprocess with optimize", async () => {
    expect(await run("successful-make-no-postprocess", ["make", "--optimize"]))
      .toMatchInlineSnapshot(`
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
        env: { [NO_COLOR]: "1" },
      }),
    ).toMatchInlineSnapshot(`
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
