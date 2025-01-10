import crossSpawn from "cross-spawn";
import path from "path";

const mainDir = path.join(import.meta.dirname, "..", "..");
const input = path.join(mainDir, "src", "App.elm");

const result = crossSpawn.sync("elm", ["make", input, "--output=.js"], {
  encoding: "utf8",
});

console.log("STDOUT:");
console.log(result.stdout);
console.log("STDERR:");
console.log(result.stderr);
console.log("exit", result.status);
