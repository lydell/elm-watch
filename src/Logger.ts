import * as readline from "readline";
import * as util from "util";

import { ErrorTemplate } from "./Errors";
import { bold, CLEAR, Env, join, removeColor, WriteStream } from "./Helpers";
import { IS_WINDOWS } from "./IsWindows";

export type Logger = {
  config: LoggerConfig;
  // The default is to write to `stdout`. `stderr` is used for debug logging.
  // But if there’s a use case for `elm-watch something 2>/dev/null` – use
  // `writeToStderrMakesALotOfSenseHere`.
  write: (message: string) => void;
  writeToStderrMakesALotOfSenseHere: (message: string) => void;
  errorTemplate: (template: ErrorTemplate) => void;
  debug: typeof console.debug;
  clearScreen: () => void;
  clearScreenDown: () => void;
  clearLine: (dir: readline.Direction) => void;
  moveCursor: (dx: number, dy: number) => void;
};

export type LoggerConfig = {
  debug: boolean;
  fancy: boolean;
  isTTY: boolean;
  mockedTimings: boolean;
  columns: number;
};

export function makeLogger({
  env,
  stdout,
  stderr,
}: {
  env: Env;
  stdout: WriteStream;
  stderr: WriteStream;
}): Logger {
  // This enables `logger.debug()` calls (written to stderr).
  // Since the stuff written to stdout uses cursor movements,
  // you probably want to make `isTTY` below be `false` (disables
  // cursor movements), or redirect stderr to a file.
  const DEBUG = "__ELM_WATCH_DEBUG" in env;

  const NO_COLOR = "NO_COLOR" in env;
  const handleColor = (string: string): string =>
    NO_COLOR ? removeColor(string) : string;

  // `.columns` is `undefined` if not a TTY.
  const columns = stdout.columns ?? 80;
  const isTTY =
    "__ELM_WATCH_NOT_TTY" in env
      ? /* istanbul ignore next */ false
      : stdout.isTTY;

  return {
    write(message) {
      stdout.write(`${handleColor(message)}\n`);
    },
    writeToStderrMakesALotOfSenseHere(message: string) {
      stderr.write(`${handleColor(message)}\n`);
    },
    errorTemplate(template) {
      stdout.write(`${handleColor(template(columns))}\n`);
    },
    // istanbul ignore next
    debug(...args) {
      if (DEBUG) {
        stderr.write(
          `${join(
            args.map((arg, index) =>
              index === 0 && typeof arg === "string" && !NO_COLOR
                ? bold(arg)
                : util.inspect(arg, {
                    depth: Infinity,
                    colors: !NO_COLOR,
                    maxStringLength: 1000,
                  })
            ),
            "\n"
          )}\n`
        );
      }
    },
    clearScreen(): void {
      if (isTTY) {
        stdout.write(CLEAR);
      }
    },
    clearScreenDown(): void {
      if (isTTY) {
        readline.clearScreenDown(stdout);
      }
    },
    clearLine(dir: readline.Direction) {
      if (isTTY) {
        readline.clearLine(stdout, dir);
      }
    },
    moveCursor(dx: number, dy: number) {
      if (isTTY) {
        readline.moveCursor(stdout, dx, dy);
      }
    },
    config: {
      debug: DEBUG,
      fancy: !IS_WINDOWS && !NO_COLOR,
      isTTY,
      mockedTimings: "__ELM_WATCHED_MOCKED_TIMINGS" in env,
      columns,
    },
  };
}
