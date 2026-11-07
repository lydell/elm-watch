import { spawnSync } from "#spawn";
import path from "path";

const mainDir = path.join(import.meta.dirname, "..", "..");
const input = path.join(mainDir, "src", "App.elm");

const result = spawnSync("elm", ["make", input, "--output=.js"], {});

console.log("STDOUT:");
console.log(result.stdout);
console.log("STDERR:");
console.log(result.stderr);
console.log("exit", result.status);
