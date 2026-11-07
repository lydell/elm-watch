// Drop-in replacements for `child_process.spawn` and `child_process.spawnSync`
// that can run `elm` on Windows, for tests and scripts. Import it with
// `import { spawn, spawnSync } from "#spawn";` (see "imports" in package.json –
// that works both in tests/fixtures/ and in tests/fixtures-copies/).
import * as childProcess from "child_process";

const IS_WINDOWS = process.platform === "win32";

/**
 * @param {string} file
 * @param {Array<string>} args
 * @param {Omit<import("child_process").SpawnOptions, "shell">} options
 * @returns {import("child_process").ChildProcess}
 */
export function spawn(file, args, options) {
  return IS_WINDOWS
    ? // When installing Elm with npm or elm-tooling, we have
      // `node_modules/.bin/elm.cmd`, and the fake `elm`s in the tests also have
      // an `elm.cmd` next to them. `.cmd` files cannot be executed directly
      // with `child_process.spawn` – it requires a shell. When using a shell,
      // we must pass everything as a single string and escape stuff ourselves.
      childProcess.spawn(windowsCommand(file, args), {
        ...options,
        shell: true,
      })
    : childProcess.spawn(file, args, options);
}

/**
 * @param {string} file
 * @param {Array<string>} args
 * @param {Omit<import("child_process").SpawnSyncOptions, "shell" | "encoding">} options
 * @returns {import("child_process").SpawnSyncReturns<string>}
 */
export function spawnSync(file, args, options) {
  return IS_WINDOWS
    ? // See `spawn` above for why we need `shell: true` on Windows.
      childProcess.spawnSync(windowsCommand(file, args), {
        ...options,
        encoding: "utf8",
        shell: true,
      })
    : childProcess.spawnSync(file, args, { ...options, encoding: "utf8" });
}

/**
 * @param {string} file
 * @param {Array<string>} args
 * @returns {string}
 */
function windowsCommand(file, args) {
  return [file, ...args].map(windowsEscape).join(" ");
}

/**
 * @param {string} arg
 * @returns {string}
 */
function windowsEscape(arg) {
  // See `windowsEscape` in src/Spawn.ts.
  if (arg.includes('"') || arg.includes("\n") || arg.includes("\r")) {
    throw new Error(
      `The following string must not contain double quotes or newlines: ${JSON.stringify(
        arg,
      )}`,
    );
  }
  return `"${arg.replace(/%/g, '"%"')}"`;
}
