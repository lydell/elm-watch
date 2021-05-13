import elmWatchCli from "../src";
import {
  FailReadStream,
  MemoryWriteStream,
  stringSnapshotSerializer,
} from "./helpers";

async function helpHelper(
  args: Array<string>,
  { expectError = false } = {}
): Promise<string> {
  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(args, {
    cwd: __dirname,
    env: {},
    stdin: new FailReadStream(),
    stdout,
    stderr,
  });

  if (expectError) {
    expect(stdout.content).toBe("");
    expect(exitCode).toBe(1);
    return stderr.content;
  } else {
    expect(stderr.content).toBe("");
    expect(exitCode).toBe(0);
    return stdout.content;
  }
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("help", () => {
  test("default", async () => {
    const output = await helpHelper(["help"]);

    expect(output).toMatchInlineSnapshot(`
      Usage: elm-watch [options] [command]

      Options:
        --debug           Turn on Elm’s debugger.
        --optimize        Turn on optimizations to make code smaller and faster.
        --output <file>   Specify the name of the resulting JS file.
        --version         Print version and exit
        -h, --help        Show help.

      Commands:
        make [files...]   Compile Elm code into JS.
        watch [files...]  Also recompile whenever your Elm files change.
        hot [files...]    Also reload the compiled JS in the browser.
        help [command]    Show help.

    `);

    expect(await helpHelper([], { expectError: true })).toBe(output);
    expect(await helpHelper(["-h"])).toBe(output);
    expect(await helpHelper(["--help"])).toBe(output);
    expect(await helpHelper(["whatever", "-h"])).toBe(output);
    expect(await helpHelper(["whatever", "--help"])).toBe(output);
    expect(await helpHelper(["-h", "whatever"])).toBe(output);
    expect(await helpHelper(["--help", "whatever"])).toBe(output);
  });
});
