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

async function editorCommand(
  cwd: string,
  env: Env,
  args: Array<string> = [],
  shell = "/bin/bash",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();
  const exitCode = await elmWatchCli(["editor", ...args], {
    cwd,
    env: { ...env, SHELL: shell },
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

describe("editor", () => {
  testExceptWindows("command, at the elm-watch line", async () => {
    const dir = copyFixture("editor-command", "with-elm-watch");
    const outputFile = path.join(dir, "opened.txt");
    const result = await editorCommand(path.join(dir, "src"), {
      ...process.env,
      [ELM_WATCH_OPEN_EDITOR]: `echo "$file:$line:$column:$line0:$column0" > "${outputFile}"`,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.replace(outputFile, "opened.txt"))
      .toMatchInlineSnapshot(`
        Opening package.json using ELM_WATCH_OPEN_EDITOR:

        echo "$file:$line:$column:$line0:$column0" > "/Users/you/project/tests/fixtures/editor-command/with-elm-watch/opened.txt"

        Your editor should show the cursor right before "elm-watch":

        /Users/you/project/tests/fixtures/editor-command/with-elm-watch/package.json:5:5
            "elm-watch": "2.0.0"
            ^

        Not right? Adjust the value and try again. Once it works, set it permanently (if you haven’t already):

        # ~/.bashrc
        export ELM_WATCH_OPEN_EDITOR='echo "$file:$line:$column:$line0:$column0" > "/Users/you/project/tests/fixtures/editor-command/with-elm-watch/opened.txt"'

        Then restart the shell and elm-watch.
      `);
    expect(clean(fs.readFileSync(outputFile, "utf8"))).toMatchInlineSnapshot(
      `/Users/you/project/tests/fixtures/editor-command/with-elm-watch/package.json:5:5:4:4`,
    );
  });

  testExceptWindows("URL, without elm-watch in package.json", async () => {
    const dir = copyFixture("editor-command", "without-elm-watch");
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
    const result = await editorCommand(dir, {
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

      /Users/you/project/tests/fixtures/editor-command/without-elm-watch/package.json:1:1

      Not right? Adjust the value and try again. Once it works, set it permanently (if you haven’t already):

      # ~/.bashrc
      export ELM_WATCH_OPEN_EDITOR='myeditor://open?file={file}&line={line}&column={column0}'

      Then restart the shell and elm-watch.
    `);
    expect(clean(fs.readFileSync(outputFile, "utf8"))).toMatchInlineSnapshot(
      `myeditor://open?file=/Users/you/project/tests/fixtures/editor-command/without-elm-watch/package.json&line=1&column=0`,
    );
  });

  test("invalid URL", async () => {
    const dir = copyFixture("editor-command", "with-elm-watch");
    const result = await editorCommand(dir, {
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
    const dir = copyFixture("editor-command", "with-elm-watch");
    const result = await editorCommand(dir, {
      ...process.env,
      [ELM_WATCH_OPEN_EDITOR]: "echo oops >&2; exit 3",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      ⧙Opening the location in your editor failed!⧘

      I ran your command for opening an editor (set via the ELM_WATCH_OPEN_EDITOR environment variable):

      cd /Users/you/project/tests/fixtures/editor-command/with-elm-watch
      echo oops >&2; exit 3

      I ran the command with these extra environment variables:

      {
        "file": "/Users/you/project/tests/fixtures/editor-command/with-elm-watch/package.json",
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
    const dir = copyFixture("editor-command", "with-elm-watch");
    const result = await editorCommand(dir, {});
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      ⧙elm-watch editor⧘ helps you set up the ELM_WATCH_OPEN_EDITOR environment variable, for opening error locations in your editor.

      ⧙1. Try out a value, either:⧘

         ⧙An editor URL:⧘

             ELM_WATCH_OPEN_EDITOR='pycharm://open?file={file}&line={line}&column={column0}' elm-watch editor

             ⧙placeholders:⧘ {file} {line} {column} {line0} {column0}

         ⧙Or a shell command:⧘

             ELM_WATCH_OPEN_EDITOR='your-editor "$file:$line:$column"' elm-watch editor

             ⧙variables:⧘ $file $line $column $line0 $column0

         That opens package.json in your editor, at the line and column of "elm-watch".
         Edit and re-run the command until you get it right.

      ⧙2. Set it permanently⧘

         # ~/.bashrc
         export ELM_WATCH_OPEN_EDITOR='...'

      ⧙3. Restart the shell and elm-watch⧘

      More info: https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations
    `);
  });

  testExceptWindows("env var not set, fish", async () => {
    const dir = copyFixture("editor-command", "with-elm-watch");
    const result = await editorCommand(dir, {}, [], "/usr/bin/fish");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatchInlineSnapshot(`
      ⧙elm-watch editor⧘ helps you set up the ELM_WATCH_OPEN_EDITOR environment variable, for opening error locations in your editor.

      ⧙1. Try out a value, either:⧘

         ⧙An editor URL:⧘

             ELM_WATCH_OPEN_EDITOR='pycharm://open?file={file}&line={line}&column={column0}' elm-watch editor

             ⧙placeholders:⧘ {file} {line} {column} {line0} {column0}

         ⧙Or a shell command:⧘

             ELM_WATCH_OPEN_EDITOR='your-editor "$file:$line:$column"' elm-watch editor

             ⧙variables:⧘ $file $line $column $line0 $column0

         That opens package.json in your editor, at the line and column of "elm-watch".
         Edit and re-run the command until you get it right.

      ⧙2. Set it permanently⧘

         # Run once:
         set -Ux ELM_WATCH_OPEN_EDITOR '...'

      ⧙3. Restart elm-watch⧘

      More info: https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations
    `);
  });

  testExceptWindows("quoting the value to set permanently", async () => {
    const dir = copyFixture("editor-command", "with-elm-watch");
    const outputFile = path.join(dir, "opened.txt");
    const value = `printf '%s' "$file" > "${outputFile}"`;
    const env = { ...process.env, [ELM_WATCH_OPEN_EDITOR]: value };
    const bash = await editorCommand(dir, env);
    const fish = await editorCommand(dir, env, [], "/usr/bin/fish");
    const lastLines = (stdout: string): string =>
      stdout.split("\n").slice(-5).join("\n").replace(outputFile, "opened.txt");
    expect(bash.exitCode).toBe(0);
    expect(lastLines(bash.stdout)).toMatchInlineSnapshot(`
      # ~/.bashrc
      export ELM_WATCH_OPEN_EDITOR='printf '\\''%s'\\'' "$file" > "/Users/you/project/tests/fixtures/editor-command/with-elm-watch/opened.txt"'

      Then restart the shell and elm-watch.
    `);
    expect(fish.exitCode).toBe(0);
    expect(lastLines(fish.stdout)).toMatchInlineSnapshot(`
      # Run once:
      set -Ux ELM_WATCH_OPEN_EDITOR 'printf \\'%s\\' "$file" > "/Users/you/project/tests/fixtures/editor-command/with-elm-watch/opened.txt"'

      Then restart elm-watch.
    `);
  });

  test("no package.json", async () => {
    const { root } = path.parse(process.cwd());
    const result = await editorCommand(root, {
      [ELM_WATCH_OPEN_EDITOR]: "myeditor://{file}",
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(`
      ⧙elm-watch editor⧘ opens the closest package.json, but I couldn’t find one in this directory or any of its parents:

      /
    `);
  });

  test("arguments are not allowed", async () => {
    const dir = copyFixture("editor-command", "with-elm-watch");
    const result = await editorCommand(dir, {}, ["package.json"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatchInlineSnapshot(
      `⧙elm-watch editor⧘ takes no arguments.`,
    );
  });
});
