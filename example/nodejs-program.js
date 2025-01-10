import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

async function run() {
  globalThis.ELM_WATCH_FULL_RELOAD = restart;

  const elmPath = path.join(
    import.meta.dirname,
    "public",
    "build",
    "NodeJS.js",
  );

  let app;

  try {
    const Elm = getElm(elmPath);
    app = Elm.NodeJS.init();
  } catch (error) {
    if (error.code === "ENOENT") {
      // If the Elm JS file does not exist yet, wait for it to be created
      // (when elm-watch is started).
      fs.mkdirSync(path.dirname(elmPath), { recursive: true });
      fs.watch(path.dirname(elmPath), (_, filename) => {
        if (filename === path.basename(elmPath)) {
          restart();
        }
      });
      console.warn("Watching for file to be created:", elmPath);
    } else {
      // Other errors are most likely from the proxy file throwing about parts of
      // `Elm` not being available yet. Then we want to wait for the elm-watch client
      // to receive a message that it needs to do a full reload.
      console.error(error.message);
      console.warn("Waiting for changes…");
    }
    return;
  }

  app.ports.toJs.subscribe(([message, count]) => {
    console.log(count, "|", message);
  });

  console.log("Write something and press Enter.");
  for await (const line of readline.createInterface({ input: process.stdin })) {
    app.ports.fromJs.send(line);
  }
}

// This imports compiled Elm JS by reading the file and then eval-ing it.
//
// It is also possible import an Elm module like this:
//
// import { createRequire } from "module";
// const require = createRequire(import.meta.url);
// const { Elm } = require(elmPath);
//
// The downside is that `node --watch` will then reload the whole program
// whenever the compiled Elm JS file changes, which means that hot reloading
// is never used.
function getElm(elmPath) {
  const code = fs.readFileSync(elmPath, "utf-8");
  const f = new Function(code);
  const output = {};
  f.call(output);
  return output.Elm;
}

function restart() {
  // Since this program is run with `node --watch`, touching this
  // file causes the program to be restarted.
  touch(import.meta.filename);
}

function touch(filePath) {
  const now = new Date();
  fs.utimesSync(filePath, now, now);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
