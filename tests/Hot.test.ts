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

const CONTAINER_ID = "elm-watch";
const FIXTURES_DIR = path.join(__dirname, "fixtures");

async function run({
  fixture,
  scripts,
  args = [],
  init,
  onIdle,
  expandUi = false,
  isTTY = true,
  bin,
}: {
  fixture: string;
  scripts: Array<string>;
  args?: Array<string>;
  init: () => void;
  onIdle: OnIdle;
  expandUi?: boolean;
  isTTY?: boolean;
  bin?: string;
}): Promise<{ terminal: string; browser: string; renders: string }> {
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

  const renders: Array<string> = [];

  await new Promise((resolve, reject) => {
    const loadBuiltFiles = (isReload: boolean): void => {
      delete window.Elm;
      Promise.all(
        absoluteScripts.map((script) => {
          // Copying the script does a couple of things:
          // - Avoiding require/import cache.
          // - Makes it easier to debug the tests since one can see all the outputs through time.
          // - Lets us make a few replacements for Jest.
          const newScript = script.replace(/\.(\w+)$/, `.${idle}.$1`);
          const content = fs
            .readFileSync(script, "utf8")
            .replace(/\(this\)\);\s*$/, "(window));")
            .replace(/^\s*console.warn\('[^']+'\);/m, "");
          fs.writeFileSync(newScript, content);
          return import(newScript);
        })
      ).then(() => {
        if (expandUi) {
          document
            .getElementById(CONTAINER_ID)
            ?.shadowRoot?.querySelector("button")
            ?.click();
        }
        if (isReload) {
          init();
        }
      }, reject);
    };

    let i = 0;
    let i2 = 0;
    let idle = 0;

    window.__ELM_WATCH_GET_NOW = () => new Date(i2++);
    window.__ELM_WATCH_RELOAD_PAGE = () => {
      loadBuiltFiles(true);
    };
    window.__ELM_WATCH_ON_RENDER = () => {
      const element =
        document.getElementById(CONTAINER_ID)?.shadowRoot?.lastElementChild;

      const text =
        element instanceof Node
          ? Array.from(element.childNodes, getTextContent).join(
              `\n${"-".repeat(80)}\n`
            )
          : `#${CONTAINER_ID} not found in:\n${document.documentElement.outerHTML}`;

      renders.push(text);
    };

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
            loadBuiltFiles(false);
            return "KeepGoing";
          case 2:
            return "KeepGoing";
          default: {
            return onIdle();
          }
        }
      },
    }).then(resolve, reject);
  });

  const stderrString = clean(stderr.getOutput());

  expect(stdout.content).toBe("");

  const lastText = renders[renders.length - 1] ?? "No renders!";

  return {
    terminal: stderrString,
    browser: lastText,
    renders: renders.join(`\n${"=".repeat(80)}\n`),
  };
}

function getTextContent(element: Node): string {
  return Array.from(walkTextNodes(element), (node) => node.data)
    .join("")
    .trim()
    .replace(/\n /g, "\n");
}

function* walkTextNodes(element: Node): Generator<Text, void, void> {
  if (shouldAddNewline(element)) {
    yield document.createTextNode("\n");
  }
  for (const node of element.childNodes) {
    if (node instanceof Text) {
      yield document.createTextNode(" ");
      yield node;
    } else if (node instanceof HTMLInputElement && node.type === "radio") {
      yield document.createTextNode(
        (node.checked ? "◉" : "◯") + (node.disabled ? " (disabled)" : "")
      );
    } else {
      yield* walkTextNodes(node);
    }
  }
}

function shouldAddNewline(node: Node): boolean {
  switch (node.nodeName) {
    case "DIV":
    case "DT":
    case "LEGEND":
    case "LABEL":
    case "P":
    case "PRE":
      return true;
    default:
      return false;
  }
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

test("hot", async () => {
  const { terminal, browser, renders } = await run({
    fixture: "hot",
    scripts: ["main.js"],
    init: () => {
      const div = document.createElement("div");
      document.body.append(div);
      window.Elm?.Main?.init({ node: div });
    },
    onIdle: () => "Stop",
  });

  expect(terminal).toMatchInlineSnapshot(`
    ✅ Main⧙                                  0 ms Q |   2 ms E ¦   1 ms W |   1 ms I⧘

    📊 ⧙web socket connections:⧘ 1 ⧙(ws://0.0.0.0:59123)⧘

    ⧙ℹ️ 00:00:00 Web socket connected for: Main⧘
    ✅ ⧙00:00:00⧘ Everything up to date.
  `);

  expect(browser).toMatchInlineSnapshot(`▼ ✅ 00:00:00 Main`);

  expect(renders).toMatchInlineSnapshot(`
    ▼ 🔌 00:00:00 Main
    ================================================================================
    ▼ ⏳ 00:00:00 Main
    ================================================================================
    ▼ ⏳ 00:00:00 Main
    ================================================================================
    ▼ 🔌 00:00:00 Main
    ================================================================================
    ▼ ⏳ 00:00:00 Main
    ================================================================================
    ▼ ✅ 00:00:00 Main
  `);

  expect(document.body.outerHTML).toMatchInlineSnapshot(
    `<body>Hello, World!</body>`
  );
});