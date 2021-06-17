import * as path from "path";

import { walkImports } from "../src/ImportWalker";
import { mapNonEmptyArray, NonEmptyArray } from "../src/NonEmptyArray";
import { AbsolutePath, absolutePathFromString } from "../src/PathHelpers";
import { InputPath, SourceDirectory } from "../src/Types";
import { clean, stringSnapshotSerializer } from "./Helpers";

const FIXTURES_DIR: AbsolutePath = {
  tag: "AbsolutePath",
  absolutePath: path.join(__dirname, "fixtures", "ImportWalker"),
};

function walkImportsHelper(
  fixture: string,
  inputFile: string,
  sourceDirectories: NonEmptyArray<string>
): string {
  const dir = absolutePathFromString(FIXTURES_DIR, fixture);

  const inputPath: InputPath = {
    tag: "InputPath",
    theInputPath: absolutePathFromString(dir, inputFile),
    originalString: inputFile,
    realpath: absolutePathFromString(dir, inputFile),
  };

  const result = walkImports(
    mapNonEmptyArray(
      sourceDirectories,
      (sourceDirectory): SourceDirectory => ({
        tag: "SourceDirectory",
        theSourceDirectory: absolutePathFromString(dir, sourceDirectory),
      })
    ),
    inputPath
  );

  switch (result.tag) {
    case "Success":
      return Array.from(result.allRelatedElmFilePaths, (filePath) =>
        filePath.startsWith(FIXTURES_DIR.absolutePath)
          ? filePath.slice(FIXTURES_DIR.absolutePath.length)
          : filePath
      ).join("\n");
    case "FileSystemError":
      return clean(result.error.message);
  }
}

expect.addSnapshotSerializer(stringSnapshotSerializer);

describe("WalkImports", () => {
  test("diamond import tree", () => {
    expect(walkImportsHelper("diamond", "Main.elm", ["."]))
      .toMatchInlineSnapshot(`
      /diamond/Main.elm
      /diamond/Left.elm
      /diamond/Helpers.elm
      /diamond/Right.elm
    `);
  });
});
