// @ts-check
import { parseArgs } from "node:util";
import { elmWatch } from "elm-watch";
import { postprocessFor } from "./postprocess.js";

// Usage:
//
//     node --watch elm-watch.mjs hot
//     node elm-watch.mjs make --optimize
//     node elm-watch.mjs make --optimize Html Sandbox
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    debug: { type: "boolean", default: false },
    optimize: { type: "boolean", default: false },
  },
});

const [runMode = "hot", ...targetNames] = positionals;

if (runMode !== "hot" && runMode !== "make") {
  console.error(`Expected "hot" or "make", but got: ${runMode}`);
  process.exit(1);
}

/**
 * @param {string} name
 * @param {[string, ...Array<string>]} inputs
 * @param {string} output
 * @returns {import("elm-watch").Target}
 */
function target(name, inputs, output) {
  return { name, inputs, output, postprocess: postprocessFor(name) };
}

const targets = [
  target("Html", ["src/HtmlMain.elm"], "public/build/HtmlMain.js"),
  target("Sandbox", ["src/SandboxMain.elm"], "public/build/SandboxMain.js"),
  target("Element", ["src/ElementMain.elm"], "public/build/ElementMain.js"),
  target("Document", ["src/DocumentMain.elm"], "public/build/DocumentMain.js"),
  target(
    "Application",
    ["src/ApplicationMain.elm"],
    "public/build/ApplicationMain.js",
  ),
  target("Worker", ["src/WorkerMain.elm"], "public/build/WorkerMain.js"),
  target("WorkerESM", ["src/WorkerMain.elm"], "public/build/WorkerMainESM.js"),
  target(
    "Frankenstein",
    [
      "src/ApplicationMain.elm",
      "src/DocumentMain.elm",
      "src/ElementMain.elm",
      "src/HtmlMain.elm",
      "src/SandboxMain.elm",
      "src/WorkerMain.elm",
    ],
    "public/build/Frankenstein.js",
  ),
  target("ESM", ["src/HtmlMain.elm"], "public/build/ESM.js"),
  target("Node.js", ["src/NodeJS.elm"], "public/build/NodeJS.js"),
  target(
    "🇫🇷 Azimutt",
    ["public/submodules/azimutt/.elm-spa/defaults/Main.elm"],
    "public/submodules/azimutt/public/dist/elm.js",
  ),
  target(
    "🇨🇦 Concourse",
    ["public/submodules/concourse/web/elm/src/Main.elm"],
    "public/submodules/concourse/web/public/elm.min.js",
  ),
  target(
    "🧖🏼 Elm SPA Example",
    ["public/submodules/elm-spa-example/src/Main.elm"],
    "public/submodules/elm-spa-example/elm-output.js",
  ),
  target(
    "🇩🇪 Kite",
    ["public/submodules/kite/src/Main.elm"],
    "public/submodules/kite/dist/elm.js",
  ),
  target(
    "🇬🇧 Seeds Game",
    ["public/submodules/seeds-game/src/elm/Main.elm"],
    "public/submodules/seeds-game/dist/Main.js",
  ),
  target(
    "✂️ Unison Share",
    ["public/submodules/codebase-ui/src/UnisonShare.elm"],
    "public/submodules/codebase-ui/dist/UnisonShare.js",
  ),
];

const enabledTargets =
  targetNames.length === 0
    ? targets
    : targets.filter((t) => targetNames.includes(t.name));

if (enabledTargets.length === 0) {
  console.error(
    `No targets match: ${targetNames.join(", ")}\nAvailable targets:\n${targets.map((t) => t.name).join("\n")}`,
  );
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
  targets: enabledTargets,
});
