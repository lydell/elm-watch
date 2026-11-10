// @vitest-environment jsdom
import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, test } from "vitest";

import { __ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS } from "../src/Env.ts";
import { grep, stringSnapshotSerializer, touch, waitFor } from "./Helpers.ts";
import {
  cleanupAfterEachTest,
  fixtureDir,
  nextWatcherEventHandled,
  runHotReload,
  waitForWatcherReady,
} from "./HotHelpers.ts";

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("hot reloading", () => {
  afterEach(cleanupAfterEachTest);

  test("Change Elm file while `elm make` is running", async () => {
    const fixture = "hot-reload";
    const lockFile = path.join(fixtureDir(fixture), "lock");

    fs.writeFileSync(lockFile, "Normal");

    const { inputPath, replace, go } = runHotReload({
      fixture,
      name: "InterruptElm",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
      bin: "delay",
    });

    const { terminal } = await go(async ({ idle, div }) => {
      switch (idle) {
        case 1: {
          assertInit(div);
          fs.writeFileSync(lockFile, "Delay");
          replace((content) => content.replace("1", "2"));
          await waitFor(() => fs.readFileSync(lockFile, "utf8") === "DelayAck");
          const changed = nextWatcherEventHandled(inputPath);
          replace((content) => content.replace("2", "3"));
          // Wait for the watcher to pick up the change before releasing the previous compilation.
          await changed;
          fs.writeFileSync(lockFile, "Normal");
          return "KeepGoing";
        }
        default:
          assertHotReload(div);
          return "Stop";
      }
    });

    expect(grep(terminal, /interrupted/)).toMatchInlineSnapshot(
      `⏳ InterruptElm: interrupted`,
    );

    function assertInit(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Text1</div>`);
    }

    function assertHotReload(div: HTMLDivElement): void {
      expect(div.outerHTML).toMatchInlineSnapshot(`<div>Text3</div>`);
    }
  });

  test("Restart while `elm make` is running", async () => {
    const fixture = "hot-reload";
    const lockFile = path.join(fixtureDir(fixture), "lock");
    const elmJsonPath = path.join(fixtureDir(fixture), "elm.json");

    fs.writeFileSync(lockFile, "Normal");

    const { replace, go } = runHotReload({
      fixture,
      name: "InterruptElm",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
      bin: "delay",
    });

    const { terminal } = await go(async ({ idle }) => {
      switch (idle) {
        case 1: {
          fs.writeFileSync(lockFile, "Delay");
          replace((content) => content.replace("1", "2"));
          await waitFor(() => fs.readFileSync(lockFile, "utf8") === "DelayAck");
          const changed = nextWatcherEventHandled(elmJsonPath);
          touch(elmJsonPath);
          // Wait for the watcher to pick up the change before releasing the previous compilation.
          await changed;
          fs.writeFileSync(lockFile, "Normal");
          return "KeepGoing";
        }
        default:
          return "Stop";
      }
    });

    expect(grep(terminal, /interrupted/)).toMatchInlineSnapshot(
      `⏳ InterruptElm: interrupted`,
    );
  });

  test("Restart while installing dependencies", async () => {
    const fixture = "hot-reload";
    const lockFile = path.join(fixtureDir(fixture), "lock");
    const elmJsonPath = path.join(fixtureDir(fixture), "elm.json");

    fs.writeFileSync(lockFile, "Delay");

    const { go } = runHotReload({
      fixture,
      name: "InterruptElm",
      programType: "Html",
      compilationMode: "standard",
      isTTY: false,
      bin: "delay",
    });

    const [{ terminal }] = await Promise.all([
      go(() => "Stop"),
      (async () => {
        await waitFor(() => fs.readFileSync(lockFile, "utf8") === "DelayAck");
        await waitForWatcherReady();
        const changed = nextWatcherEventHandled(elmJsonPath);
        touch(elmJsonPath);
        // Wait for the watcher to pick up the change before releasing the previous compilation.
        await changed;
        fs.writeFileSync(lockFile, "Normal");
      })(),
    ]);

    expect(terminal).toMatchInlineSnapshot(`
      🌐 http://localhost:59123
      ⏳ InterruptElm: elm make (typecheck only)
      ✅ InterruptElm⧙     1 ms Q | 765 ms T ¦  50 ms W⧘

      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙changed elm.json⧘
      ⏳ InterruptElm: elm make
      ✅ InterruptElm⧙     1 ms Q | 1.23 s E ¦  55 ms W |   9 ms I⧘

      ✅ ⧙13:10:05⧘ Compiled in ⧙123 ms⧘   ⧙web socket connected: InterruptElm⧘
    `);
  });
});
