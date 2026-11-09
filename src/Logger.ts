import * as readline from "readline";
import * as util from "util";

import {
  __ELM_WATCH_DEBUG,
  __ELM_WATCH_MOCKED_TIMINGS,
  __ELM_WATCH_NOT_TTY,
  __ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS,
  __ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS,
  type Env,
  NO_COLOR,
  WT_SESSION,
} from "./Env.ts";
import * as Errors from "./Errors.ts";
import {
  BEGIN_SYNC_UPDATE,
  bold,
  CLEAR,
  END_SYNC_UPDATE,
  type ReadStream,
  removeColor,
  silentlyReadIntEnvValue,
  type WriteStream,
} from "./Helpers.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import type { GetNow } from "./Types.ts";

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
  setRawMode: (onExit: () => void, onData?: (data: string) => void) => void;
  // Whether we read keypresses (see `setRawMode`).
  isRawMode: () => boolean;
  reset: () => void;
  queryTerminal: (
    escapes: string,
    isDone: (stdin: string) => boolean,
  ) => Promise<string | undefined>;
  withSynchronizedOutput: (callback: () => void) => void;
};

export type LoggerConfig = {
  debug: boolean;
  noColor: boolean;
  fancy: boolean;
  isTTY: boolean;
  mockedTimings: boolean;
  columns: number;
  rows: number;
};

export function makeLogger({
  env,
  getNow,
  stdin,
  stdout,
  stderr,
  logDebug,
}: {
  env: Env;
  getNow: GetNow;
  stdin: ReadStream;
  stdout: WriteStream;
  stderr: WriteStream;
  logDebug: (message: string) => void;
}): Logger {
  const noColor = NO_COLOR in env;
  const handleColor = (string: string): string =>
    noColor ? removeColor(string) : string;

  let queryTerminalStatus: QueryTerminalStatus = { tag: "NotQueried" };
  const defaultOnExit = (): void => {
    // Do nothing.
  };

  let onExit = defaultOnExit;
  let onData: ((data: string) => void) | undefined = undefined;
  const exitOnCtrlC = (data: Buffer): void => {
    const string = data.toString("utf8");
    if (string === "\x03") {
      // ctrl+c was pressed.
      onExit();
    } else {
      onData?.(string);
    }
  };

  // In my testing, getting the responses take about 1 ms on macOS (both the
  // default Terminal and iTerm), and about 10 ms on Gnome Terminal. 100 ms
  // should be plenty, while still not being _too_ slow on terminals that
  // don’t support querying colors.
  const queryTerminalTimeoutMs = silentlyReadIntEnvValue(
    env[__ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS],
    100,
  );
  const queryTerminalMaxAgeMs = silentlyReadIntEnvValue(
    env[__ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS],
    1000,
  );

  const config: LoggerConfig = {
    debug: __ELM_WATCH_DEBUG in env,
    noColor,
    fancy: (!IS_WINDOWS || WT_SESSION in env) && !noColor,
    isTTY: __ELM_WATCH_NOT_TTY in env ? false : stdout.isTTY,
    mockedTimings: __ELM_WATCH_MOCKED_TIMINGS in env,
    get columns() {
      // `.columns` is `undefined` if not a TTY.
      // This is a getter because it can change over time, if the user resizes
      // the terminal.
      return stdout.columns ?? DEFAULT_COLUMNS;
    },
    get rows() {
      // `.rows` is `undefined` if not a TTY. Then there’s no screen height to
      // worry about.
      return stdout.rows ?? Infinity;
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
        `${Errors.toTerminalString(template, config.columns, noColor)}\n`,
      );
    },
    debug(...args) {
      if (config.debug) {
        logDebug(
          args
            .map((arg, index) =>
              index === 0 && typeof arg === "string" && !noColor
                ? bold(arg)
                : util.inspect(arg, {
                    depth: Infinity,
                    colors: !noColor,
                    maxStringLength: 1000,
                  }),
            )
            .join("\n"),
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
    setRawMode(passedOnExit, passedOnData) {
      onExit = passedOnExit;
      onData = passedOnData;
      if (stdin.isTTY && stdout.isTTY && !stdin.isRaw) {
        stdin.setRawMode(true);
        stdin.on("data", exitOnCtrlC);
        stdin.resume();
      }
    },
    isRawMode() {
      return config.isTTY && stdin.isRaw;
    },
    reset() {
      onExit = defaultOnExit;
      onData = undefined;
      queryTerminalStatus = { tag: "NotQueried" };
      stdin.pause();
      stdin.off("data", exitOnCtrlC);
      if (stdin.isRaw) {
        stdin.setRawMode(false);
      }
    },
    async queryTerminal(escapes: string, isDone: (stdin: string) => boolean) {
      if (!stdin.isRaw) {
        return undefined;
      }

      const run = async (): Promise<string | undefined> => {
        const callbacks: Array<(stdin: string | undefined) => void> = [];
        queryTerminalStatus = { tag: "Querying", callbacks };
        const result = await queryTerminalHelper(
          queryTerminalTimeoutMs,
          stdin,
          stdout,
          escapes,
          isDone,
        );
        queryTerminalStatus = {
          tag: "Queried",
          stdin: result,
          date: getNow(),
        };
        for (const callback of callbacks) {
          callback(result);
        }
        return result;
      };

      switch (queryTerminalStatus.tag) {
        case "NotQueried":
          return run();

        case "Querying": {
          const { callbacks } = queryTerminalStatus;
          return new Promise<string | undefined>((resolve) => {
            callbacks.push(resolve);
          });
        }

        case "Queried":
          return getNow().getTime() - queryTerminalStatus.date.getTime() <=
            queryTerminalMaxAgeMs
            ? queryTerminalStatus.stdin
            : run();
      }
    },
    withSynchronizedOutput: (callback) => {
      if (config.isTTY) {
        stdout.write(BEGIN_SYNC_UPDATE);
        try {
          callback();
        } finally {
          stdout.write(END_SYNC_UPDATE);
        }
      } else {
        callback();
      }
    },
    config,
  };
}

type QueryTerminalStatus =
  | { tag: "NotQueried" }
  | { tag: "Queried"; stdin: string | undefined; date: Date }
  | { tag: "Querying"; callbacks: Array<(stdin: string | undefined) => void> };

async function queryTerminalHelper(
  queryTerminalTimeoutMs: number,
  stdin: ReadStream,
  stdout: WriteStream,
  escapes: string,
  isDone: (stdin: string) => boolean,
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
    }, queryTerminalTimeoutMs);
  });
}
