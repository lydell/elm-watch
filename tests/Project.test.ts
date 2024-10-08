import { describe, expect, test } from "vitest";

import {
  filterSubDirs,
  OutputState,
  Project,
  projectToDebug,
} from "../src/Project";
import {
  GetNow,
  markAsAbsolutePath,
  markAsElmJsonPath,
  markAsElmWatchJsonPath,
  markAsElmWatchStuffJsonPath,
  markAsTargetName,
} from "../src/Types";
import { stringSnapshotSerializer } from "./Helpers";

const getNow: GetNow = () => new Date();

const project: Project = {
  watchRoots: new Set([markAsAbsolutePath("/Users/you/project")]),
  elmWatchJsonPath: markAsElmWatchJsonPath(
    markAsAbsolutePath("/Users/you/project/elm-watch.json"),
  ),
  elmWatchStuffJsonPath: markAsElmWatchStuffJsonPath(
    markAsAbsolutePath("/Users/you/project/elm-stuff/elm-watch/stuff.json"),
  ),
  maxParallel: 12,
  postprocess: {
    tag: "Postprocess",
    postprocessArray: ["elm-watch-node", "postprocess.js"],
  },
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
  elmJsonsErrors: [
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
  describe("filterSubDirs", () => {
    const p = markAsAbsolutePath;

    test("if the root is present, all others are filtered away", () => {
      expect(
        filterSubDirs("/", [p("/one"), p("/"), p("/one/sub"), p("/two")]),
      ).toStrictEqual([p("/")]);
    });

    test("if the paths have nothing in common, all are kept", () => {
      expect(
        filterSubDirs("/", [p("/one"), p("/two"), p("/three/sub")]),
      ).toStrictEqual([p("/one"), p("/two"), p("/three/sub")]);
    });

    test("paths contained by other paths are filtered away", () => {
      expect(
        filterSubDirs("/", [
          p("/one"),
          p("/one/sub"),
          p("/one/sub/"),
          p("/one/deep/sub/dir"),
          p("/onefold"),
          p("/two/trailing/"),
          p("/two"),
          p("/three/deep/sub/dir"),
          p("/three/deep/sub/"),
          p("/three/deep/sub/other"),
        ]),
      ).toStrictEqual([
        p("/one"),
        p("/onefold"),
        p("/two"),
        p("/three/deep/sub/"),
      ]);
    });
  });

  test("projectToDebug", () => {
    expect(JSON.stringify(projectToDebug(project), null, 2))
      .toMatchInlineSnapshot(`
      {
        "watchRoots": [
          "/Users/you/project"
        ],
        "elmWatchJson": "/Users/you/project/elm-watch.json",
        "elmWatchStuffJson": "/Users/you/project/elm-stuff/elm-watch/stuff.json",
        "maxParallel": 12,
        "postprocess": {
          "tag": "Postprocess",
          "postprocessArray": [
            "elm-watch-node",
            "postprocess.js"
          ]
        },
        "enabledTargets": [
          {
            "targetName": "Element",
            "output": "/Users/you/project/public/build/ElementMain.js",
            "temporaryOutput": "/Users/you/project/elm-stuff/elm-watch/4.js",
            "originalString": "public/build/ElementMain.js",
            "compilationMode": "optimize",
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
});
