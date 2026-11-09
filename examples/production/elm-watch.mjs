// @ts-check
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import * as swc from "@swc/core";
import { elmWatch } from "elm-watch";

// Usage:
//
//     node --watch elm-watch.mjs hot
//     node elm-watch.mjs make --optimize
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    debug: { type: "boolean", default: false },
    optimize: { type: "boolean", default: false },
  },
});

const [runMode = "hot"] = positionals;

if (runMode !== "hot" && runMode !== "make") {
  console.error(`Expected "hot" or "make", but got: ${runMode}`);
  process.exit(1);
}

const PUBLIC = path.join(import.meta.dirname, "public");
const DIST = path.join(import.meta.dirname, "dist");

// Elm functions that are safe to remove if their return value is unused.
// Source: https://discourse.elm-lang.org/t/elm-minification-benchmarks/9968
const pureFuncs = [
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
];

/**
 * SWC runs on other threads, so it doesn’t block elm-watch.
 *
 * @param {string} code
 * @returns {Promise<string>}
 */
async function minify(code) {
  const result = await swc.minify(code, {
    compress: {
      pure_funcs: pureFuncs,
      pure_getters: true,
      unsafe_comps: true,
      unsafe: true,
    },
    mangle: {
      reserved: pureFuncs,
    },
  });
  return result.code;
}

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode,
  compilationMode: values.optimize
    ? "optimize"
    : values.debug
      ? "debug"
      : "standard",
  staticFilesDir: "public",
  targets: [
    {
      type: "application",
      name: "Main",
      elmJson: "elm.json",
      inputs: ["src/Main.elm"],
      output: "public/build/main.js",
      postprocess: (code, { compilationMode }) =>
        compilationMode === "optimize" ? minify(code) : code,
    },
  ],
});

// After a successful `make`, copy `public/` to `dist/`, with content hashes in
// the file names of the JS and CSS (cache busting). `dist/` is what you would
// deploy. This is done after elm-watch is done, rather than in the postprocess
// function, since it needs to know about all files at once.
if (runMode === "make" && process.exitCode === 0) {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(PUBLIC, DIST, { recursive: true });
  let html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  for (const file of ["build/main.js", "style.css"]) {
    const hashedFile = addContentHash(path.join(DIST, file));
    html = html.replace(`"./${file}"`, `"./${hashedFile}"`);
  }
  fs.writeFileSync(path.join(DIST, "index.html"), html);
  console.log(`Production build: ${path.join(DIST, "index.html")}`);
}

/**
 * Renames for example `dist/build/main.js` to `dist/build/main.a1b2c3d4.js`,
 * and returns `build/main.a1b2c3d4.js`.
 *
 * @param {string} filePath
 * @returns {string}
 */
function addContentHash(filePath) {
  const hash = crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex")
    .slice(0, 8);
  const { dir, name, ext } = path.parse(filePath);
  const newFilePath = path.join(dir, `${name}.${hash}${ext}`);
  fs.renameSync(filePath, newFilePath);
  return path.relative(DIST, newFilePath).split(path.sep).join("/");
}
