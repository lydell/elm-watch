import { describe, expect, test } from "vitest";

import { HashMap } from "../src/HashMap";
import { HashSet } from "../src/HashSet";
import { OutputState, Project, projectToDebug } from "../src/Project";
import { GetNow } from "../src/Types";
import { stringSnapshotSerializer } from "./Helpers";

const getNow: GetNow = () => new Date();

const project: Project = {
  watchRoot: {
    tag: "AbsolutePath",
    absolutePath: "/Users/you/project",
  },
  elmWatchJsonPath: {
    tag: "ElmWatchJsonPath",
    theElmWatchJsonPath: {
      tag: "AbsolutePath",
      absolutePath: "/Users/you/project/elm-watch.json",
    },
  },
  elmWatchStuffJsonPath: {
    tag: "ElmWatchStuffJsonPath",
    theElmWatchStuffJsonPath: {
      tag: "AbsolutePath",
      absolutePath: "/Users/you/project/elm-stuff/elm-watch/stuff.json",
    },
  },
  maxParallel: 12,
  postprocess: {
    tag: "Postprocess",
    postprocessArray: ["elm-watch-node", "postprocess.js"],
  },
  disabledOutputs: new HashSet([
    {
      originalString: "public/build/HtmlMain.js",
      tag: "OutputPath",
      targetName: "Html",
      theOutputPath: {
        tag: "AbsolutePath",
        absolutePath: "/Users/you/project/public/build/HtmlMain.js",
      },
      temporaryOutputPath: {
        tag: "AbsolutePath",
        absolutePath: "/Users/you/project/elm-stuff/elm-watch/1.js",
      },
    },
    {
      originalString: "public/submodules/azimutt/public/dist/elm.js",
      tag: "OutputPath",
      targetName: "Azimutt",
      theOutputPath: {
        tag: "AbsolutePath",
        absolutePath:
          "/Users/you/project/public/submodules/azimutt/public/dist/elm.js",
      },
      temporaryOutputPath: {
        tag: "AbsolutePath",
        absolutePath: "/Users/you/project/elm-stuff/elm-watch/2.js",
      },
    },
  ]),
  elmJsonsErrors: [
    {
      outputPath: {
        tag: "OutputPath",
        theOutputPath: {
          tag: "AbsolutePath",
          absolutePath: "/Users/you/project/public/build/SandboxMain.js",
        },
        temporaryOutputPath: {
          tag: "AbsolutePath",
          absolutePath: "/Users/you/project/elm-stuff/elm-watch/3.js",
        },
        originalString: "public/build/SandboxMain.js",
        targetName: "Sandbox",
      },
      compilationMode: "standard",
      browserUiPosition: "BottomLeft",
      openErrorOverlay: false,
      error: {
        tag: "InputsNotFound",
        inputsNotFound: [
          {
            tag: "UncheckedInputPath",
            theUncheckedInputPath: {
              tag: "AbsolutePath",
              absolutePath: "/Users/you/project/src/BandboxMain.elm",
            },
            originalString: "src/BandboxMain.elm",
          },
        ],
      },
    },
  ],
  elmJsons: new HashMap([
    [
      {
        tag: "ElmJsonPath",
        theElmJsonPath: {
          tag: "AbsolutePath",
          absolutePath: "/Users/you/project/elm.json",
        },
      },
      new HashMap([
        [
          {
            originalString: "public/build/ElementMain.js",
            tag: "OutputPath",
            targetName: "Element",
            theOutputPath: {
              tag: "AbsolutePath",
              absolutePath: "/Users/you/project/public/build/ElementMain.js",
            },
            temporaryOutputPath: {
              tag: "AbsolutePath",
              absolutePath: "/Users/you/project/elm-stuff/elm-watch/4.js",
            },
          },
          new OutputState(
            [
              {
                tag: "InputPath",
                theInputPath: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project/src/ElementMain.elm",
                },
                originalString: "src/ElementMain.elm",
                realpath: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project/src/ElementMain.elm",
                },
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
            targetName: "Frankenstein",
            theOutputPath: {
              tag: "AbsolutePath",
              absolutePath: "/Users/you/project/public/build/Frankenstein.js",
            },
            temporaryOutputPath: {
              tag: "AbsolutePath",
              absolutePath: "/Users/you/project/elm-stuff/elm-watch/5.js",
            },
          },
          new OutputState(
            [
              {
                tag: "InputPath",
                theInputPath: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project/src/ApplicationMain.elm",
                },
                originalString: "src/ApplicationMain.elm",
                realpath: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project/src/ApplicationMain.elm",
                },
              },
              {
                tag: "InputPath",
                theInputPath: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project/src/DocumentMain.elm",
                },
                originalString: "src/DocumentMain.elm",
                realpath: {
                  tag: "AbsolutePath",
                  absolutePath: "/Users/you/project/src/DocumentMain.elm",
                },
              },
            ],
            "standard",
            "BottomLeft",
            false,
            getNow,
          ),
        ],
      ]),
    ],
    [
      {
        tag: "ElmJsonPath",
        theElmJsonPath: {
          tag: "AbsolutePath",
          absolutePath:
            "/Users/you/project/public/submodules/concourse/web/elm/elm.json",
        },
      },
      new HashMap([
        [
          {
            originalString: "public/submodules/concourse/web/public/elm.min.js",
            tag: "OutputPath",
            targetName: "Concourse",
            theOutputPath: {
              tag: "AbsolutePath",
              absolutePath:
                "/Users/you/project/public/submodules/concourse/web/public/elm.min.js",
            },
            temporaryOutputPath: {
              tag: "AbsolutePath",
              absolutePath: "/Users/you/project/elm-stuff/elm-watch/6.js",
            },
          },
          new OutputState(
            [
              {
                tag: "InputPath",
                theInputPath: {
                  tag: "AbsolutePath",
                  absolutePath:
                    "/Users/you/project/public/submodules/concourse/web/elm/src/Main.elm",
                },
                originalString: "src/ElementMain.elm",
                realpath: {
                  tag: "AbsolutePath",
                  absolutePath:
                    "/Users/you/project/public/submodules/concourse/web/elm/src/Main.elm",
                },
              },
            ],
            "optimize",
            "BottomLeft",
            false,
            getNow,
          ),
        ],
      ]),
    ],
  ]),
};

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("Project", () => {
  test("projectToDebug", () => {
    expect(JSON.stringify(projectToDebug(project), null, 2))
      .toMatchInlineSnapshot(`
      {
        "watchRoot": "/Users/you/project",
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
