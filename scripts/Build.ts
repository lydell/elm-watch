import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";

const DIR = path.dirname(import.meta.dirname);
const BUILD = path.join(DIR, "build");
const CLIENT_DIR = path.join(DIR, "client");

export function readPackage<T extends Record<string, unknown>>(
  name: string,
  codec: Codec.Codec<T>,
): T & { raw: Record<string, unknown> } {
  const raw = Codec.JSON.parse(
    Codec.record(Codec.unknown),
    fs.readFileSync(path.join(DIR, name), "utf8"),
  );
  if (raw.tag === "DecoderError") {
    throw new Error(`Decoding ${name}:\n${Codec.format(raw.error)}`);
  }
  const decoded = codec.decoder(raw.value);
  if (decoded.tag === "DecoderError") {
    throw new Error(`Decoding ${name}:\n${Codec.format(decoded.error)}`);
  }
  return { ...decoded.value, raw: raw.value };
}

const PACKAGE = readPackage(
  "package.json",
  Codec.fields({ dependencies: Codec.record(Codec.string) }),
);

const PACKAGE_REAL = readPackage(
  "package-real.json",
  Codec.fields({ version: Codec.string }),
);

export type FileToCopy = {
  src: string;
  dest?: string;
  transform?: (content: string) => string;
};

const FILES_TO_COPY: Array<FileToCopy> = [
  { src: "LICENSE" },
  { src: "index.d.ts" },
  { src: "elm-watch-node.d.ts" },
  {
    src: "README.md",
    transform: (content) => content.replace(/^##[^]*/m, "").trim(),
  },
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
      { ...PACKAGE_REAL.raw, dependencies: PACKAGE.dependencies },
      2,
    ),
  );

  fs.writeFileSync(
    path.join(BUILD, "ClientCode.js"),
    `
const fs = require("fs");
const path = require("path");
exports.client = fs.readFileSync(path.join(__dirname, "client.js"), "utf8");
exports.proxy = fs.readFileSync(path.join(__dirname, "proxy.js"), "utf8");
    `.trim(),
  );

  const clientResult = await esbuild.build(clientEsbuildOptions);

  for (const output of clientResult.outputFiles) {
    switch (path.basename(output.path)) {
      case "client.js":
      case "proxy.js":
        fs.writeFileSync(
          output.path,
          output.text.replace(/%VERSION%/g, PACKAGE_REAL.version),
        );
        break;

      default:
        throw new Error(`Unexpected output: ${output.path}`);
    }
  }

  const result = await esbuild.build({
    bundle: true,
    legalComments: "inline",
    entryPoints: [
      path.join(DIR, "src", "index.ts"),
      path.join(DIR, "src", "PostprocessWorker.ts"),
    ],
    packages: "external",
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

  const toModuleRegex = /__toESM\((require\("[^"]+"\))(?:, 1)?\)/g;

  for (const output of result.outputFiles) {
    switch (path.basename(output.path)) {
      case "index.js": {
        const replaced = output.text
          // TODO: Check this
          .replace(
            /^[^]+\nmodule.exports = .+\s*/g,
            "module.exports = elmWatchCli",
          )
          .replace(toModuleRegex, "$1")
          .replace(/%VERSION%/g, PACKAGE_REAL.version)
          .trim();
        const code = `#!/usr/bin/env node\n"use strict";\n${replaced}`;
        fs.writeFileSync(output.path, code, { mode: "755" });
        break;
      }

      case "PostprocessWorker.js":
        fs.writeFileSync(
          output.path,
          output.text
            .slice(output.text.indexOf("// src/"))
            .replace(toModuleRegex, "$1"),
        );
        break;

      default:
        throw new Error(`Unexpected output: ${output.path}`);
    }
  }
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

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
if (process.argv[1]!.endsWith("Build.ts")) {
  run().catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
