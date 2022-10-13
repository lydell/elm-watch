import * as fs from "fs";
import * as path from "path";

import { elmWatchCli } from "../src";
import {
  assertExitCode,
  clean,
  logDebug,
  MemoryWriteStream,
  readFile,
  rm,
  SilentReadStream,
  stringSnapshotSerializer,
  testExceptWindows,
} from "./Helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "init");

async function initSuccessHelper(
  fixture: string
): Promise<{ stdout: string; json: string }> {
  const dir = path.join(FIXTURES_DIR, fixture);
  const elmWatchJsonPath = path.join(dir, "elm-watch.json");
  rm(elmWatchJsonPath);

  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(["init"], {
    cwd: dir,
    env: {},
    stdin: new SilentReadStream(),
    stdout,
    stderr,
    logDebug,
  });

  assertExitCode(0, exitCode, stdout.content, stderr.content);
  expect(stderr.content).toBe("");

  return {
    stdout: clean(stdout.content),
    json: readFile(elmWatchJsonPath),
  };
}

async function initFailHelper(
  fixture: string,
  ...args: Array<string>
): Promise<string> {
  const dir = path.join(FIXTURES_DIR, fixture);

  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(["init", ...args], {
    cwd: dir,
    env: {},
    stdin: new SilentReadStream(),
    stdout,
    stderr,
    logDebug,
  });

  assertExitCode(1, exitCode, stdout.content, stderr.content);
  expect(stdout.content).toBe("");

  return clean(stderr.content);
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("init", () => {
  test("too many arguments", async () => {
    expect(await initFailHelper("already-exists", "something"))
      .toMatchInlineSnapshot(`
      ⧙elm-watch init⧘ takes no arguments.

    `);
  });

  test("already exists", async () => {
    expect(await initFailHelper("already-exists")).toMatchInlineSnapshot(`
      ⧙elm-watch.json⧘ already exists in the current directory!

    `);
  });

  test("already exists as folder", async () => {
    expect(await initFailHelper("already-exists-as-folder"))
      .toMatchInlineSnapshot(`
      ⧙elm-watch.json⧘ already exists in the current directory!

    `);
  });

  testExceptWindows("fail to write", async () => {
    fs.mkdirSync(path.join(FIXTURES_DIR, "readonly"), {
      recursive: true,
      mode: "0444", // readonly
    });
    expect(await initFailHelper("readonly")).toMatchInlineSnapshot(`
      Failed to write ⧙elm-watch.json⧘:

      EACCES: permission denied, open '/Users/you/project/tests/fixtures/init/readonly/elm-watch.json'

    `);
  });

  test("success", async () => {
    const { stdout, json } = await initSuccessHelper("empty");

    expect(stdout).toMatchInlineSnapshot(`
      Created a minimal ⧙elm-watch.json⧘ in the current directory to get you started.
      Go check it out!

      Documentation: https://lydell.github.io/elm-watch/elm-watch.json

    `);

    expect(json).toMatchInlineSnapshot(`
      {
          "targets": {
              "My target name": {
                  "inputs": [
                      "src/Main.elm"
                  ],
                  "output": "build/main.js"
              }
          }
      }
    `);
  });
});
