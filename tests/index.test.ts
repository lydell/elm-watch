import elmWatchCli from "../src";
import {
  FailReadStream,
  MemoryWriteStream,
  stringSnapshotSerializer,
} from "./helpers";

async function indexHelper(args: Array<string>): Promise<string> {
  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(args, {
    cwd: __dirname,
    env: {},
    stdin: new FailReadStream(),
    stdout,
    stderr,
  });

  expect(stdout.content).toBe("");
  expect(exitCode).toBe(1);

  return stderr.content;
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("index", () => {
  test("unknown command", async () => {
    expect(await indexHelper(["nope"])).toMatchInlineSnapshot(`
      error: unknown command 'nope'. See 'elm-watch --help'.

    `);
  });
});
