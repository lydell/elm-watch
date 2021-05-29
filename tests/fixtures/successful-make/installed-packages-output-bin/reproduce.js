const crossSpawn = require("cross-spawn");
const fs = require("fs");
const path = require("path");

const elmHome = path.join(__dirname, "elm-home");
const mainDir = path.join(__dirname, "..");
const elmStuff = path.join(mainDir, "elm-stuff");
const input = path.join(mainDir, "src", "Main.elm");

fs.rmSync(elmHome, { recursive: true, force: true });
fs.rmSync(elmStuff, { recursive: true, force: true });

const result = crossSpawn.sync("elm", ["make", input, "--output=/dev/null"], {
  encoding: "utf8",
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
