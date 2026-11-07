import * as fs from "fs";
import * as path from "path";
import { build } from "rolldown";
import * as Codec from "tiny-decoders";

import {
  clientCodeExternalPlugin,
  type FileToCopy,
  getOnlyChunk,
  isPackage,
  readPackage,
} from "./Build.ts";

const DIR = path.dirname(import.meta.dirname);
const BUILD = path.join(DIR, "build-elm-watch-lib");

const PACKAGE = readPackage(
  "package.json",
  Codec.fields({ dependencies: Codec.record(Codec.string) }),
);

const PACKAGE_REAL = readPackage(
  "package-elm-watch-lib.json",
  Codec.fields({
    description: Codec.string,
    dependencies: Codec.record(Codec.string),
  }),
);

const FILES_TO_COPY: Array<FileToCopy> = [
  { src: "LICENSE" },
  { src: "elm-watch-lib.d.ts", dest: "index.d.ts" },
];

async function run(): Promise<void> {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD);

  for (const { src, dest = src, transform } of FILES_TO_COPY) {
    if (transform !== undefined) {
      fs.writeFileSync(
        path.join(BUILD, dest),
        transform(fs.readFileSync(path.join(DIR, src), "utf8")),
      );
    } else {
      fs.copyFileSync(path.join(DIR, src), path.join(BUILD, dest));
    }
  }

  fs.writeFileSync(
    path.join(BUILD, "package.json"),
    Codec.JSON.stringify(
      Codec.unknown,
      {
        ...PACKAGE_REAL.raw,
        dependencies: Object.fromEntries(
          Object.entries(PACKAGE_REAL.dependencies).map(([name, version]) => {
            if (version !== "*") {
              throw new Error(
                `${name}: Expected version to be * but got: ${version}`,
              );
            }
            const actualVersion = PACKAGE.dependencies[name];
            if (actualVersion === undefined) {
              throw new Error(
                `${name}: Expected the main package.json to have this dependency too, but it does not.`,
              );
            }
            return [name, actualVersion];
          }),
        ),
      },
      2,
    ),
  );

  fs.writeFileSync(
    path.join(BUILD, "README.md"),
    `
# elm-watch-lib

${PACKAGE_REAL.description}
    `.trim(),
  );

  const result = await build({
    input: path.join(DIR, "src", "elm-watch-lib.ts"),
    platform: "node",
    external: isPackage,
    plugins: [clientCodeExternalPlugin],
    output: { format: "esm" },
    write: false,
  });

  const code = getOnlyChunk(result.output);
  if (code.includes("ClientCode")) {
    throw new Error("Expected ClientCode to be tree shaken away.");
  }
  fs.writeFileSync(path.join(BUILD, "index.js"), code);
}

run().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
