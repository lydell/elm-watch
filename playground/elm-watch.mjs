// @ts-check
import { exec } from "node:child_process";
import * as http from "node:http";
import { parseArgs, promisify } from "node:util";
import { elmWatch } from "elm-watch";
import { generate } from "./generate.js";
import { postprocessFor } from "./postprocess.js";

// Usage:
//
//     node --watch elm-watch.mjs hot
//     node elm-watch.mjs make --optimize
//     node elm-watch.mjs make --optimize Html Sandbox
//     node --watch elm-watch.mjs hot --generated
//     node --watch elm-watch.mjs hot --generated --scale=3
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    debug: { type: "boolean", default: false },
    optimize: { type: "boolean", default: false },
    // Generate lots of targets, see generate.js.
    generated: { type: "boolean", default: false },
    // Make the large generated targets larger (slower to compile).
    scale: { type: "string", default: "1" },
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
  ...(values.generated
    ? generate(import.meta.dirname, Number(values.scale)).map((t) =>
        target(t.name, t.inputs, t.output, t.elmJson),
      )
    : []),
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
  staticFilesDir: "public",
  targets: enabledTargets,
  createServer: ({ onRequest, onUpgrade }) =>
    http
      .createServer((request, response) => {
        // Visit any page via cached.localhost to test that hot reloading
        // works even if the browser has cached the compiled Elm code.
        if (request.headers.host?.startsWith("cached.localhost:") === true) {
          response.setHeader("Cache-Control", "max-age=3600");
        }
        onRequest(request, response);
      })
      .on("upgrade", onUpgrade),
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
