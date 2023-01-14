/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";

import * as Codec from "../src/Codec";
import { quote } from "../src/Helpers";
import { absolutePathFromString, readJsonFile } from "../src/PathHelpers";
import { AbsolutePath } from "../src/Types";
import * as mainElmJson from "../tests/install-packages/elm.json";

const PACKAGES_TO_INSTALL: Record<string, string> = {
  ...mainElmJson.dependencies.direct,
  ...mainElmJson.dependencies.indirect,
};

const FIXTURES_DIR = absolutePathFromString(
  { tag: "AbsolutePath", absolutePath: __dirname },
  "..",
  "tests",
  "fixtures"
);

function checkDir(dir: AbsolutePath): void {
  for (const item of fs.readdirSync(dir.absolutePath, {
    withFileTypes: true,
  })) {
    if (item.isFile()) {
      if (item.name === "elm.json" || item.name === "elm.template.json") {
        checkFile(absolutePathFromString(dir, item.name));
      }
    } else if (item.isDirectory()) {
      checkDir(absolutePathFromString(dir, item.name));
    }
  }
}

const Dependencies = Codec.record(Codec.string);

const ElmJson = Codec.fields({
  dependencies: Codec.fields({
    direct: Dependencies,
    indirect: Dependencies,
  }),
});

function checkFile(file: AbsolutePath): void {
  const relativeFile = path.relative(
    FIXTURES_DIR.absolutePath,
    file.absolutePath
  );

  const json = readJsonFile(file, ElmJson);
  if (json instanceof Error) {
    // Some test files contain syntax errors on purpose – ignore those.
    // One test is for an Elm package – ignore that too (since version ranges are hard).
    console.info(
      `Skipping: ${relativeFile}:`,
      json instanceof Codec.DecoderError
        ? json.format().replace(/\n/g, " | ")
        : json.message
    );
    return;
  }

  console.info(`Checking: ${relativeFile}`);

  const allDependencies = {
    ...json.dependencies.direct,
    ...json.dependencies.indirect,
  };

  for (const [name, version] of Object.entries(allDependencies)) {
    const versionToInstall = PACKAGES_TO_INSTALL[name];
    if (version !== versionToInstall) {
      throw new Error(
        `This file includes \`${quote(name)}: ${quote(
          version
        )}\`, but the elm.json we install includes: \`${quote(name)}: ${
          versionToInstall === undefined ? "undefined" : quote(versionToInstall)
        }\``
      );
    }
  }
}

try {
  checkDir(FIXTURES_DIR);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
