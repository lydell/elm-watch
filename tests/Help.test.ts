import { elmWatchCli } from "../src";
import type { Env } from "../src/Helpers";
import {
  assertExitCode,
  clean,
  FailReadStream,
  MemoryWriteStream,
  stringSnapshotSerializer,
} from "./Helpers";

async function helpHelper(
  args: Array<string>,
  env: Env = process.env
): Promise<string> {
  const stdout = new MemoryWriteStream();
  const stderr = new MemoryWriteStream();

  let i = 0;

  const exitCode = await elmWatchCli(args, {
    cwd: __dirname,
    env,
    stdin: new FailReadStream(),
    stdout,
    stderr,
    getNow: () => new Date(i++),
    onIdle: undefined,
  });

  assertExitCode(0, exitCode, stdout.content, stderr.content);
  expect(stderr.content).toBe("");

  return clean(stdout.content);
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("help", () => {
  test("default", async () => {
    const output = await helpHelper(["help"]);

    expect(output).toMatchInlineSnapshot(`
      ⧙elm-watch make [--debug|--optimize] [targets...]⧘
          Compile Elm code into JS

      ⧙elm-watch hot [targets...]⧘
          Recompile whenever your Elm files change,
          and reload the compiled JS in the browser

      All commands read their inputs and outputs from the closest ⧙elm-watch.json⧘.
      By default they build all targets. Pass target names to only build some.
      Targets are matched by substring!

      ⧙---⧘

      ⧙Environment variables:⧘
          ⧙NO_COLOR⧘
              Disable colored output

      ⧙Documentation:⧘
          https://github.com/lydell/elm-watch/#readme

      ⧙Version:⧘
          %VERSION%

    `);

    expect(await helpHelper([])).toBe(output);
    expect(await helpHelper(["-h"])).toBe(output);
    expect(await helpHelper(["-help"])).toBe(output);
    expect(await helpHelper(["--help"])).toBe(output);
    expect(await helpHelper(["whatever", "-h"])).toBe(output);
    expect(await helpHelper(["whatever", "-help"])).toBe(output);
    expect(await helpHelper(["whatever", "--help"])).toBe(output);
    expect(await helpHelper(["-h", "whatever"])).toBe(output);
    expect(await helpHelper(["-help", "whatever"])).toBe(output);
    expect(await helpHelper(["--help", "whatever"])).toBe(output);
  });

  test("NO_COLOR", async () => {
    expect(await helpHelper(["help"], { NO_COLOR: "" })).toMatchInlineSnapshot(`
      elm-watch make [--debug|--optimize] [targets...]
          Compile Elm code into JS

      elm-watch hot [targets...]
          Recompile whenever your Elm files change,
          and reload the compiled JS in the browser

      All commands read their inputs and outputs from the closest elm-watch.json.
      By default they build all targets. Pass target names to only build some.
      Targets are matched by substring!

      ---

      Environment variables:
          NO_COLOR
              Disable colored output

      Documentation:
          https://github.com/lydell/elm-watch/#readme

      Version:
          %VERSION%

    `);
  });
});
