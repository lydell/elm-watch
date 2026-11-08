import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, test } from "vitest";

import elmWatchCli from "../src/ElmWatch.ts";
import { copyFixture } from "./FixtureCopies.ts";
import {
  assertExitCode,
  clean,
  logDebug,
  MemoryWriteStream,
  readFile,
  rimraf,
  rm,
  SilentReadStream,
  stringSnapshotSerializer,
  testExceptWindows,
} from "./Helpers.ts";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures", "init");

async function initSuccessHelper(
  fixture: string,
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

  assertExitCode(0, exitCode, stdout.content, stderr.content, dir);
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

  assertExitCode(1, exitCode, stdout.content, stderr.content, dir);
  expect(stdout.content).toBe("");

  return clean(stderr.content);
}

async function initUpgrade(
  dir: string,
  expectedExitCode: number,
): Promise<{ stdout: string; stderr: string; json: string }> {
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

  assertExitCode(
    expectedExitCode,
    exitCode,
    stdout.content,
    stderr.content,
    dir,
  );

  return {
    stdout: clean(stdout.content),
    stderr: clean(stderr.content),
    json: readFile(path.join(dir, "elm-watch.json")),
  };
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("init", () => {
  test("too many arguments", async () => {
    expect(
      await initFailHelper("already-exists", "something"),
    ).toMatchInlineSnapshot(
      `⧙elm-watch init⧘ takes either no arguments, ⧙--javascript⧘ or ⧙--typescript⧘.`,
    );
  });

  test("already exists", async () => {
    expect(await initFailHelper("already-exists")).toMatchInlineSnapshot(`
      ⧙elm-watch.json⧘ already exists (and has nothing to upgrade):

      /Users/you/project/tests/fixtures/init/already-exists/elm-watch.json
    `);
  });

  test("already exists further up", async () => {
    expect(await initFailHelper("already-exists/sub")).toMatchInlineSnapshot(`
      ⧙elm-watch.json⧘ already exists (and has nothing to upgrade):

      /Users/you/project/tests/fixtures/init/already-exists/elm-watch.json
    `);
  });

  test("JavaScript API entrypoint already exists", async () => {
    expect(await initFailHelper("existing-entrypoint")).toMatchInlineSnapshot(`
      You already use the JavaScript API (instead of ⧙elm-watch.json⧘):

      /Users/you/project/tests/fixtures/init/existing-entrypoint/elm-watch.mjs

      Documentation: https://lydell.github.io/elm-watch/javascript-api/
    `);
  });

  test("already exists as folder", async () => {
    const dir = path.join(FIXTURES_DIR, "already-exists-as-folder");
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
    assertExitCode(1, exitCode, stdout.content, stderr.content, dir);
    expect(stderr.content).toBe("");
    expect(clean(stdout.content)).toMatchInlineSnapshot(`
      ⧙-- TROUBLE READING elm-watch.json ----------------------------------------------⧘
      /Users/you/project/tests/fixtures/init/already-exists-as-folder/elm-watch.json

      I read inputs, outputs and options from ⧙elm-watch.json⧘.

      ⧙I had trouble reading it:⧘

      EISDIR: illegal operation on a directory, read
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

  testExceptWindows("fail to write, --javascript", async () => {
    fs.mkdirSync(path.join(FIXTURES_DIR, "readonly"), {
      recursive: true,
      mode: "0444", // readonly
    });
    expect(await initFailHelper("readonly", "--javascript"))
      .toMatchInlineSnapshot(`
      Failed to write ⧙elm-watch.mjs⧘:

      EACCES: permission denied, open '/Users/you/project/tests/fixtures/init/readonly/elm-watch.mjs'
    `);
  });

  test("success", async () => {
    const { stdout, json } = await initSuccessHelper("empty");

    expect(stdout).toMatchInlineSnapshot(`
      Created a minimal ⧙elm-watch.json⧘ in the current directory to get you started.
      Go check it out!

      Documentation: https://lydell.github.io/elm-watch/elm-watch.json/

    `);

    expect(json).toMatchInlineSnapshot(`
      {
          "targets": {
              "My target name": {
                  "type": "application",
                  "elmJson": "elm.json",
                  "inputs": [
                      "src/Main.elm"
                  ],
                  "output": "build/main.js"
              }
          }
      }
    `);
  });

  test("success, package", async () => {
    const { stdout, json } = await initSuccessHelper("package");
    expect(stdout).toMatchInlineSnapshot(`
      Created a minimal ⧙elm-watch.json⧘ in the current directory to get you started.
      Go check it out!

      Documentation: https://lydell.github.io/elm-watch/elm-watch.json/
    `);
    expect(json).toMatchInlineSnapshot(`
      {
          "targets": {
              "My package": {
                  "type": "package",
                  "elmJson": "elm.json"
              }
          }
      }
    `);
  });

  describe("upgrade elm-watch.json from elm-watch 1", () => {
    test("success, and nothing to upgrade the second time", async () => {
      const dir = copyFixture("init", "upgrade");

      const first = await initUpgrade(dir, 0);
      expect(first.stderr).toBe("");
      expect(first.stdout).toMatchInlineSnapshot(`
        Upgraded ⧙elm-watch.json⧘:

        /Users/you/project/tests/fixtures/init/upgrade/elm-watch.json

        Targets now need "type" and "elmJson". I added them to these targets:

        App: app/elm.json
        Admin: admin/elm.json
        Package demo: elm.json

        Documentation: https://lydell.github.io/elm-watch/elm-watch.json/
      `);
      expect(first.json).toMatchInlineSnapshot(`
        {
          "targets": {
            "App": {
              "type": "application",
              "elmJson": "app/elm.json",
              "inputs": [
                "app/src/Main.elm"
              ],
              "output": "build/app.js"
            },
            "Admin": {
              "type": "application",
              "elmJson": "admin/elm.json",
              "inputs": [
                "admin/Main.elm",
                "app/src/Main.elm"
              ],
              "output": "build/admin.js"
            },
            "Package demo": {
              "type": "application",
              "elmJson": "elm.json",
              "inputs": [
                "src/Demo.elm"
              ],
              "output": "build/demo.js"
            },
            "Already upgraded": {
              "type": "application",
              "elmJson": "app/elm.json",
              "inputs": [
                "app/src/Other.elm"
              ],
              "output": "build/other.js"
            }
          },
          "port": 9123
        }
      `);

      const second = await initUpgrade(dir, 1);
      expect(second.stdout).toBe("");
      expect(second.stderr).toMatchInlineSnapshot(`
        ⧙elm-watch.json⧘ already exists (and has nothing to upgrade):

        /Users/you/project/tests/fixtures/init/upgrade/elm-watch.json
      `);
      expect(second.json).toBe(first.json);
    });

    test("elm.json not found", async () => {
      // This has to be done in a directory outside the repo, to make sure that
      // there is no elm.json further up.
      const dir = path.join(os.tmpdir(), "elm-watch-init-upgrade");
      await rimraf(dir);
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "elm-watch.json"),
        '{\n\t"targets": {\n\t\t"Main": {\n\t\t\t"inputs": ["src/Main.elm"],\n\t\t\t"output": "build/main.js"\n\t\t}\n\t}\n}',
      );

      const { stdout, stderr, json } = await initUpgrade(dir, 0);
      await rimraf(dir);
      expect(stderr).toBe("");
      expect(stdout).toMatchInlineSnapshot(`
        Upgraded ⧙elm-watch.json⧘:

        /tmp/fake/elm-watch-init-upgrade/elm-watch.json

        Targets now need "type" and "elmJson". I added them to these targets:

        Main: elm.json ⧙(not found)⧘

        ⧙(not found)⧘ means that I couldn’t find an elm.json for the target.
        Please update "elmJson" yourself!

        Documentation: https://lydell.github.io/elm-watch/elm-watch.json/
      `);
      expect(json).toMatchInlineSnapshot(`
        {
        	"targets": {
        		"Main": {
        			"type": "application",
        			"elmJson": "elm.json",
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
});
