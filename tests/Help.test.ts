import { elmWatchCli } from "../src";
import { Env, NO_COLOR } from "../src/Env";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  FailReadStream,
  logDebug,
  MemoryWriteStream,
  stringSnapshotSerializer,
  TEST_ENV,
} from "./Helpers";

async function helpHelper(
  args: Array<string>,
  env: Env = process.env
): Promise<string> {
  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(args, {
    cwd: __dirname,
    env: {
      ...TEST_ENV,
      ...env,
    },
    stdin: new FailReadStream(),
    stdout,
    stderr,
    logDebug,
  });

  const stdoutString = clean(stdout.getOutput());

  assertExitCode(0, exitCode, stdoutString, stderr.content);
  expect(stderr.content).toBe("");

  return stdoutString;
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("help", () => {
  test("default", async () => {
    const output = await helpHelper(["help"]);

    expect(output).toMatchInlineSnapshot(`
      ⧙elm-watch init⧘
          Create a minimal ⧙elm-watch.json⧘ in the current directory

      ⧙elm-watch make [--debug|--optimize] [targets...]⧘
          Compile Elm code into JS

      ⧙elm-watch hot [targets...]⧘
          Recompile whenever your Elm files change,
          and reload the compiled JS in the browser

      All commands read their inputs and outputs from the closest ⧙elm-watch.json⧘.
      By default they build all targets. Pass target names to only build some.
      Targets are matched by substring!

      ⧙---⧘

      ⧙Symbol legend:⧘

          ⚪️ queued for elm make
          🟢 elm make done – queued for postprocess
          ⏳ elm make or postprocess
          🚨 error
          ⛔️ skipped
          ✅ success
          ℹ️ info
          📊 stats

      ⧙Durations legend:⧘

          ⧙Q⧘ queued for elm make
          ⧙E⧘ elm make
          ⧙T⧘ elm make (typecheck only)
          ⧙W⧘ find all related Elm file paths
          ⧙I⧘ inject hot reloading code
          ⧙R⧘ queued for postprocess
          ⧙P⧘ postprocess
          ⧙¦⧘ next is run in parallel

      ⧙---⧘

      ⧙Environment variables:⧘
          ⧙NO_COLOR⧘
              Disable colored output

      ⧙Documentation:⧘
          https://github.com/lydell/elm-watch#readme

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
    expect(await helpHelper(["help"], { [NO_COLOR]: "" }))
      .toMatchInlineSnapshot(`
      elm-watch init
          Create a minimal elm-watch.json in the current directory

      elm-watch make [--debug|--optimize] [targets...]
          Compile Elm code into JS

      elm-watch hot [targets...]
          Recompile whenever your Elm files change,
          and reload the compiled JS in the browser

      All commands read their inputs and outputs from the closest elm-watch.json.
      By default they build all targets. Pass target names to only build some.
      Targets are matched by substring!

      ---

      Durations legend:

          Q queued for elm make
          E elm make
          T elm make (typecheck only)
          W find all related Elm file paths
          I inject hot reloading code
          R queued for postprocess
          P postprocess
          / next is run in parallel

      ---

      Environment variables:
          NO_COLOR
              Disable colored output

      Documentation:
          https://github.com/lydell/elm-watch#readme

      Version:
          %VERSION%
    `);
  });
});
