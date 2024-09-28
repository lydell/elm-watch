/* eslint-disable no-console */
import * as fs from "fs";
import * as path from "path";
import * as Decode from "tiny-decoders";

import * as mainElmJson from "../tests/install-packages/elm.json";

const PACKAGES_TO_INSTALL: Record<string, string> = {
  ...mainElmJson.dependencies.direct,
  ...mainElmJson.dependencies.indirect,
};

const FIXTURES_DIR = path.join(__dirname, "..", "tests", "fixtures");

function checkDir(dir: string): void {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.isFile()) {
      if (item.name === "elm.json" || item.name === "elm.template.json") {
        checkFile(path.join(dir, item.name));
      }
    } else if (item.isDirectory()) {
      checkDir(path.join(dir, item.name));
    }
  }
}

const Dependencies = Decode.record(Decode.string);

const ElmJson = Decode.fieldsAuto({
  dependencies: Decode.fieldsAuto({
    direct: Dependencies,
    indirect: Dependencies,
  }),
});

function checkFile(file: string): void {
  const relativeFile = path.relative(FIXTURES_DIR, file);

  let json;
  try {
    json = ElmJson(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch (error) {
    // Some test files contain syntax errors on purpose – ignore those.
    // One test is for an Elm package – ignore that too (since version ranges are hard).
    console.info(
      `Skipping: ${relativeFile}:`,
      error instanceof Decode.DecoderError
        ? error.format().replace(/\n/g, " | ")
        : error instanceof Error
          ? error.message
          : error,
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
        `This file includes \`${JSON.stringify(name)}: ${JSON.stringify(
          version,
        )}\`, but the elm.json we install includes: \`${JSON.stringify(
          name,
        )}: ${JSON.stringify(versionToInstall)}\``,
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
