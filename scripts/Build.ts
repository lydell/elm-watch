import * as fs from "fs";
import * as path from "path";
import { build, type Plugin, type RolldownOutput } from "rolldown";
import * as Codec from "tiny-decoders";

import * as ClientCode from "../src/ClientCode.ts";
import { CLIENT_CONFIG_IDENTIFIER } from "../src/ClientConfig.ts";

const DIR = path.dirname(import.meta.dirname);
const BUILD = path.join(DIR, "build");
const BUILD_ELM_WATCH_LIB = path.join(DIR, "build-elm-watch-lib");
const CLIENT_CODE_PATH = path.join(DIR, "src", "ClientCode.ts");

function readPackage<T extends Record<string, unknown>>(
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

type FileToCopy = {
  src: string;
  dest?: string;
  transform?: (content: string) => string;
};

function resetDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
}

function copyFiles(dir: string, files: Array<FileToCopy>): void {
  for (const { src, dest = src, transform } of files) {
    if (transform !== undefined) {
      fs.writeFileSync(
        path.join(dir, dest),
        transform(fs.readFileSync(path.join(DIR, src), "utf8")),
      );
    } else {
      fs.copyFileSync(path.join(DIR, src), path.join(dir, dest));
    }
  }
}

function writePackageJson(dir: string, json: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    Codec.JSON.stringify(Codec.unknown, json, 2),
  );
}

function isPackage(id: string): boolean {
  return !id.startsWith(".") && !path.isAbsolute(id);
}

// src/ClientCode.ts bundles the client code at runtime, using rolldown. In the
// build, replace it with the result of that, as strings.
const inlineClientCodePlugin: Plugin = {
  name: "Inline ClientCode.ts",
  load(id) {
    return path.normalize(id) === CLIENT_CODE_PATH
      ? [
          `export const client = ${Codec.JSON.stringify(Codec.string, ClientCode.client)};`,
          `export const proxy = ${Codec.JSON.stringify(Codec.string, ClientCode.proxy)};`,
        ].join("\n")
      : null;
  },
};

function getChunks(
  output: RolldownOutput["output"],
): Array<{ fileName: string; code: string }> {
  return output.map((item) => {
    if (item.type !== "chunk") {
      throw new Error(`Unexpected output: ${item.fileName}`);
    }
    return item;
  });
}

async function buildElmWatch(): Promise<void> {
  const PACKAGE_REAL = readPackage(
    "package-real.json",
    Codec.fields({ version: Codec.string }),
  );

  resetDir(BUILD);

  copyFiles(BUILD, [
    { src: "LICENSE" },
    { src: "index.d.ts" },
    {
      src: "README.md",
      transform: (content) => content.replace(/^##[^]*/m, "").trim(),
    },
  ]);

  writePackageJson(BUILD, {
    ...PACKAGE_REAL.raw,
    dependencies: PACKAGE.dependencies,
  });

  const result = await build({
    input: {
      index: path.join(DIR, "src", "index.ts"),
      bin: path.join(DIR, "src", "bin.ts"),
    },
    platform: "node",
    external: isPackage,
    plugins: [inlineClientCodePlugin],
    output: { format: "esm", chunkFileNames: "[name].js" },
    write: false,
  });

  const chunks = getChunks(result.output);

  if (!chunks.some((chunk) => chunk.code.includes(CLIENT_CONFIG_IDENTIFIER))) {
    throw new Error("Expected the client code to be inlined.");
  }

  for (const chunk of chunks) {
    const code = chunk.code.replace(/%VERSION%/g, PACKAGE_REAL.version);
    if (chunk.fileName === "bin.js") {
      fs.writeFileSync(
        path.join(BUILD, chunk.fileName),
        `#!/usr/bin/env node\n${code}`,
        { mode: "755" },
      );
    } else {
      fs.writeFileSync(path.join(BUILD, chunk.fileName), code);
    }
  }
}

async function buildElmWatchLib(): Promise<void> {
  const PACKAGE_REAL = readPackage(
    "package-elm-watch-lib.json",
    Codec.fields({
      description: Codec.string,
      dependencies: Codec.record(Codec.string),
    }),
  );

  resetDir(BUILD_ELM_WATCH_LIB);

  copyFiles(BUILD_ELM_WATCH_LIB, [
    { src: "LICENSE" },
    { src: "elm-watch-lib.d.ts", dest: "index.d.ts" },
  ]);

  writePackageJson(BUILD_ELM_WATCH_LIB, {
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
  });

  fs.writeFileSync(
    path.join(BUILD_ELM_WATCH_LIB, "README.md"),
    `
# elm-watch-lib

${PACKAGE_REAL.description}
    `.trim(),
  );

  const result = await build({
    input: path.join(DIR, "src", "elm-watch-lib.ts"),
    platform: "node",
    external: isPackage,
    plugins: [inlineClientCodePlugin],
    output: { format: "esm" },
    write: false,
  });

  const [chunk, ...rest] = getChunks(result.output);
  if (chunk === undefined || rest.length > 0) {
    throw new Error(
      `Expected a single chunk, but got: ${result.output.map((item) => item.fileName).join(", ")}`,
    );
  }
  if (chunk.code.includes(CLIENT_CONFIG_IDENTIFIER)) {
    throw new Error("Expected the client code to be tree shaken away.");
  }
  fs.writeFileSync(path.join(BUILD_ELM_WATCH_LIB, "index.js"), chunk.code);
}

async function run(): Promise<void> {
  await buildElmWatch();
  await buildElmWatchLib();
}

run().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
