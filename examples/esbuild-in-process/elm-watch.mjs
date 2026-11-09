// @ts-check
import * as fs from "node:fs";
import * as path from "node:path";
import { parseArgs } from "node:util";
import { elmWatch } from "elm-watch";
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

/**
 * elm-watch owns the terminal: It clears the screen and moves the cursor
 * around to update its output. If esbuild printed to the terminal too, the two
 * would mess each other up. So esbuild is silent, and this plugin shows
 * esbuild’s errors in the browser instead: Instead of the compiled code, it
 * writes a script that displays the errors. elm-watch notices that the file
 * changed, which makes the page reload (see index.html).
 *
 * @type {esbuild.Plugin}
 */
const writeOutputOrErrors = {
  name: "write-output-or-errors",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) {
        const messages = await esbuild.formatMessages(result.errors, {
          kind: "error",
          color: false,
        });
        writeFile(
          path.join(import.meta.dirname, "public/build/app.js"),
          errorScript(messages.join("\n")),
        );
      } else {
        for (const file of result.outputFiles ?? []) {
          writeFile(file.path, file.contents);
        }
      }
    });
  },
};

/**
 * @param {string} filePath
 * @param {string | Uint8Array} contents
 */
function writeFile(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

/**
 * @param {string} message
 * @returns {string}
 */
function errorScript(message) {
  return `
console.error(${JSON.stringify(message)});
const pre = document.createElement("pre");
pre.textContent = ${JSON.stringify(`esbuild failed:\n\n${message}`)};
pre.style.cssText = "position: fixed; inset: 0; z-index: 2147483646; margin: 0; padding: 2em; overflow: auto; background: #300; color: #fdd; font-size: 14px; white-space: pre-wrap;";
document.body.append(pre);
`.trimStart();
}

// In hot mode, run esbuild in watch mode, in the same process as elm-watch.
// `write: false` means that esbuild leaves writing files to the plugin above.
const esbuildContext =
  runMode === "hot"
    ? await esbuild.context({
        ...esbuildOptions,
        write: false,
        logLevel: "silent",
        plugins: [writeOutputOrErrors],
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
