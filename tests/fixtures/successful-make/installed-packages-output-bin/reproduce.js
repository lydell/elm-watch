import { spawnSync } from "#spawn";
import fs from "fs";
import path from "path";

const elmHome = path.join(import.meta.dirname, "elm-home");
const mainDir = path.join(import.meta.dirname, "..");
const elmStuff = path.join(mainDir, "elm-stuff");
const input = path.join(mainDir, "src", "Main.elm");

fs.rmSync(elmHome, { recursive: true, force: true });
fs.rmSync(elmStuff, { recursive: true, force: true });

const result = spawnSync("elm", ["make", input, "--output=/dev/null"], {
  env: {
    ...process.env,
    ELM_HOME: elmHome,
  },
});

console.log("STDOUT:");
console.log(JSON.stringify(result.stdout));
console.log("STDERR:");
console.log(JSON.stringify(result.stderr));
console.log("exit", result.status);

fs.rmSync(elmHome, { recursive: true, force: true });
