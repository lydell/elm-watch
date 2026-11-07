import * as fs from "fs";
import * as path from "path";
import {
  build,
  type BuildOptions,
  type Plugin,
  type RolldownOutput,
} from "rolldown";
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

export const PROXY_SRC_PATH = path.join(DIR, "client", "proxy.js");

const FILES_TO_COPY: Array<FileToCopy> = [
  { src: "LICENSE" },
  { src: "index.d.ts" },
  {
    src: "README.md",
    transform: (content) => content.replace(/^##[^]*/m, "").trim(),
  },
  {
    src: PROXY_SRC_PATH,
    dest: "proxy.js",
  },
];

async function run(): Promise<void> {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD);

  for (const { src, dest = src, transform } of FILES_TO_COPY) {
    if (transform !== undefined) {
      fs.writeFileSync(
        path.resolve(BUILD, dest),
        transform(fs.readFileSync(path.resolve(DIR, src), "utf8")),
      );
    } else {
      fs.copyFileSync(path.resolve(DIR, src), path.resolve(BUILD, dest));
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
import * as fs from "fs";
import * as path from "path";
export const client = fs.readFileSync(path.join(import.meta.dirname, "client.js"), "utf8");
export const proxy = fs.readFileSync(path.join(import.meta.dirname, "proxy.js"), "utf8");
    `.trim(),
  );

  const clientResult = await build(clientBuildOptions);
  const clientCode = getOnlyChunk(clientResult.output);
  checkPlaceholders(clientCode);
  fs.writeFileSync(
    path.join(BUILD, "client.js"),
    clientCode.replace(/%VERSION%/g, PACKAGE_REAL.version),
  );

  const result = await build({
    input: {
      index: path.join(DIR, "src", "index.ts"),
      bin: path.join(DIR, "src", "bin.ts"),
    },
    platform: "node",
    external: isPackage,
    plugins: [clientCodeExternalPlugin],
    output: { format: "esm", chunkFileNames: "[name].js" },
    write: false,
  });

  for (const chunk of result.output) {
    if (chunk.type !== "chunk") {
      throw new Error(`Unexpected output: ${chunk.fileName}`);
    }
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

export function getOnlyChunk(output: RolldownOutput["output"]): string {
  const [chunk, ...rest] = output;
  if (rest.length > 0) {
    throw new Error(
      `Expected a single chunk, but got: ${output.map((item) => item.fileName).join(", ")}`,
    );
  }
  return chunk.code;
}

// Make sure that all placeholders in the source survived bundling.
export function checkPlaceholders(code: string): void {
  const source = fs.readFileSync(path.join(CLIENT_DIR, "client.ts"), "utf8");
  const missing = Array.from(new Set(source.match(/"%[A-Z_]+%"/g))).filter(
    (placeholder) => !code.includes(placeholder),
  );
  if (missing.length > 0) {
    throw new Error(
      `Placeholders missing from the built client code: ${missing.join(", ")}`,
    );
  }
}

export function isPackage(id: string): boolean {
  return !id.startsWith(".") && !path.isAbsolute(id);
}

// In production, src/ClientCode.ts is replaced with a file that reads the
// pre-built client code from disk.
export const clientCodeExternalPlugin: Plugin = {
  name: "ClientCode.ts external",
  resolveId(source) {
    return source === "./ClientCode.ts"
      ? { id: "./ClientCode.js", external: true, moduleSideEffects: false }
      : null;
  },
};

export const clientBuildOptions: BuildOptions & { write: false } = {
  input: path.join(CLIENT_DIR, "client.ts"),
  platform: "browser",
  // Tree shaking and minification fold constants, which would break
  // placeholders like `Number("%INITIAL_ELM_COMPILED_TIMESTAMP%")` (into `NaN`)
  // and `"%TARGET_NAME%"` (by inlining it into other strings). Those
  // placeholders are replaced when injecting the client code into Elm’s output.
  // See also `checkPlaceholders`.
  treeshake: false,
  output: { format: "iife", strict: true, minify: false },
  write: false,
};

if (import.meta.main) {
  run().catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
