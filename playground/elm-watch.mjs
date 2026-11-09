// @ts-check
import { exec } from "node:child_process";
import { parseArgs, promisify } from "node:util";
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
 * @param {string} [elmJson]
 * @returns {import("elm-watch").Target}
 */
function target(name, inputs, output, elmJson = "elm.json") {
  return {
    type: "application",
    name,
    elmJson,
    inputs,
    output,
    postprocess: postprocessFor(name),
  };
}

const targets = [
  target("Html", ["src/HtmlMain.elm"], "public/build/HtmlMain.js"),
  target("Sandbox", ["src/SandboxMain.elm"], "public/build/SandboxMain.js"),
  target("Element", ["src/ElementMain.elm"], "public/build/ElementMain.js"),
  target("Document", ["src/DocumentMain.elm"], "public/build/DocumentMain.js"),
  target("Hostile", ["src/HostileMain.elm"], "public/build/HostileMain.js"),
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
    "public/submodules/azimutt/elm.json",
  ),
  target(
    "🇨🇦 Concourse",
    ["public/submodules/concourse/web/elm/src/Main.elm"],
    "public/submodules/concourse/web/public/elm.min.js",
    "public/submodules/concourse/web/elm/elm.json",
  ),
  target(
    "🧖🏼 Elm SPA Example",
    ["public/submodules/elm-spa-example/src/Main.elm"],
    "public/submodules/elm-spa-example/elm-output.js",
    "public/submodules/elm-spa-example/elm.json",
  ),
  target(
    "🇩🇪 Kite",
    ["public/submodules/kite/src/Main.elm"],
    "public/submodules/kite/dist/elm.js",
    "public/submodules/kite/elm.json",
  ),
  target(
    "🇬🇧 Seeds Game",
    ["public/submodules/seeds-game/src/elm/Main.elm"],
    "public/submodules/seeds-game/dist/Main.js",
    "public/submodules/seeds-game/elm.json",
  ),
  target(
    "✂️ Unison Share",
    ["public/submodules/codebase-ui/src/UnisonShare.elm"],
    "public/submodules/codebase-ui/dist/UnisonShare.js",
    "public/submodules/codebase-ui/elm.json",
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
  // For example, ELM_WATCH_HOST=0.0.0.0 exposes the server on the local network.
  host: process.env.ELM_WATCH_HOST,
  openEditor: openEditorFromEnv(),
});

// Opens error locations that you click in the browser UI in your editor.
// Each developer can choose their editor by setting the ELM_WATCH_OPEN_EDITOR
// environment variable, like with the elm-watch command:
// https://lydell.github.io/elm-watch/browser-ui/#clickable-error-locations
/** @returns {import("elm-watch").OpenEditor | undefined} */
function openEditorFromEnv() {
  const command = process.env.ELM_WATCH_OPEN_EDITOR;
  if (command === undefined) {
    return undefined;
  }
  const execAsync = promisify(exec);
  return async ({ file, line, column }) => {
    await execAsync(command, {
      cwd: import.meta.dirname,
      env: {
        ...process.env,
        file,
        line: line.toString(),
        column: column.toString(),
      },
      timeout: 5000,
    });
  };
}
