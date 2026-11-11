// @ts-check
import { parseArgs } from "node:util";
import { createErrorReporter, elmWatch } from "elm-watch";
import * as esbuild from "esbuild";

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

/** @type {esbuild.BuildOptions} */
const esbuildOptions = {
  absWorkingDir: import.meta.dirname,
  entryPoints: ["ts/main.ts"],
  bundle: true,
  format: "esm",
  outfile: "public/build/app.js",
};

// elm-watch owns the terminal: It clears the screen and moves the cursor
// around to update its output. If esbuild printed to the terminal too, the two
// would mess each other up. So esbuild is silent, and its errors are shown by
// elm-watch instead, in the terminal and in the browser, just like Elm errors.
const errors = createErrorReporter();

/** @type {esbuild.Plugin} */
const reportErrors = {
  name: "report-errors",
  setup(build) {
    build.onEnd(async (result) => {
      // esbuild’s formatted messages include a code excerpt.
      const messages = await esbuild.formatMessages(result.errors, {
        kind: "error",
        color: true,
      });
      // An empty array clears the errors.
      errors.set(
        "esbuild",
        result.errors.map((error, index) => ({
          message: messages[index] ?? error.text,
          location:
            error.location === null
              ? undefined
              : {
                  file: error.location.file,
                  line: error.location.line,
                  // esbuild’s columns start at 0, elm-watch’s at 1.
                  column: error.location.column + 1,
                },
        })),
      );
    });
  },
};

// In hot mode, run esbuild in watch mode, in the same process as elm-watch.
// When there are errors, esbuild doesn’t write `app.js`, so the last working
// version keeps running in the browser.
const esbuildContext =
  runMode === "hot"
    ? await esbuild.context({
        ...esbuildOptions,
        logLevel: "silent",
        plugins: [reportErrors],
      })
    : undefined;

await esbuildContext?.watch();

process.exitCode = await elmWatch({
  root: import.meta.dirname,
  runMode,
  compilationMode: values.optimize
    ? "optimize"
    : values.debug
      ? "debug"
      : "standard",
  staticFilesDir: "public",
  errors,
  targets: [
    {
      type: "application",
      name: "Main",
      elmJson: "elm.json",
      inputs: ["src/Main.elm"],
      output: "public/build/main.js",
      // Minify the Elm code with esbuild in optimize mode. `esbuild.transform`
      // works on a string, just like a postprocess function.
      postprocess: async (code, { compilationMode }) =>
        compilationMode === "optimize"
          ? (await esbuild.transform(code, { minify: true })).code
          : code,
    },
  ],
});

await esbuildContext?.dispose();

// In make mode, build the TypeScript after elm-watch is done. Then nobody else
// is using the terminal, so esbuild can print errors (and a summary) there.
if (runMode === "make" && process.exitCode === 0) {
  try {
    await esbuild.build({
      ...esbuildOptions,
      minify: true,
      logLevel: "info",
    });
  } catch {
    // esbuild has already printed the errors.
    process.exitCode = 1;
  }
}
