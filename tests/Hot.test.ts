/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";

import { elmWatchCli } from "../src";
import { OnIdle } from "../src/Types";
import {
  clean,
  CursorWriteStream,
  FailReadStream,
  MemoryWriteStream,
  prependPATH,
  stringSnapshotSerializer,
} from "./Helpers";

const FIXTURES_DIR = path.join(__dirname, "fixtures");

async function run({
  fixture,
  scripts,
  args = [],
  onIdle,
  isTTY = true,
  bin,
}: {
  fixture: string;
  scripts: Array<string>;
  args?: Array<string>;
  onIdle: OnIdle;
  isTTY?: boolean;
  bin?: string;
}): Promise<{ terminal: string; browser: string }> {
  const dir = path.join(FIXTURES_DIR, fixture);
  const build = path.join(dir, "build");
  const absoluteScripts = scripts.map((script) => path.join(build, script));

  if (fs.rmSync !== undefined) {
    fs.rmSync(build, { recursive: true, force: true });
  } else if (fs.existsSync(build)) {
    fs.rmdirSync(build, { recursive: true });
  }

  const stdout = new MemoryWriteStream();
  const stderr = new CursorWriteStream();

  stdout.isTTY = isTTY;
  stderr.isTTY = isTTY;

  let i = 0;
  let idle = 0;

  await new Promise((resolve, reject) => {
    const loadBuiltFiles = (): void => {
      delete (window as unknown as { Elm: unknown }).Elm;
      jest.resetModules();
      Promise.all(absoluteScripts.map((script) => import(script))).catch(
        reject
      );
    };

    let i2 = 0;
    window.__ELM_WATCH_GET_NOW = () => new Date((i2 += 2000));
    window.__ELM_WATCH_RELOAD_PAGE = loadBuiltFiles;

    elmWatchCli(["hot", ...args], {
      cwd: dir,
      env: {
        ...process.env,
        __ELM_WATCH_LOADING_MESSAGE_DELAY: "0",
        ELM_WATCH_MAX_PARALLEL: "2",
        PATH:
          bin === undefined
            ? process.env.PATH
            : prependPATH(path.join(dir, bin)),
      },
      stdin: new FailReadStream(),
      stdout,
      stderr,
      getNow: () => new Date(i++),
      onIdle: () => {
        idle++;
        switch (idle) {
          case 1:
            loadBuiltFiles();
            return "KeepGoing";
          case 2:
            return "KeepGoing";
          default:
            return onIdle();
        }
      },
    }).then(resolve, reject);
  });

  const stderrString = clean(stderr.getOutput());

  expect(stdout.content).toBe("");

  const text =
    document.querySelector("#elm-watch")?.shadowRoot?.lastElementChild
      ?.textContent ??
    `#elm-watch not found in:\n${document.documentElement.outerHTML}`;

  return { terminal: stderrString, browser: text };
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

test("hot", async () => {
  const { terminal, browser } = await run({
    fixture: "hot",
    scripts: ["main.js"],
    onIdle: () => "Stop",
  });

  expect(terminal).toMatchInlineSnapshot(`
    ✅ Main⧙                                  0 ms Q |   2 ms E ¦   1 ms W |   1 ms I⧘

    📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

    ⧙ℹ️ 00:00:00 Web socket connected needing compilation of: Main⧘
    ✅ ⧙00:00:00⧘ Compilation finished in ⧙6⧘ ms.
  `);

  expect(browser).toMatchInlineSnapshot(`▼❌00:00:16Main`);
});
