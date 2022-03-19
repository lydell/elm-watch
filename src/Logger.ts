import * as readline from "readline";
import * as util from "util";

import {
  __ELM_WATCH_DEBUG,
  __ELM_WATCH_FANCY_EVEN_ON_WINDOWS,
  __ELM_WATCH_NOT_TTY,
  __ELM_WATCHED_MOCKED_TIMINGS,
  Env,
  NO_COLOR,
} from "./Env";
import { ErrorTemplate } from "./Errors";
import { bold, CLEAR, join, removeColor, WriteStream } from "./Helpers";
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
  logDebug,
}: {
  env: Env;
  stdout: WriteStream;
  stderr: WriteStream;
  logDebug: (message: string) => void;
}): Logger {
  const noColor = NO_COLOR in env;
  const handleColor = (string: string): string =>
    noColor ? removeColor(string) : string;

  const config: LoggerConfig = {
    debug: __ELM_WATCH_DEBUG in env,
    fancy:
      // istanbul ignore next
      (!IS_WINDOWS || __ELM_WATCH_FANCY_EVEN_ON_WINDOWS in env) && !noColor,
    isTTY:
      __ELM_WATCH_NOT_TTY in env
        ? /* istanbul ignore next */ false
        : stdout.isTTY,
    mockedTimings: __ELM_WATCHED_MOCKED_TIMINGS in env,
    get columns() {
      // `.columns` is `undefined` if not a TTY.
      // This is a getter because it can change over time, if the user resizes
      // the terminal.
      // istanbul ignore next
      return stdout.columns ?? 80;
    },
  };

  return {
    write(message) {
      stdout.write(`${handleColor(message)}\n`);
    },
    writeToStderrMakesALotOfSenseHere(message: string) {
      stderr.write(`${handleColor(message)}\n`);
    },
    errorTemplate(template) {
      stdout.write(`${handleColor(template(config.columns))}\n`);
    },
    // istanbul ignore next
    debug(...args) {
      if (config.debug) {
        logDebug(
          join(
            args.map((arg, index) =>
              index === 0 && typeof arg === "string" && !noColor
                ? bold(arg)
                : util.inspect(arg, {
                    depth: Infinity,
                    colors: !noColor,
                    maxStringLength: 1000,
                  })
            ),
            "\n"
          )
        );
      }
    },
    clearScreen(): void {
      if (config.isTTY) {
        stdout.write(CLEAR);
      }
    },
    clearScreenDown(): void {
      if (config.isTTY) {
        readline.clearScreenDown(stdout);
      }
    },
    clearLine(dir: readline.Direction) {
      if (config.isTTY) {
        readline.clearLine(stdout, dir);
      }
    },
    moveCursor(dx: number, dy: number) {
      if (config.isTTY) {
        readline.moveCursor(stdout, dx, dy);
      }
    },
    config,
  };
}
