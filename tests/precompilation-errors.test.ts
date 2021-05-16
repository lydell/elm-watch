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
});
