import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const DIR = path.dirname(__dirname);
const BUILD = path.join(DIR, "build");
const CLIENT_DIR = path.join(DIR, "client");

const READ_MORE =
  "**[➡️ Full readme](https://github.com/lydell/elm-watch/#readme)**";

type Package = {
  version: string;
  dependencies: Record<string, string>;
};

function readPackage(name: string): Package {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")) as Package;
}

const PACKAGE = readPackage("package.json");
const PACKAGE_REAL = readPackage("package-real.json");

type FileToCopy = {
  src: string;
  dest?: string;
  transform?: (content: string) => string;
};

const FILES_TO_COPY: Array<FileToCopy> = [
  { src: "LICENSE" },
  { src: "elm-watch-node.d.ts" },
  {
    src: "README.md",
    transform: (content) => content.replace(/^##[^]*/m, READ_MORE),
  },
];

async function run(): Promise<void> {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD);

  for (const { src, dest = src, transform } of FILES_TO_COPY) {
    if (transform !== undefined) {
      fs.writeFileSync(
        path.join(BUILD, dest),
        transform(fs.readFileSync(path.join(DIR, src), "utf8"))
      );
    } else {
      fs.copyFileSync(path.join(DIR, src), path.join(BUILD, dest));
    }
  }

  fs.writeFileSync(
    path.join(BUILD, "package.json"),
    JSON.stringify(
      { ...PACKAGE_REAL, dependencies: PACKAGE.dependencies },
      null,
      2
    )
  );

  fs.writeFileSync(
    path.join(BUILD, "ClientCode.js"),
    `
const fs = require("fs");
const path = require("path");
exports.client = fs.readFileSync(path.join(__dirname, "client.js"), "utf8");
exports.proxy = fs.readFileSync(path.join(__dirname, "proxy.js"), "utf8");
    `.trim()
  );

  const clientResult = await esbuild.build(clientEsbuildOptions);

  for (const output of clientResult.outputFiles) {
    switch (path.basename(output.path)) {
      case "client.js":
      case "proxy.js":
        fs.writeFileSync(
          output.path,
          output.text.replace(/%VERSION%/g, PACKAGE_REAL.version)
        );
        break;

      default:
        throw new Error(`Unexpected output: ${output.path}`);
    }
  }

  const result = await esbuild.build({
    bundle: true,
    entryPoints: [
      path.join(DIR, "src", "index.ts"),
      path.join(DIR, "src", "PostprocessWorker.ts"),
    ],
    external: Object.keys(PACKAGE.dependencies),
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
            (args) => ({ path: args.path, external: true })
          );
        },
      },
    ],
  });

  const toModuleRegex = /__toESM\((require\("[^"]+"\))\)/g;
  const exportsRegex = /module.exports = .+/g;

  for (const output of result.outputFiles) {
    switch (path.basename(output.path)) {
      case "index.js": {
        const replaced = output.text
          .slice(
            secondIndexOf(output.text, "//"),
            output.text.lastIndexOf("//")
          )
          .replace(toModuleRegex, "$1")
          .replace(exportsRegex, "")
          .replace(/%VERSION%/g, PACKAGE_REAL.version)
          .trim();
        const code = `#!/usr/bin/env node\n${replaced}`;
        fs.writeFileSync(output.path, code, { mode: "755" });
        break;
      }

      case "PostprocessWorker.js":
        fs.writeFileSync(
          output.path,
          output.text
            .slice(output.text.indexOf("//"))
            .replace(toModuleRegex, "$1")
        );
        break;

      default:
        throw new Error(`Unexpected output: ${output.path}`);
    }
  }
}

function secondIndexOf(string: string, substring: string): number {
  const first = string.indexOf(substring);
  return first === -1
    ? -1
    : string.indexOf(substring, first + substring.length);
}

export const clientEsbuildOptions: esbuild.BuildOptions & { write: false } = {
  bundle: true,
  entryPoints: [
    path.join(CLIENT_DIR, "client.ts"),
    path.join(CLIENT_DIR, "proxy.ts"),
  ],
  outdir: BUILD,
  platform: "browser",
  write: false,
};

if (require.main === module) {
  run().catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
