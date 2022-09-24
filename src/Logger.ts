import * as readline from "readline";
import * as util from "util";

import {
  __ELM_WATCH_DEBUG,
  __ELM_WATCH_MOCKED_TIMINGS,
  __ELM_WATCH_NOT_TTY,
  Env,
  NO_COLOR,
  WT_SESSION,
} from "./Env";
import * as Errors from "./Errors";
import {
  bold,
  CLEAR,
  join,
  ReadStream,
  removeColor,
  WriteStream,
} from "./Helpers";
import { IS_WINDOWS } from "./IsWindows";

export const DEFAULT_COLUMNS = 80;

export type Logger = {
  config: LoggerConfig;
  // The default is to write to `stdout`. `stderr` is used for debug logging.
  // But if there’s a use case for `elm-watch something 2>/dev/null` – use
  // `writeToStderrMakesALotOfSenseHere`.
  write: (message: string) => void;
  writeToStderrMakesALotOfSenseHere: (message: string) => void;
  errorTemplate: (template: Errors.ErrorTemplate) => void;
  debug: typeof console.debug;
  clearScreen: () => void;
  clearScreenDown: () => void;
  clearLine: (dir: readline.Direction) => void;
  moveCursor: (dx: number, dy: number) => void;
  queryTerminal: (
    escapes: string,
    isDone: (stdin: string) => boolean
  ) => Promise<string | undefined>;
};

export type LoggerConfig = {
  debug: boolean;
  noColor: boolean;
  fancy: boolean;
  isTTY: boolean;
  mockedTimings: boolean;
  columns: number;
};

export function makeLogger({
  env,
  stdin,
  stdout,
  stderr,
  logDebug,
}: {
  env: Env;
  stdin: ReadStream;
  stdout: WriteStream;
  stderr: WriteStream;
  logDebug: (message: string) => void;
}): Logger {
  const noColor = NO_COLOR in env;
  const handleColor = (string: string): string =>
    noColor ? removeColor(string) : string;

  const config: LoggerConfig = {
    debug: __ELM_WATCH_DEBUG in env,
    noColor,
    fancy:
      // istanbul ignore next
      (!IS_WINDOWS || WT_SESSION in env) && !noColor,
    isTTY:
      __ELM_WATCH_NOT_TTY in env
        ? /* istanbul ignore next */ false
        : stdout.isTTY,
    mockedTimings: __ELM_WATCH_MOCKED_TIMINGS in env,
    get columns() {
      // `.columns` is `undefined` if not a TTY.
      // This is a getter because it can change over time, if the user resizes
      // the terminal.
      // istanbul ignore next
      return stdout.columns ?? DEFAULT_COLUMNS;
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
      stdout.write(
        `${Errors.toTerminalString(template, config.columns, noColor)}\n`
      );
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
    async queryTerminal(escapes: string, isDone: (stdin: string) => boolean) {
      return queryTerminal(stdin, stdout, escapes, isDone);
    },
    config,
  };
}

async function queryTerminal(
  stdin: ReadStream,
  stdout: WriteStream,
  escapes: string,
  isDone: (stdin: string) => boolean
): Promise<string | undefined> {
  if (!stdin.isTTY || !stdout.isTTY) {
    return undefined;
  }
  try {
    stdin.setRawMode(true);
    stdin.resume();
    return await queryTerminalHelper(stdin, stdout, escapes, isDone);
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

/**
 * @returns {Promise<Theme>}
 */
async function queryTerminalHelper(
  stdin: ReadStream,
  stdout: WriteStream,
  escapes: string,
  isDone: (stdin: string) => boolean
): Promise<string | undefined> {
  return new Promise((resolve) => {
    let stdinString = "";

    const onStdin = (data: Buffer): void => {
      stdinString += data.toString("utf8");
      if (isDone(stdinString)) {
        clearTimeout(timeoutId);
        stdin.off("data", onStdin);
        resolve(stdinString);
      }
    };

    stdin.on("data", onStdin);

    stdout.write(escapes);

    const timeoutId = setTimeout(() => {
      stdin.off("data", onStdin);
      resolve(undefined);
    }, 10);
  });
}
