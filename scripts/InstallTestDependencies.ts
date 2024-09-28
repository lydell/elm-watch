/* eslint-disable no-console */
import { spawn } from "cross-spawn";
import * as fs from "fs";
import * as path from "path";

const INSTALL_PACKAGES_DIR = path.join(
  __dirname,
  "..",
  "tests",
  "install-packages",
);

async function install(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("elm", ["make", "Main.elm", "--output=/dev/null"], {
      cwd: INSTALL_PACKAGES_DIR,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      const exitCode = code ?? (signal !== null ? 128 + signal : -1);
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`elm exited with: ${exitCode}`));
      }
    });
  });
}

async function run(): Promise<void> {
  // Installing packages sometimes fails in CI, especially on macOS.
  // Try several times.
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await install();
      return;
    } catch (error) {
      console.warn(
        `Attempt ${attempt}/${maxRetries}:`,
        error instanceof Error ? error.message : error,
      );
      fs.rmSync(path.join(INSTALL_PACKAGES_DIR, "elm-stuff"), {
        recursive: true,
        force: true,
      });
    }
  }
  throw new Error("Failed to install Elm dependencies.");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
