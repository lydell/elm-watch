import { describe, expect, test } from "vitest";

import elmWatchCli from "../src/ElmWatch.ts";
import { type Env, NO_COLOR } from "../src/Env.ts";
import {
  assertExitCode,
  clean,
  CursorWriteStream,
  logDebug,
  MemoryWriteStream,
  SilentReadStream,
  stringSnapshotSerializer,
  TEST_ENV,
} from "./Helpers.ts";

async function helpHelper(
  args: Array<string>,
  env: Env = process.env,
): Promise<string> {
  const stdout = new CursorWriteStream();
  const stderr = new MemoryWriteStream();

  const exitCode = await elmWatchCli(args, {
    cwd: import.meta.dirname,
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

  assertExitCode(
    0,
    exitCode,
    stdoutString,
    stderr.content,
    import.meta.dirname,
  );
  expect(stderr.content).toBe("");

  return stdoutString;
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("help", () => {
  test("default", async () => {
    const output = await helpHelper(["help"]);

    expect(output).toMatchInlineSnapshot(`
      ⧙elm-watch init [--javascript|--typescript]⧘
          Create a minimal ⧙elm-watch.json⧘ in the current directory.
          With ⧙--javascript⧘ or ⧙--typescript⧘: Create elm-watch.mjs
          or elm-watch.mts instead, for using the JavaScript API. If you
          already have an ⧙elm-watch.json⧘, it is migrated to the new file.
          https://lydell.github.io/elm-watch/javascript-api/

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
          🌐 server

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

          ⧙ELM_WATCH_HOST⧘
              Defaults to 127.0.0.1 (only your computer)
              Set it to 0.0.0.0 to expose on the local network

          ⧙ELM_WATCH_WEBSOCKET_URL⧘
              Override "webSocketUrl" in ⧙elm-watch.json⧘ dynamically

          ⧙ELM_WATCH_ALLOWED_HOSTS⧘
              Comma-separated hosts to allow in addition to "allowedHosts"

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
        elm-watch init [--javascript|--typescript]
            Create a minimal elm-watch.json in the current directory.
            With --javascript or --typescript: Create elm-watch.mjs
            or elm-watch.mts instead, for using the JavaScript API. If you
            already have an elm-watch.json, it is migrated to the new file.
            https://lydell.github.io/elm-watch/javascript-api/

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

            ELM_WATCH_HOST
                Defaults to 127.0.0.1 (only your computer)
                Set it to 0.0.0.0 to expose on the local network

            ELM_WATCH_WEBSOCKET_URL
                Override "webSocketUrl" in elm-watch.json dynamically

            ELM_WATCH_ALLOWED_HOSTS
                Comma-separated hosts to allow in addition to "allowedHosts"

        Documentation:
            https://lydell.github.io/elm-watch/

        Version:
            %VERSION%
      `);
  });
});
