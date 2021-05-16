import * as path from "path";

import { elmWatchCli } from "../src";
import {
  clean,
  FailReadStream,
  MemoryWriteStream,
  stringSnapshotSerializer,
} from "./helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures", "precompilation-errors");

async function validateFailHelper(
  fixture: string,
  args: Array<string>
): Promise<string> {
  return validateFailHelperAbsolute(path.join(FIXTURES_DIR, fixture), args);
}

async function validateFailHelperAbsolute(
  dir: string,
  args: Array<string>
): Promise<string> {
  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(args, {
    cwd: dir,
    env: {},
    stdin: new FailReadStream(),
    stdout,
    stderr,
  });

  expect(stdout.content).toBe("");
  expect(exitCode).toBe(1);

  return clean(stderr.content);
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("precompilation errors", () => {
  test("inputs not found", async () => {
    expect(await validateFailHelper("inputs-not-found", ["make"]))
      .toMatchInlineSnapshot(`
        main.js
        You asked me to compile these inputs:

        Main.elm ⧙(/Users/you/project/fixtures/precompilation-errors/inputs-not-found/Main.elm)⧘
        pages/About.elm ⧙(/Users/you/project/fixtures/precompilation-errors/inputs-not-found/pages/About.elm)⧘

        ⧙But they don't exist!⧘

        Is something misspelled? Or do you need to create them?

      `);
  });

  test("symlink loop", async () => {
    expect(await validateFailHelper("symlink-loop", ["make"]))
      .toMatchInlineSnapshot(`
        main.js
        I start by checking if the inputs you give me exist,
        but doing so resulted in errors!

        Main.elm:
        ELOOP: too many symbolic links encountered, stat '/Users/you/project/fixtures/precompilation-errors/symlink-loop/Main.elm'

        ⧙That's all I know, unfortunately!⧘

      `);
  });

  test("duplicate inputs", async () => {
    expect(await validateFailHelper("duplicate-inputs", ["make"]))
      .toMatchInlineSnapshot(`
        main.js
        Some of your inputs seem to be duplicates!

        Main.elm
        ../duplicate-inputs/./Main.elm
        -> /Users/you/project/fixtures/precompilation-errors/duplicate-inputs/Main.elm

        Make sure every input is listed just once!

      `);
  });

  test("duplicate inputs with symlinks", async () => {
    expect(await validateFailHelper("duplicate-inputs-with-symlinks", ["make"]))
      .toMatchInlineSnapshot(`
        main.js
        Some of your inputs seem to be duplicates!

        Main.elm
        Symlink1.elm ⧙(symlink)⧘
        Symlink2.elm ⧙(symlink)⧘
        -> /Users/you/project/fixtures/precompilation-errors/duplicate-inputs-with-symlinks/Main.elm

        Other.elm
        Other.elm
        -> /Users/you/project/fixtures/precompilation-errors/duplicate-inputs-with-symlinks/Other.elm

        Make sure every input is listed just once!
        Note that at least one of the inputs seems to be a symlink. They can be tricky!

      `);
  });

  test("elm.json not found", async () => {
    expect(await validateFailHelper("elm-json-not-found", ["make"]))
      .toMatchInlineSnapshot(`
        main.js
        I could not find an ⧙elm.json⧘ for these inputs:

        Main.elm
        pages/About.elm

        Has it gone missing? Maybe run ⧙elm init⧘ to create one?

      `);
  });
});
