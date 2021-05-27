// Run this script with your Internet connection turned off!

const crossSpawn = require("cross-spawn");
const fs = require("fs");
const path = require("path");

const elmHome = path.join(__dirname, "elm-home");
const mainDir = path.join(__dirname, "..", "..");
const elmStuff = path.join(mainDir, "elm-stuff");
const input = path.join(mainDir, "src", "App.elm");

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
console.log(result.stdout);
console.log("STDERR:");
console.log(result.stderr);
console.log("exit", result.status);

fs.rmSync(elmHome, { recursive: true, force: true });
