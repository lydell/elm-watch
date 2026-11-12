// Used by Spawn.test.ts. Spawns a never-ending child process with `spawn`,
// which writes its pid to the given file. Then prints "ready" and:
//
// - exit: Exits with `process.exit(1)`.
// - wait: Waits for the test to send a signal.
// - listen: Like wait, but has its own SIGTERM listener, which prints whether
//   the child is still alive and then exits.
import * as fs from "fs";

import { spawn } from "../src/Spawn.ts";
import { markAsAbsolutePath } from "../src/Types.ts";

const [mode, pidFile] = process.argv.slice(2);

if (pidFile === undefined) {
  throw new Error("Usage: node SpawnExitScript.ts exit|wait|listen PID_FILE");
}

spawn({
  command: "node",
  args: [
    "-e",
    "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);",
    pidFile,
  ],
  options: {
    cwd: markAsAbsolutePath(import.meta.dirname),
    env: process.env,
  },
});

const interval = setInterval(() => {
  if (!fs.existsSync(pidFile) || fs.readFileSync(pidFile, "utf8") === "") {
    return;
  }
  clearInterval(interval);
  switch (mode) {
    case "exit":
      process.stdout.write("ready\n");
      process.exit(1);
      break;
    case "wait":
      process.stdout.write("ready\n");
      break;
    case "listen":
      process.on("SIGTERM", () => {
        const pid = Number(fs.readFileSync(pidFile, "utf8"));
        process.stdout.write(`child alive: ${String(isAlive(pid))}\n`);
        process.exit(0);
      });
      process.stdout.write("ready\n");
      break;
    default:
      throw new Error(`Unknown mode: ${String(mode)}`);
  }
}, 10);

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
