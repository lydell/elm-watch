import * as fs from "fs";
import * as path from "path";

import { elmWatchCli } from "../src";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  FailReadStream,
  logDebug,
  MemoryWriteStream,
  prependPATH,
  stringSnapshotSerializer,
  TEST_ENV,
} from "./Helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

async function run(
  fixture: string,
  args: Array<string>,
  { isTTY = true, bin }: { isTTY?: boolean; bin?: string } = {}
): Promise<string> {
  const dir = path.join(FIXTURES_DIR, fixture);
  const build = path.join(dir, "build");

  if (fs.rmSync !== undefined) {
    fs.rmSync(build, { recursive: true, force: true });
  } else if (fs.existsSync(build)) {
    fs.rmdirSync(build, { recursive: true });
  }

  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const exitCode = await elmWatchCli(args, {
    cwd: dir,
    env: {
      ...process.env,
      ...TEST_ENV,
      PATH:
        bin === undefined ? process.env.PATH : prependPATH(path.join(dir, bin)),
    },
    stdin: new FailReadStream(),
    stdout,
    stderr,
    logDebug,
  });

  const stdoutString = clean(stdout.getOutput());

  assertExitCode(0, exitCode, stdoutString, stderr.content);
  expect(stderr.content).toBe("");

  return stdoutString;
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("successful make", () => {
  test("standard mode", async () => {
    expect(await run("successful-make", ["make"])).toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms.
    `);
  });

  test("--debug", async () => {
    expect(await run("successful-make", ["make", "--debug"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms.
    `);
  });

  test("--optimize", async () => {
    expect(await run("successful-make", ["make", "--optimize"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙   87.5 KiB → 0.00 KiB (0.0%)     1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms.
    `);
  });

  test("installed packages output", async () => {
    expect(
      await run("successful-make", ["make"], {
        bin: "installed-packages-output-bin",
      })
    ).toMatchInlineSnapshot(`
      ✅ Dependencies
         ● elm/html 1.0.0
         ● elm/browser 1.0.2
         ● elm/virtual-dom 1.0.2
         ● elm/time 1.0.0
         ● elm/json 1.1.3
         ● elm/url 1.0.0
         ● elm/core 1.0.5
      ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms.
    `);
  });

  test("CI", async () => {
    expect(
      await run("successful-make", ["make", "--optimize"], { isTTY: false })
    ).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ main: elm make --optimize
      🟢 main: elm make done
      ⏳ main: postprocess
      ✅ main⧙   87.5 KiB → 0.00 KiB (0.0%)     1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms.
    `);
  });

  test("postprocess with elm-watch-node (cjs default)", async () => {
    expect(await run("postprocess-elm-watch-node", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
    `);
  });

  test("postprocess with elm-watch-node (cjs)", async () => {
    expect(await run("postprocess-elm-watch-node/cjs", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
    `);
  });

  test("postprocess with elm-watch-node (mjs)", async () => {
    expect(await run("postprocess-elm-watch-node/mjs", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
    `);
  });

  test("postprocess with elm-watch-node (mjs default)", async () => {
    expect(await run("postprocess-elm-watch-node/mjs-default", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms⧙ (using 1 elm-watch-node worker).⧘
    `);
  });

  test("multiple elm.json", async () => {
    expect(await run("multiple-elm-json/config", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ Dependencies (2/2)
      ✅ app⧙                                   1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘
      ✅ admin⧙                                 1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms.
    `);
  });

  test("multiple elm-watch-node", async () => {
    expect(await run("multiple-elm-watch-node", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ main⧙                                  1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘
      ✅ secondary⧙                             1 ms Q | 1.23 s E |   0 ms R | 31.2 s P⧘

      ✅ Compilation finished in ⧙123⧘ ms⧙ (using 2 elm-watch-node workers).⧘
    `);
  });

  test("no postprocess", async () => {
    expect(await run("successful-make-no-postprocess", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ 💣 Mine Sweeper Clone⧙                                       1 ms Q | 1.23 s E⧘

      ✅ Compilation finished in ⧙123⧘ ms.
    `);
  });
});
