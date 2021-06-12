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

  const bundle = await rollup({
    input: path.join(DIR, "src", "index.ts"),
    external: (source) => /^[a-z@]/.test(source),
    plugins: [typescript({ module: "ESNext" })],
    onwarn: (warning) => {
      // Rollup warnings _do_ have a real `.toString()` method.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      throw new Error(warning.toString());
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
        const code = item.code
          .replace(/%VERSION%/g, PACKAGE_REAL.version)
          .replace(
            /function \(\) \{ return require\(/g,
            "() => { return import("
          )
          .replace(/^exports.elmWatchCli = elmWatchCli;/m, "")
          .trim();
        const fullCode = `#!/usr/bin/env node\n${code}`;
        fs.writeFileSync(path.join(BUILD, item.fileName), fullCode, {
          mode: "755",
        });
      }
    }
  }
}

run().catch((error: Error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
