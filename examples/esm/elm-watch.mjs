// @ts-check
import { parseArgs } from "node:util";
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
      // Elm’s output is a script that sets `this.Elm`. At the top level of a
      // script, `this` is the global object (`window`). In a module, top-level
      // `this` is `undefined`. So call the code with an object of our own as
      // `this`, and export what ends up on it.
      postprocess: (code) =>
        `const output = {}; (function(){${code}}).call(output); export default output.Elm;`,
    },
  ],
});
