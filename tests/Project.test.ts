import * as path from "path";
import { describe, expect, test } from "vitest";

import * as ElmWatchJson from "../src/ElmWatchJson.ts";
import { DEFAULT_HOST } from "../src/Host.ts";
import {
  initProject,
  OutputState,
  type Project,
  projectToDebug,
} from "../src/Project.ts";
import {
  type GetNow,
  markAsAbsolutePath,
  markAsCwd,
  markAsElmJsonPath,
  markAsElmWatchJsonPath,
  markAsElmWatchStuffDir,
  markAsElmWatchStuffJsonPath,
  markAsStaticFilesDir,
  markAsTargetName,
} from "../src/Types.ts";
import { removeCoveredWatchDirs } from "../src/Watcher.ts";
import { stringSnapshotSerializer } from "./Helpers.ts";

const getNow: GetNow = () => new Date();

const project: Project = {
  watchDirs: [
    {
      tag: "SourceDirectory",
      dir: markAsAbsolutePath("/Users/you/project/src"),
    },
    { tag: "Shallow", dir: markAsAbsolutePath("/Users/you/project") },
  ],
  missingSourceDirectories: new Set(),
  root: markAsAbsolutePath("/Users/you/project"),
  staticFilesDir: markAsStaticFilesDir(
    markAsAbsolutePath("/Users/you/project/public"),
  ),
  webSocketUrl: {
    tag: "UrlFromConfig",
    url: new URL("ws://localhost:1234"),
    source: "elm-watch.json",
  },
  allowedHosts: [],
  configSource: {
    tag: "ElmWatchJson",
    elmWatchJsonPath: markAsElmWatchJsonPath(
      markAsAbsolutePath("/Users/you/project/elm-watch.json"),
    ),
    cwd: markAsCwd(markAsAbsolutePath("/Users/you/project")),
  },
  elmWatchStuffJsonPath: markAsElmWatchStuffJsonPath(
    markAsAbsolutePath("/Users/you/project/elm-stuff/elm-watch/stuff.json"),
  ),
  maxParallel: 12,
  host: DEFAULT_HOST,
  openEditor: { tag: "NotSet" },
  disabledOutputs: [
    {
      originalString: "public/build/HtmlMain.js",
      tag: "OutputPath",
      targetName: markAsTargetName("Html"),
      theOutputPath: markAsAbsolutePath(
        "/Users/you/project/public/build/HtmlMain.js",
      ),
      temporaryOutputPath: markAsAbsolutePath(
        "/Users/you/project/elm-stuff/elm-watch/1.js",
      ),
    },
    {
      originalString: "public/submodules/azimutt/public/dist/elm.js",
      tag: "OutputPath",
      targetName: markAsTargetName("Azimutt"),
      theOutputPath: markAsAbsolutePath(
        "/Users/you/project/public/submodules/azimutt/public/dist/elm.js",
      ),
      temporaryOutputPath: markAsAbsolutePath(
        "/Users/you/project/elm-stuff/elm-watch/2.js",
      ),
    },
  ],
  targetsErrors: [
    {
      outputPath: {
        tag: "OutputPath",
        theOutputPath: markAsAbsolutePath(
          "/Users/you/project/public/build/SandboxMain.js",
        ),
        temporaryOutputPath: markAsAbsolutePath(
          "/Users/you/project/elm-stuff/elm-watch/3.js",
        ),
        originalString: "public/build/SandboxMain.js",
        targetName: markAsTargetName("Sandbox"),
      },
      elmJsonPath: markAsElmJsonPath(
        markAsAbsolutePath("/Users/you/project/elm.json"),
      ),
      compilationMode: "standard",
      browserUiPosition: "BottomLeft",
      openErrorOverlay: false,
      error: {
        tag: "InputsNotFound",
        inputsNotFound: [
          {
            tag: "UncheckedInputPath",
            theUncheckedInputPath: markAsAbsolutePath(
              "/Users/you/project/src/BandboxMain.elm",
            ),
            originalString: "src/BandboxMain.elm",
          },
        ],
      },
    },
  ],
  elmJsons: new Map([
    [
      markAsElmJsonPath(markAsAbsolutePath("/Users/you/project/elm.json")),
      [
        [
          {
            originalString: "public/build/ElementMain.js",
            tag: "OutputPath",
            targetName: markAsTargetName("Element"),
            theOutputPath: markAsAbsolutePath(
              "/Users/you/project/public/build/ElementMain.js",
            ),
            temporaryOutputPath: markAsAbsolutePath(
              "/Users/you/project/elm-stuff/elm-watch/4.js",
            ),
          },
          new OutputState(
            [
              {
                tag: "InputPath",
                theInputPath: markAsAbsolutePath(
                  "/Users/you/project/src/ElementMain.elm",
                ),
                originalString: "src/ElementMain.elm",
                realpath: markAsAbsolutePath(
                  "/Users/you/project/src/ElementMain.elm",
                ),
              },
            ],
            { tag: "NoPostprocess" },
            "optimize",
            "BottomLeft",
            false,
            getNow,
          ),
        ],
        [
          {
            originalString: "public/build/Frankenstein.js",
            tag: "OutputPath",
            targetName: markAsTargetName("Frankenstein"),
            theOutputPath: markAsAbsolutePath(
              "/Users/you/project/public/build/Frankenstein.js",
            ),
            temporaryOutputPath: markAsAbsolutePath(
              "/Users/you/project/elm-stuff/elm-watch/5.js",
            ),
          },
          new OutputState(
            [
              {
                tag: "InputPath",
                theInputPath: markAsAbsolutePath(
                  "/Users/you/project/src/ApplicationMain.elm",
                ),
                originalString: "src/ApplicationMain.elm",
                realpath: markAsAbsolutePath(
                  "/Users/you/project/src/ApplicationMain.elm",
                ),
              },
              {
                tag: "InputPath",
                theInputPath: markAsAbsolutePath(
                  "/Users/you/project/src/DocumentMain.elm",
                ),
                originalString: "src/DocumentMain.elm",
                realpath: markAsAbsolutePath(
                  "/Users/you/project/src/DocumentMain.elm",
                ),
              },
            ],
            { tag: "NoPostprocess" },
            "standard",
            "BottomLeft",
            false,
            getNow,
          ),
        ],
      ],
    ],
    [
      markAsElmJsonPath(
        markAsAbsolutePath(
          "/Users/you/project/public/submodules/concourse/web/elm/elm.json",
        ),
      ),
      [
        [
          {
            originalString: "public/submodules/concourse/web/public/elm.min.js",
            tag: "OutputPath",
            targetName: markAsTargetName("Concourse"),
            theOutputPath: markAsAbsolutePath(
              "/Users/you/project/public/submodules/concourse/web/public/elm.min.js",
            ),
            temporaryOutputPath: markAsAbsolutePath(
              "/Users/you/project/elm-stuff/elm-watch/6.js",
            ),
          },
          new OutputState(
            [
              {
                tag: "InputPath",
                theInputPath: markAsAbsolutePath(
                  "/Users/you/project/public/submodules/concourse/web/elm/src/Main.elm",
                ),
                originalString: "src/ElementMain.elm",
                realpath: markAsAbsolutePath(
                  "/Users/you/project/public/submodules/concourse/web/elm/src/Main.elm",
                ),
              },
            ],
            { tag: "NoPostprocess" },
            "optimize",
            "BottomLeft",
            false,
            getNow,
          ),
        ],
      ],
    ],
  ]),
};

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("Project", () => {
  test("projectToDebug", () => {
    expect(JSON.stringify(projectToDebug(project), null, 2))
      .toMatchInlineSnapshot(`
        {
          "watchDirs": [
            {
              "tag": "SourceDirectory",
              "dir": "/Users/you/project/src"
            },
            {
              "tag": "Shallow",
              "dir": "/Users/you/project"
            }
          ],
          "staticFilesDir": "/Users/you/project/public",
          "webSocketUrl": {
            "tag": "UrlFromConfig",
            "url": "ws://localhost:1234/",
            "source": "elm-watch.json"
          },
          "allowedHosts": [],
          "elmWatchJson": "/Users/you/project/elm-watch.json",
          "elmWatchStuffJson": "/Users/you/project/elm-stuff/elm-watch/stuff.json",
          "maxParallel": 12,
          "enabledTargets": [
            {
              "targetName": "Element",
              "output": "/Users/you/project/public/build/ElementMain.js",
              "temporaryOutput": "/Users/you/project/elm-stuff/elm-watch/4.js",
              "originalString": "public/build/ElementMain.js",
              "compilationMode": "optimize",
              "postprocess": false,
              "elmJson": "/Users/you/project/elm.json",
              "inputs": [
                {
                  "input": "/Users/you/project/src/ElementMain.elm",
                  "realpath": "/Users/you/project/src/ElementMain.elm",
                  "originalString": "src/ElementMain.elm"
                }
              ]
            },
            {
              "targetName": "Frankenstein",
              "output": "/Users/you/project/public/build/Frankenstein.js",
              "temporaryOutput": "/Users/you/project/elm-stuff/elm-watch/5.js",
              "originalString": "public/build/Frankenstein.js",
              "compilationMode": "standard",
              "postprocess": false,
              "elmJson": "/Users/you/project/elm.json",
              "inputs": [
                {
                  "input": "/Users/you/project/src/ApplicationMain.elm",
                  "realpath": "/Users/you/project/src/ApplicationMain.elm",
                  "originalString": "src/ApplicationMain.elm"
                },
                {
                  "input": "/Users/you/project/src/DocumentMain.elm",
                  "realpath": "/Users/you/project/src/DocumentMain.elm",
                  "originalString": "src/DocumentMain.elm"
                }
              ]
            },
            {
              "targetName": "Concourse",
              "output": "/Users/you/project/public/submodules/concourse/web/public/elm.min.js",
              "temporaryOutput": "/Users/you/project/elm-stuff/elm-watch/6.js",
              "originalString": "public/submodules/concourse/web/public/elm.min.js",
              "compilationMode": "optimize",
              "postprocess": false,
              "elmJson": "/Users/you/project/public/submodules/concourse/web/elm/elm.json",
              "inputs": [
                {
                  "input": "/Users/you/project/public/submodules/concourse/web/elm/src/Main.elm",
                  "realpath": "/Users/you/project/public/submodules/concourse/web/elm/src/Main.elm",
                  "originalString": "src/ElementMain.elm"
                }
              ]
            }
          ],
          "disabledTargets": [
            {
              "targetName": "Html",
              "output": "/Users/you/project/public/build/HtmlMain.js",
              "temporaryOutput": "/Users/you/project/elm-stuff/elm-watch/1.js",
              "originalString": "public/build/HtmlMain.js"
            },
            {
              "targetName": "Azimutt",
              "output": "/Users/you/project/public/submodules/azimutt/public/dist/elm.js",
              "temporaryOutput": "/Users/you/project/elm-stuff/elm-watch/2.js",
              "originalString": "public/submodules/azimutt/public/dist/elm.js"
            }
          ],
          "erroredTargets": [
            {
              "error": "InputsNotFound",
              "targetName": "Sandbox",
              "output": "/Users/you/project/public/build/SandboxMain.js",
              "temporaryOutput": "/Users/you/project/elm-stuff/elm-watch/3.js",
              "originalString": "public/build/SandboxMain.js",
              "compilationMode": "standard"
            }
          ]
        }
      `);
  });

  describe("watchDirs", () => {
    const repoRoot = path.dirname(import.meta.dirname);

    // Only reads from the fixtures, so no copies are needed.
    function printWatchDirs(fixture: string): string {
      const cwd = markAsCwd(
        markAsAbsolutePath(path.join(import.meta.dirname, "fixtures", fixture)),
      );
      const parseResult = ElmWatchJson.findReadAndParse(cwd);
      if (parseResult.tag !== "Parsed") {
        throw new Error(`Failed to parse elm-watch.json: ${parseResult.tag}`);
      }
      const result = initProject({
        env: {},
        getNow,
        compilationMode: "standard",
        config: parseResult.value,
        enabledTargetsSubstrings: [""],
        elmWatchStuffDir: markAsElmWatchStuffDir(
          markAsAbsolutePath("/elm-stuff/elm-watch"),
        ),
        elmWatchStuffJsonPath: markAsElmWatchStuffJsonPath(
          markAsAbsolutePath("/elm-stuff/elm-watch/stuff.json"),
        ),
        elmWatchStuffJson: undefined,
      });
      if (result.tag !== "Project") {
        throw new Error(`Failed to init project: ${result.tag}`);
      }
      // Show what is actually watched, after removing duplicates.
      const lines = removeCoveredWatchDirs(result.project.watchDirs).map(
        ({ tag, dir }) => {
          const relative = path
            .relative(repoRoot, dir)
            .split(path.sep)
            .join("/");
          return `${tag}: ${
            relative === ""
              ? "."
              : relative.startsWith("..")
                ? "<outside repo>"
                : relative
          }`;
        },
      );
      // Directories outside the repo vary between machines.
      return lines
        .filter((line, index) => line !== lines[index - 1])
        .join("\n");
    }

    test("source directories above elm-watch.json", () => {
      expect(
        printWatchDirs(
          "hot/source-directories-above-elm-watch-json/app/example",
        ),
      ).toMatchInlineSnapshot(`
        Shallow: tests/fixtures/hot/source-directories-above-elm-watch-json/app
        Shallow: tests/fixtures/hot/source-directories-above-elm-watch-json/app/elm-stuff
        SourceDirectory: tests/fixtures/hot/source-directories-above-elm-watch-json/app/src
        SourceDirectory: tests/fixtures/hot/source-directories-above-elm-watch-json/app/example
        SourceDirectory: tests/fixtures/hot/source-directories-above-elm-watch-json/src
      `);
    });

    test("elm.json above elm-watch.json", () => {
      expect(printWatchDirs("hot/elm-json-above-elm-watch-json/example"))
        .toMatchInlineSnapshot(`
        Shallow: tests/fixtures/hot/elm-json-above-elm-watch-json
        Shallow: tests/fixtures/hot/elm-json-above-elm-watch-json/elm-stuff
        SourceDirectory: tests/fixtures/hot/elm-json-above-elm-watch-json/src
        Shallow: tests/fixtures/hot/elm-json-above-elm-watch-json/example
      `);
    });

    test("elm.json not found", () => {
      expect(printWatchDirs("errors/elm-json-not-found"))
        .toMatchInlineSnapshot(`
          Shallow: tests/fixtures/errors/elm-json-not-found
          Shallow: tests/fixtures/errors/elm-json-not-found/pages
        `);
    });
  });
});
