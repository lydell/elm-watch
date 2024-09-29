import { elmWatchCli } from "../src";
import { Env, NO_COLOR } from "../src/Env";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  logDebug,
  MemoryWriteStream,
  SilentReadStream,
  stringSnapshotSerializer,
  TEST_ENV,
} from "./Helpers";

async function helpHelper(
  args: Array<string>,
  env: Env = process.env,
): Promise<string> {
  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(args, {
    cwd: __dirname,
    env: {
      ...TEST_ENV,
      ...env,
    },
    stdin: new SilentReadStream(),
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
          Create a minimal ⧙elm-watch.json⧘ in the current directory.

      ⧙elm-watch make [--debug|--optimize] [target names...]⧘
          Compile Elm code into JS. Similar to ⧙elm make⧘.

      ⧙elm-watch hot [target names...]⧘
          Recompile whenever your Elm files change,
          and reload the compiled JS in the browser.
          You can switch to ⧙--debug⧘ and ⧙--optimize⧘
          mode in the browser.

      By default all targets in the closest ⧙elm-watch.json⧘ are built.
      Pass ⧙target names⧘ to only build some. Names are matched by substring!

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

          ⧙ELM_WATCH_OPEN_EDITOR⧘
              Open your editor when clicking error locations in the browser
              https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations

          ⧙ELM_WATCH_EXIT_ON_STDIN_END⧘
              Exit elm-watch when stdin ends

      ⧙Documentation:⧘
          https://lydell.github.io/elm-watch/

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
          Create a minimal elm-watch.json in the current directory.

      elm-watch make [--debug|--optimize] [target names...]
          Compile Elm code into JS. Similar to elm make.

      elm-watch hot [target names...]
          Recompile whenever your Elm files change,
          and reload the compiled JS in the browser.
          You can switch to --debug and --optimize
          mode in the browser.

      By default all targets in the closest elm-watch.json are built.
      Pass target names to only build some. Names are matched by substring!

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

          ELM_WATCH_OPEN_EDITOR
              Open your editor when clicking error locations in the browser
              https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations

          ELM_WATCH_EXIT_ON_STDIN_END
              Exit elm-watch when stdin ends

      Documentation:
          https://lydell.github.io/elm-watch/

      Version:
          %VERSION%
    `);
  });
});
