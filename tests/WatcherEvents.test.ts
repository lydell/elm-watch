import { describe, expect, test } from "vitest";

import type { WatcherEventName } from "../src/LatestEvent.ts";
import type { Project } from "../src/Project.ts";
import {
  markAsAbsolutePath,
  markAsCwd,
  markAsElmWatchJsonPath,
  markAsStaticFilesDir,
} from "../src/Types.ts";
import { classifyWatcherEvent } from "../src/WatcherEvents.ts";
import { makeProject } from "./ProjectHelpers.ts";

// `classifyWatcherEvent` decides what a file change means. The integration
// tests (HotChanges and friends) cover this too, but they are slow, and file
// watching is flaky on macOS.

// Every target imports Shared.elm (see `makeProject`).
const project = makeProject({
  elmJsons: {
    app: [
      ["One", "clean"],
      ["Two", "clean"],
    ],
  },
  packages: { pkg: ["Pkg", "clean"] },
});

function classify(
  theProject: Project,
  eventName: WatcherEventName,
  absolutePath: string,
): string {
  const result = classifyWatcherEvent(
    theProject,
    eventName,
    markAsAbsolutePath(absolutePath),
  );
  if (result === undefined) {
    return "ignored";
  }
  const { event, effect } = result;
  switch (effect.tag) {
    case "Restart":
      return "restart";
    case "MarkAsDirty":
      return `dirty: ${[
        ...effect.outputs.map(({ outputPath }) => outputPath.targetName),
        ...Array.from(theProject.packages.values())
          .filter(([, packageState]) => effect.packages.includes(packageState))
          .map(([packageTarget]) => packageTarget.targetName),
      ].join(", ")}`;
    case "NoEffect":
      return event.file.tag === "StaticFilesDirPath"
        ? `static file: ${event.file.urlPath}`
        : event.affectsAnyTarget
          ? "no effect"
          : "no effect (not imported)";
  }
}

describe("classifyWatcherEvent", () => {
  test(".elm files", () => {
    expect(classify(project, "changed", "/project/src/One.elm")).toBe(
      "dirty: One",
    );
    expect(classify(project, "changed", "/project/src/Shared.elm")).toBe(
      "dirty: One, Two",
    );
    expect(classify(project, "changed", "/project/src/Unused.elm")).toBe(
      "no effect (not imported)",
    );
    // Removing an input restarts, to show an error for it.
    expect(classify(project, "removed", "/project/src/One.elm")).toBe(
      "restart",
    );
    expect(classify(project, "removed", "/project/src/Shared.elm")).toBe(
      "dirty: One, Two",
    );
    // Packages typecheck everything in their src/ directory.
    expect(classify(project, "changed", "/project/pkg/src/Anything.elm")).toBe(
      "dirty: Pkg",
    );
  });

  test("directories", () => {
    expect(classify(project, "changed", "/project/src")).toBe(
      "dirty: One, Two",
    );
    expect(classify(project, "removed", "/project/src")).toBe("restart");
    expect(classify(project, "removed", "/project/app")).toBe("restart");
    // Contains an elm.json.
    expect(classify(project, "changed", "/project/pkg")).toBe("restart");
    // Like for applications, a package’s source directory itself counts.
    expect(classify(project, "changed", "/project/pkg/src")).toBe("dirty: Pkg");
    expect(classify(project, "changed", "/project/other")).toBe("ignored");
  });

  test("elm.json", () => {
    expect(classify(project, "changed", "/project/app/elm.json")).toBe(
      "restart",
    );
    expect(classify(project, "removed", "/project/pkg/elm.json")).toBe(
      "restart",
    );
    expect(classify(project, "changed", "/project/other/elm.json")).toBe(
      "ignored",
    );
  });

  test("elm-stuff", () => {
    expect(classify(project, "removed", "/project/elm-stuff")).toBe("restart");
    expect(classify(project, "changed", "/project/elm-stuff")).toBe("ignored");
    expect(classify(project, "removed", "/project/elm-stuff/0.19.1")).toBe(
      "restart",
    );
    expect(
      classify(project, "removed", "/project/elm-stuff/lamdera-1.5.0-0.19.3"),
    ).toBe("restart");
    expect(classify(project, "removed", "/project/elm-stuff/elm-watch")).toBe(
      "ignored",
    );
  });

  test("elm-watch.json", () => {
    // Irrelevant when not using elm-watch.json.
    expect(classify(project, "changed", "/project/elm-watch.json")).toBe(
      "ignored",
    );

    const withElmWatchJson: Project = {
      ...project,
      configSource: {
        tag: "ElmWatchJson",
        elmWatchJsonPath: markAsElmWatchJsonPath(
          markAsAbsolutePath("/project/elm-watch.json"),
        ),
        cwd: markAsCwd(markAsAbsolutePath("/project")),
      },
    };
    expect(
      classify(withElmWatchJson, "changed", "/project/elm-watch.json"),
    ).toBe("restart");
    expect(
      classify(withElmWatchJson, "removed", "/project/elm-watch.json"),
    ).toBe("restart");
    // Adding another elm-watch.json could change which one is used.
    expect(
      classify(withElmWatchJson, "changed", "/project/src/elm-watch.json"),
    ).toBe("restart");
    expect(
      classify(withElmWatchJson, "removed", "/project/src/elm-watch.json"),
    ).toBe("ignored");
    // A directory containing the elm-watch.json.
    expect(classify(withElmWatchJson, "removed", "/project")).toBe("restart");
  });

  test("static files", () => {
    const withStaticFiles: Project = {
      ...project,
      staticFilesDir: markAsStaticFilesDir(
        markAsAbsolutePath("/project/build"),
      ),
    };
    expect(
      classify(withStaticFiles, "changed", "/project/build/style.css"),
    ).toBe("static file: /style.css");
    expect(
      classify(withStaticFiles, "removed", "/project/build/some dir/file.js"),
    ).toBe("static file: /some%20dir/file.js");
    // Outputs are not static files.
    expect(classify(withStaticFiles, "changed", "/project/build/One.js")).toBe(
      "ignored",
    );
  });

  test("other files", () => {
    expect(classify(project, "changed", "/project/README.md")).toBe("ignored");
  });
});
