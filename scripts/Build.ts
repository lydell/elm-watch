import typescript from "@rollup/plugin-typescript";
import * as fs from "fs";
import * as path from "path";
import { rollup } from "rollup";

const DIR = path.dirname(__dirname);
const BUILD = path.join(DIR, "build");

const READ_MORE =
  "**[➡️ Full readme](https://github.com/lydell/elm-watch/#readme)**";

type Package = {
  version: string;
  dependencies: unknown;
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
  {
    src: "README.md",
    transform: (content) => content.replace(/^##[^]*/m, READ_MORE),
  },
];

async function run(): Promise<void> {
  if (fs.rmSync !== undefined) {
    fs.rmSync(BUILD, { recursive: true, force: true });
  } else if (fs.existsSync(BUILD)) {
    fs.rmdirSync(BUILD, { recursive: true });
  }

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

  type RollupInput = {
    input: string;
    transform: (code: string) => string;
    writeFileOptions: fs.WriteFileOptions;
  };

  // Rollup creates a shared file with way more than `PostprocessWorker` needs
  // if we run `rollup` just once with both inputs, for some reason.
  // `PostprocessWorker` depends on so little from the rest of the code base so
  // a little bit of duplication in it doesn’t matter.
  const inputs: Array<RollupInput> = [
    {
      input: path.join(DIR, "src", "index.ts"),
      transform: (code) => {
        const replaced = code
          .replace(/%VERSION%/g, PACKAGE_REAL.version)
          .replace(/^exports.elmWatchCli = elmWatchCli;/m, "")
          .trim();
        return `#!/usr/bin/env node\n${replaced}`;
      },
      writeFileOptions: { mode: "755" },
    },
    {
      input: path.join(DIR, "src", "PostprocessWorker.ts"),
      transform: (code) =>
        // TypeScript turns our native `import()` into `require()`.
        // Turn it back into a native `import()`, since it supports both CJS and MJS.
        code.replace(
          /function \(\) \{ return require\(/g,
          "() => { return import("
        ),
      writeFileOptions: {},
    },
  ];

  for (const rollupInput of inputs) {
    const bundle = await rollup({
      input: rollupInput.input,
      external: (source) => /^[a-z@]/.test(source),
      plugins: [typescript({ module: "ESNext" })],
      onwarn: (warning) => {
        // Rollup warnings _do_ have a real `.toString()` method.
        // eslint-disable-next-line @typescript-eslint/no-base-to-string
        throw new Error(warning.toString());
      },
      treeshake: {
        moduleSideEffects: false,
      },
    });

    const { output } = await bundle.generate({
      format: "cjs",
      interop: "esModule",
    });

    for (const item of output) {
      switch (item.type) {
        case "asset":
          throw new Error(`Unexpectedly got an "asset".`);

        case "chunk": {
          fs.writeFileSync(
            path.join(BUILD, item.fileName),
            rollupInput.transform(item.code),
            rollupInput.writeFileOptions
          );
        }
      }
    }
  }
}

run().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
