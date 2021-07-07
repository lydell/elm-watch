import * as fs from "fs";
import * as path from "path";

import { elmWatchCli } from "../src";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  FailReadStream,
  MemoryWriteStream,
  prependPATH,
  stringSnapshotSerializer,
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

  const stdout = new MemoryWriteStream();
  const stderr = new CursorWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  const exitCode = await elmWatchCli(args, {
    cwd: dir,
    env: {
      ...process.env,
      __ELM_WATCH_LOADING_MESSAGE_DELAY: "0",
      PATH:
        bin === undefined ? process.env.PATH : prependPATH(path.join(dir, bin)),
    },
    stdin: new FailReadStream(),
    stdout,
    stderr,
    getNow: () => new Date(),
    onIdle: undefined,
  });

  const stderrString = clean(stderr.getOutput());

  assertExitCode(0, exitCode, stdout.content, stderrString);
  expect(stdout.content).toBe("");

  return stderrString;
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("successful make", () => {
  test("standard mode", async () => {
    expect(await run("successful-make", ["make"])).toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ build/main.js
    `);
  });

  test("--debug", async () => {
    expect(await run("successful-make", ["make", "--debug"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ build/main.js
    `);
  });

  test("--optimize", async () => {
    expect(await run("successful-make", ["make", "--optimize"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ build/main.js
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
      ✅ build/main.js
    `);
  });

  test("CI", async () => {
    expect(
      await run("successful-make", ["make", "--optimize"], { isTTY: false })
    ).toMatchInlineSnapshot(`
      ⏳ Dependencies
      ✅ Dependencies
      ⏳ build/main.js: elm make --optimize
      ⏳ build/main.js: postprocess
      ✅ build/main.js
    `);
  });

  test("postprocess /dev/null", async () => {
    expect(await run("postprocess-dev-null", ["make"])).toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ /dev/null
    `);
  });

  test("postprocess with elm-watch-node", async () => {
    expect(await run("postprocess-elm-watch-node", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ build/main.js
    `);
  });

  test("multiple elm.json", async () => {
    expect(await run("multiple-elm-json/config", ["make"]))
      .toMatchInlineSnapshot(`
      ✅ Dependencies
      ✅ Dependencies (2/2)
      ✅ ../build/app.js
      ✅ ../build/admin.js
    `);
  });
});
