import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { type AbsolutePath, markAsAbsolutePath } from "../src/Types.ts";
import {
  removeCoveredWatchDirs,
  watch,
  type WatchDir,
  type Watcher,
} from "../src/Watcher.ts";

const p = markAsAbsolutePath;

const POLL = { timeout: 3000, interval: 10 };

// A new `fs.watch` watcher can miss events that happen right after it is
// created (on macOS, FSEvents starts asynchronously). When a watched directory
// appears, elm-watch reacts to the event for the directory itself, which covers
// files created at the same time. In tests, wait a little before creating more
// files to avoid flakiness.
async function waitForWatcherStart(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
}

describe("removeCoveredWatchDirs", () => {
  const check = (watchDirs: Array<WatchDir>): Array<string> =>
    removeCoveredWatchDirs(watchDirs).map(({ tag, dir }) => `${tag}: ${dir}`);

  test("duplicates are removed", () => {
    expect(
      check([
        { tag: "Shallow", dir: p("/project") },
        { tag: "SourceDirectory", dir: p("/project/src") },
        { tag: "Shallow", dir: p("/project") },
        { tag: "SourceDirectory", dir: p("/project/src") },
      ]),
    ).toStrictEqual(["Shallow: /project", "SourceDirectory: /project/src"]);
  });

  test("nested source directories", () => {
    expect(
      check([
        { tag: "SourceDirectory", dir: p("/project/src/Sub") },
        { tag: "SourceDirectory", dir: p("/project/src") },
        { tag: "SourceDirectory", dir: p("/project/src/sub") },
        { tag: "SourceDirectory", dir: p("/project/srcfolder") },
      ]),
    ).toStrictEqual([
      "SourceDirectory: /project/src",
      // Not covered, since `sub` can’t be part of a module name.
      "SourceDirectory: /project/src/sub",
      "SourceDirectory: /project/srcfolder",
    ]);
  });

  test("shallow directories inside source directories", () => {
    expect(
      check([
        { tag: "SourceDirectory", dir: p("/project") },
        { tag: "Shallow", dir: p("/project") },
        { tag: "Shallow", dir: p("/project/Pages/Admin") },
        { tag: "Shallow", dir: p("/project/pages") },
        { tag: "Shallow", dir: p("/") },
      ]),
    ).toStrictEqual([
      "SourceDirectory: /project",
      "Shallow: /project/pages",
      "Shallow: /",
    ]);
  });

  test("static files directory", () => {
    expect(
      check([
        { tag: "SourceDirectory", dir: p("/project/src") },
        { tag: "SourceDirectory", dir: p("/project/public/Src") },
        { tag: "StaticFilesDir", dir: p("/project/public") },
        { tag: "StaticFilesDir", dir: p("/project/src/Public") },
      ]),
    ).toStrictEqual([
      "SourceDirectory: /project/src",
      // The source directory ignores more than the static files directory,
      // so it can’t cover it.
      "StaticFilesDir: /project/public",
      "StaticFilesDir: /project/src/Public",
    ]);
  });
});

describe("watch", () => {
  let dir = "";
  let watcher: Watcher | undefined = undefined;
  let events: Array<AbsolutePath> = [];
  const listeners = new Set<() => void>();

  beforeEach(() => {
    dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "elm-watch-watcher-test-")),
    );
    events = [];
  });

  afterEach(() => {
    watcher?.close();
    watcher = undefined;
    listeners.clear();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const d = (...parts: Array<string>): string => path.join(dir, ...parts);

  const start = async (watchDirs: Array<WatchDir>): Promise<void> => {
    watcher = watch(
      watchDirs,
      (event) => {
        events.push(event);
        for (const listener of listeners) {
          listener();
        }
      },
      (error) => {
        throw error;
      },
    );
    await waitForWatcherStart();
  };

  // Use like this: `await expect.poll(eventLines, POLL).toContain("a.txt")`
  const eventLines = (): Array<string> =>
    events.map((absolutePath) => path.relative(dir, absolutePath));

  const printEvents = (): string => eventLines().join("\n");

  const sourceDirectory = (...parts: Array<string>): WatchDir => ({
    tag: "SourceDirectory",
    dir: p(d(...parts)),
  });

  test("files in source directories", async () => {
    fs.mkdirSync(d("src", "Foo"), { recursive: true });
    fs.writeFileSync(d("src", "Main.elm"), "");
    await start([sourceDirectory("src")]);

    fs.writeFileSync(d("src", "Foo", "Bar.elm"), "");
    await expect.poll(eventLines, POLL).toContain("src/Foo/Bar.elm");

    fs.writeFileSync(d("src", "Main.elm"), "changed");
    await expect.poll(eventLines, POLL).toContain("src/Main.elm");

    fs.unlinkSync(d("src", "Foo", "Bar.elm"));
    await expect.poll(eventLines, POLL).toContain("src/Foo/Bar.elm");
  });

  test("directories that can’t be part of module names are ignored", async () => {
    fs.mkdirSync(d("src", "node_modules"), { recursive: true });
    fs.mkdirSync(d("src", ".git"));
    fs.mkdirSync(d("src", "Valid"));
    await start([sourceDirectory("src")]);

    fs.writeFileSync(d("src", "node_modules", "x.js"), "");
    fs.writeFileSync(d("src", ".git", "HEAD"), "");
    fs.writeFileSync(d("src", "Valid", "Module.elm"), "");
    await expect.poll(eventLines, POLL).toContain("src/Valid/Module.elm");

    // The directories themselves might be reported (we can’t tell files and
    // directories apart by name), but not anything inside them.
    expect(printEvents()).not.toMatch(/(?:node_modules|\.git)\//);
  });

  test("elm-stuff removal is reported via shallow watch", async () => {
    fs.mkdirSync(d("elm-stuff", "0.19.1"), { recursive: true });
    await start([{ tag: "Shallow", dir: p(dir) }]);

    // Not reported: Not a direct child.
    fs.writeFileSync(d("elm-stuff", "0.19.1", "i.dat"), "");
    fs.rmSync(d("elm-stuff"), { recursive: true });
    await expect.poll(eventLines, POLL).toContain("elm-stuff");

    expect(printEvents()).not.toMatch(/i\.dat/);
  });

  test("moving a directory into a source directory", async () => {
    fs.mkdirSync(d("src"));
    fs.mkdirSync(d("outside", "Dir"), { recursive: true });
    fs.writeFileSync(d("outside", "Dir", "Module.elm"), "");
    await start([sourceDirectory("src")]);

    fs.renameSync(d("outside", "Dir"), d("src", "Dir"));
    await expect.poll(eventLines, POLL).toContain("src/Dir");

    fs.renameSync(d("src", "Dir"), d("outside", "Dir"));
    await expect.poll(eventLines, POLL).toContain("src/Dir");
  });

  test("source directory that does not exist yet", async () => {
    await start([sourceDirectory("missing", "deep")]);

    fs.mkdirSync(d("missing", "deep"), { recursive: true });
    await expect.poll(eventLines, POLL).toContain("missing/deep");
    await waitForWatcherStart();

    fs.writeFileSync(d("missing", "deep", "Main.elm"), "");
    await expect.poll(eventLines, POLL).toContain("missing/deep/Main.elm");
  });

  test("source directory that is removed and recreated", async () => {
    fs.mkdirSync(d("src"));
    await start([sourceDirectory("src")]);

    const countSrcEvents = (): number =>
      eventLines().filter((line) => line === "src").length;

    fs.rmSync(d("src"), { recursive: true });
    await expect.poll(countSrcEvents, POLL).toBeGreaterThan(0);
    // No bogus paths for the root itself (like `src/src`).
    expect(new Set(eventLines())).toStrictEqual(new Set(["src"]));

    const countBefore = countSrcEvents();
    fs.mkdirSync(d("src"));
    await expect.poll(countSrcEvents, POLL).toBeGreaterThan(countBefore);
    await waitForWatcherStart();

    fs.writeFileSync(d("src", "Main.elm"), "");
    await expect.poll(eventLines, POLL).toContain("src/Main.elm");
  });
});
