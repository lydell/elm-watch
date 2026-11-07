// Helper for the fake `elm` executables in the `bad-bin/` folders of the
// fixtures. Import it with `import { fakeElm } from "#fake-elm";` (see
// "imports" in package.json – that works both in tests/fixtures/ and in
// tests/fixtures-copies/).
//
// elm-watch calls `elm` in a few different ways. A fake only overrides the ones
// it is interested in – the rest are passed through to the real `elm`. That way
// a new kind of call (like when elm-watch started running `elm --version` on
// every start) doesn’t make the fakes hang or fail in confusing ways.
import { spawn } from "#spawn";
import path from "path";

export const args = process.argv.slice(2);

// - version: `elm --version`
// - install: `elm make` on a non-existent file, to install dependencies.
// - make: `elm make` for real – both with and without `--output=/dev/null`.
export const call = args.includes("--version")
  ? "version"
  : args.some((arg) => arg.includes("ElmWatchNonExistentFile"))
    ? "install"
    : "make";

export const isTypecheckOnly = args.includes("--output=/dev/null");

// Each handler returns the exit code (or a promise of it).
export function fakeElm(handlers) {
  const handler = handlers[call] ?? realElm;
  Promise.resolve(handler()).then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (error) => {
      process.stderr.write(`Fake elm crashed: ${error.stack}`);
      process.exit(1);
    },
  );
}

// Run the real `elm` with the same arguments. Resolves with the exit code.
export function realElm() {
  const child = spawn("elm", args, {
    env: {
      ...process.env,
      PATH: process.env.PATH.split(path.delimiter)
        .filter((part) => !part.includes("bad-bin"))
        .join(path.delimiter),
    },
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      resolve(exitCode ?? 1);
    });
  });
}

export function waitUntil(condition) {
  return new Promise((resolve) => {
    (function rec() {
      if (condition()) {
        resolve();
      } else {
        setTimeout(rec, 10);
      }
    })();
  });
}

// Never exit (until elm-watch kills the process).
export function hang() {
  process.stdin.resume();
  return new Promise(() => {
    // Never resolves.
  });
}
