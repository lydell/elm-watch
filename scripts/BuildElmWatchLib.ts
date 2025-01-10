import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";

import { FileToCopy, readPackage } from "./Build";

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

  const result = await esbuild.build({
    bundle: true,
    legalComments: "inline",
    entryPoints: [path.join(DIR, "src", "elm-watch-lib.ts")],
    packages: "external",
    format: "esm",
    outdir: BUILD,
    platform: "node",
    write: false,
    plugins: [
      {
        // I didn’t manage to do this with the `external` option, so using a plugin instead.
        name: "Ignore ClientCode.ts",
        setup(build) {
          build.onResolve(
            {
              filter: /^\.\/ClientCode$/,
            },
            (args) => ({ path: args.path, external: true }),
          );
        },
      },
    ],
  });

  for (const output of result.outputFiles) {
    switch (path.basename(output.path)) {
      case "elm-watch-lib.js": {
        const code = output.text.replace(
          `import * as ClientCode from "./ClientCode";\n`,
          "",
        );
        fs.writeFileSync(path.join(BUILD, "index.js"), code);
        break;
      }

      default:
        throw new Error(`Unexpected output: ${output.path}`);
    }
  }
}

run().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
