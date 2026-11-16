import * as fs from "fs";
import * as path from "path";
import { describe, expect, test } from "vitest";

import elmWatchCli from "../src/ElmWatch.ts";
import { ELM_WATCH_OPEN_EDITOR, type Env } from "../src/Env.ts";
import { copyFixture } from "./FixtureCopies.ts";
import {
  clean,
  logDebug,
  MemoryWriteStream,
  prependPATH,
  SilentReadStream,
  stringSnapshotSerializer,
  testExceptWindows,
} from "./Helpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

async function tryOpen(
  cwd: string,
  env: Env,
  args: Array<string> = [],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();
  const exitCode = await elmWatchCli(["try-open", ...args], {
    cwd,
    env: { ...env, SHELL: "/bin/bash" },
    stdin: new SilentReadStream(),
    stdout,
    stderr,
    logDebug,
  });
  return {
    exitCode,
    stdout: clean(stdout.content),
    stderr: clean(stderr.content),
  };
}

describe("try-open", () => {
  testExceptWindows("command, at the elm-watch line", async () => {
    const dir = copyFixture("try-open", "with-elm-watch");
    const outputFile = path.join(dir, "opened.txt");
    const result = await tryOpen(path.join(dir, "src"), {
      ...process.env,
      [ELM_WATCH_OPEN_EDITOR]: `echo "$file:$line:$column:$line0:$column0" > "${outputFile}"`,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.replace(outputFile, "opened.txt"))
      .toMatchInlineSnapshot(`
      Opening package.json using ELM_WATCH_OPEN_EDITOR:

      echo "$file:$line:$column:$line0:$column0" > "/Users/you/project/tests/fixtures/try-open/with-elm-watch/opened.txt"

      Your editor should show the cursor right before "elm-watch":

      /Users/you/project/tests/fixtures/try-open/with-elm-watch/package.json:5:5
          "elm-watch": "2.0.0"
          ^
    `);
    expect(clean(fs.readFileSync(outputFile, "utf8"))).toMatchInlineSnapshot(
      `/Users/you/project/tests/fixtures/try-open/with-elm-watch/package.json:5:5:4:4`,
    );
  });

  testExceptWindows("URL, without elm-watch in package.json", async () => {
    const dir = copyFixture("try-open", "without-elm-watch");
    // Fake `open` (macOS) and `xdg-open` (Linux), so that no editor is opened.
    const binDir = path.join(dir, "fake-open-bin");
    const outputFile = path.join(dir, "opened-url.txt");
    fs.mkdirSync(binDir, { recursive: true });
    for (const name of ["open", "xdg-open"]) {
      const file = path.join(binDir, name);
      fs.writeFileSync(
        file,
        `#!/usr/bin/env node\nimport * as fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(outputFile)}, process.argv.slice(2).join(" "));\n`,
      );
      fs.chmodSync(file, 0o755);
    }
    const result = await tryOpen(dir, {
      ...process.env,
      PATH: prependPATH(binDir),
      [ELM_WATCH_OPEN_EDITOR]:
        "myeditor://open?file={file}&line={line}&column={column0}",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      Opening package.json using ELM_WATCH_OPEN_EDITOR:

      myeditor://open?file={file}&line={line}&column={column0}

      package.json does not mention "elm-watch", so your editor should show the cursor at the very start of the file:

      /Users/you/project/tests/fixtures/try-open/without-elm-watch/package.json:1:1
    `);
    expect(clean(fs.readFileSync(outputFile, "utf8"))).toMatchInlineSnapshot(
      `myeditor://open?file=/Users/you/project/tests/fixtures/try-open/without-elm-watch/package.json&line=1&column=0`,
    );
  });

  test("invalid URL", async () => {
    const dir = copyFixture("try-open", "with-elm-watch");
    const result = await tryOpen(dir, {
      [ELM_WATCH_OPEN_EDITOR]: "myeditor://open?line={line}",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      ⧙Opening the location in your editor failed!⧘

      Your ELM_WATCH_OPEN_EDITOR environment variable looks like a URL:

      myeditor://open?line={line}

      But it is not a valid URL for opening an editor: The URL must contain {file}.

      These placeholders are replaced: {file} {line} {column} {line0} {column0}
    `);
  });

  testExceptWindows("failing command", async () => {
    const dir = copyFixture("try-open", "with-elm-watch");
    const result = await tryOpen(dir, {
      ...process.env,
      [ELM_WATCH_OPEN_EDITOR]: "echo oops >&2; exit 3",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      ⧙Opening the location in your editor failed!⧘

      I ran your command for opening an editor (set via the ELM_WATCH_OPEN_EDITOR environment variable):

      cd /Users/you/project/tests/fixtures/try-open/with-elm-watch
      echo oops >&2; exit 3

      I ran the command with these extra environment variables:

      {
        "file": "/Users/you/project/tests/fixtures/try-open/with-elm-watch/package.json",
        "line": "5",
        "column": "5",
        "line0": "4",
        "column0": "4"
      }

      The command exited with code 3.

      oops
    `);
  });

  testExceptWindows("env var not set", async () => {
    const dir = copyFixture("try-open", "with-elm-watch");
    const result = await tryOpen(dir, {});
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatchInlineSnapshot(`
      ⧙elm-watch try-open⧘ tries out the ELM_WATCH_OPEN_EDITOR environment variable, but it isn’t set. Set it to a URL or a command:

      # ~/.bashrc
      # A URL ({file} {line} {column} {line0} {column0}):
      export ELM_WATCH_OPEN_EDITOR='pycharm://open?file={file}&line={line}&column={column0}'
      # Or a command ($file $line $column $line0 $column0):
      export ELM_WATCH_OPEN_EDITOR='your-editor "$file:$line:$column"'

      Or try it out without setting it permanently:

      ELM_WATCH_OPEN_EDITOR='pycharm://open?file={file}&line={line}&column={column0}' elm-watch try-open

      Check this out: https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations
    `);
  });

  test("no package.json", async () => {
    const { root } = path.parse(process.cwd());
    const result = await tryOpen(root, {
      [ELM_WATCH_OPEN_EDITOR]: "myeditor://{file}",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      ⧙elm-watch try-open⧘ opens the closest package.json, but I couldn’t find one in this directory or any of its parents:

      /
    `);
  });

  test("arguments are not allowed", async () => {
    const dir = copyFixture("try-open", "with-elm-watch");
    const result = await tryOpen(dir, {}, ["package.json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(
      `⧙elm-watch try-open⧘ takes no arguments.`,
    );
  });
});
