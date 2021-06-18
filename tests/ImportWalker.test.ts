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

  test("multiple source directories", () => {
    expect(
      walkImportsHelper("multiple-source-directories", "app/Main.elm", [
        "app",
        "body-parts",
        "units",
      ])
    ).toMatchInlineSnapshot(`
      /multiple-source-directories/app/Main.elm
      /multiple-source-directories/body-parts/Main.elm
      /multiple-source-directories/units/Main.elm
      /multiple-source-directories/app/Foot/International.elm
      /multiple-source-directories/body-parts/Foot/International.elm
      /multiple-source-directories/units/Foot/International.elm
      /multiple-source-directories/app/Meter.elm
      /multiple-source-directories/body-parts/Meter.elm
      /multiple-source-directories/units/Meter.elm
      /multiple-source-directories/app/Foot/UsSurvey.elm
      /multiple-source-directories/body-parts/Foot/UsSurvey.elm
      /multiple-source-directories/units/Foot/UsSurvey.elm
      /multiple-source-directories/app/Hand/Thumb.elm
      /multiple-source-directories/body-parts/Hand/Thumb.elm
      /multiple-source-directories/units/Hand/Thumb.elm
      /multiple-source-directories/app/Hand.elm
      /multiple-source-directories/body-parts/Hand.elm
      /multiple-source-directories/units/Hand.elm
      /multiple-source-directories/app/Hand/Palm.elm
      /multiple-source-directories/body-parts/Hand/Palm.elm
      /multiple-source-directories/units/Hand/Palm.elm
      /multiple-source-directories/app/Foot/Heel.elm
      /multiple-source-directories/body-parts/Foot/Heel.elm
      /multiple-source-directories/app/Html.elm
      /multiple-source-directories/body-parts/Html.elm
      /multiple-source-directories/units/Html.elm
      /multiple-source-directories/units/Foot/Heel.elm
      /multiple-source-directories/app/Foot/Toe.elm
      /multiple-source-directories/body-parts/Foot/Toe.elm
      /multiple-source-directories/units/Foot/Toe.elm
    `);
  });

  test("duplicate imports", () => {
    expect(
      walkImportsHelper("duplicate-imports", "DuplicateImports.elm", ["."])
    ).toMatchInlineSnapshot(`
      /duplicate-imports/DuplicateImports.elm
      /duplicate-imports/A.elm
      /duplicate-imports/FromA.elm
      /duplicate-imports/B.elm
    `);
  });

  test("ambiguous source directories", () => {
    expect(
      // Missing source directories don’t matter.
      walkImportsHelper("anywhere", "Main.elm", [".", "src"])
    ).toMatchInlineSnapshot(`
      /anywhere/Main.elm
      /anywhere/src/Main.elm
    `);
  });

  test("ambiguous source directories – more complex", () => {
    expect(
      walkImportsHelper("anywhere", "src/App/Main.elm", [
        "lib",
        "src",
        "src/App",
      ])
    ).toMatchInlineSnapshot(`
      /anywhere/src/App/Main.elm
      /anywhere/lib/App/Main.elm
      /anywhere/src/App/App/Main.elm
      /anywhere/lib/Main.elm
      /anywhere/src/Main.elm
    `);
  });

  describe("cycles", () => {
    test("import self", () => {
      expect(
        walkImportsHelper("cycles", "ImportSelf.elm", ["."])
      ).toMatchInlineSnapshot(`/cycles/ImportSelf.elm`);
    });

    test("import self indirect", () => {
      expect(walkImportsHelper("cycles", "ImportSelfIndirect.elm", ["."]))
        .toMatchInlineSnapshot(`
              /cycles/ImportSelfIndirect.elm
              /cycles/ImportSelf.elm
              /cycles/Other.elm
          `);
    });

    test("import entrypoint indirect", () => {
      expect(walkImportsHelper("cycles", "ImportEntryPointIndirect.elm", ["."]))
        .toMatchInlineSnapshot(`
              /cycles/ImportEntryPointIndirect.elm
              /cycles/Sub.elm
          `);
    });

    test("longer chains", () => {
      expect(walkImportsHelper("cycles", "LongerChains.elm", ["."]))
        .toMatchInlineSnapshot(`
        /cycles/LongerChains.elm
        /cycles/A.elm
        /cycles/B.elm
        /cycles/C.elm
        /cycles/D.elm
        /cycles/Some/Package.elm
        /cycles/X.elm
        /cycles/Y.elm
        /cycles/Z.elm
      `);
    });
  });

  test("file is actually a directory", () => {
    expect(
      walkImportsHelper("is-directory", "Main.elm", ["."])
    ).toMatchInlineSnapshot(`EISDIR: illegal operation on a directory, read`);
  });
});
