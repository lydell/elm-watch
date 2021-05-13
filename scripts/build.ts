import * as childProcess from "child_process";
import * as fs from "fs";
import * as path from "path";

const DIR = path.dirname(__dirname);
const BUILD = path.join(DIR, "build");

const READ_MORE =
  "**[➡️ Full readme](https://github.com/lydell/elm-watch/#readme)**";

type Package = {
  version: string;
};

const PKG = JSON.parse(
  fs.readFileSync(path.join(DIR, "package-real.json"), "utf8")
) as Package;

type FileToCopy = {
  src: string;
  dest?: string;
  transform?: (content: string) => string;
};

const FILES_TO_COPY: Array<FileToCopy> = [
  { src: "LICENSE" },
  { src: "package-real.json", dest: "package.json" },
  {
    src: "README.md",
    transform: (content) => content.replace(/^##[^]*/m, READ_MORE),
  },
];

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

childProcess.spawnSync("npx", ["--no-install", "tsc"], {
  shell: true,
  stdio: "inherit",
});

function modifyFile(
  file: string,
  transform: (content: string) => string
): void {
  fs.writeFileSync(file, transform(fs.readFileSync(file, "utf8")));
}

modifyFile(path.join(BUILD, "index.js"), (content) =>
  content.replace(/%VERSION%/g, PKG.version)
);

fs.chmodSync(path.join(BUILD, "index.js"), "755");
