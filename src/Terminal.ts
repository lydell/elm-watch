import * as readline from "readline";
import * as util from "util";

import {
  __ELM_WATCH_DEBUG,
  __ELM_WATCH_MOCKED_TIMINGS,
  __ELM_WATCH_NOT_TTY,
  __ELM_WATCH_QUERY_TERMINAL_MAX_AGE_MS,
  __ELM_WATCH_QUERY_TERMINAL_TIMEOUT_MS,
  type Env,
  getEnvValue,
  INIT_CWD,
  NO_COLOR,
  TERM_PROGRAM,
  WT_SESSION,
} from "./Env.ts";
import * as Errors from "./Errors.ts";
import {
  BEGIN_SYNC_UPDATE,
  bold,
  CLEAR,
  END_SYNC_UPDATE,
  HIDE_CURSOR,
  type ReadStream,
  removeColor,
  SHOW_CURSOR,
  silentlyReadIntEnvValue,
  type WriteStream,
} from "./Helpers.ts";
import { IS_WINDOWS } from "./IsWindows.ts";
import { absolutePathFromString } from "./PathHelpers.ts";
import type { AbsolutePath, GetNow } from "./Types.ts";

export const DEFAULT_COLUMNS = 80;

// Things at the end of lines (such as timings) are right-aligned at this many
// columns at most, so they aren’t too far away on wide terminals.
export const MAX_ALIGN_COLUMNS = 100;

export type Terminal = {
  config: TerminalConfig;
  // The default is to write to `stdout`. `stderr` is used for debug logging.
  // But if there’s a use case for `elm-watch something 2>/dev/null` – use
  // `writeToStderrMakesALotOfSenseHere`.
  write: (message: string) => void;
  // Leaves the cursor at the end of the last line, so that the last line can be
  // at the very bottom of the screen. The next write adds the newline first.
  writeWithoutTrailingNewline: (message: string) => void;
  writeToStderrMakesALotOfSenseHere: (message: string) => void;
  errorTemplate: (template: Errors.ErrorTemplate) => void;
  debug: typeof console.debug;
  clearScreen: () => void;
  clearScreenDown: () => void;
  clearLine: (dir: readline.Direction) => void;
  // Move the cursor to the start of the last `numLines` lines printed, and
  // clear them, for printing them again.
  clearLastLines: (numLines: number) => void;
  moveCursor: (dx: number, dy: number) => void;
  setRawMode: (onExit: () => void, onData?: (data: string) => void) => void;
  // Whether we read keypresses (see `setRawMode`). Requires both stdin and
  // stdout to be TTYs (`config.isTTY`).
  isRawMode: () => boolean;
  reset: () => void;
  query: (
    escapes: string,
    isDone: (stdin: string) => boolean,
  ) => Promise<string | undefined>;
  withSynchronizedOutput: (callback: () => void) => void;
};

export type TerminalConfig = {
  debug: boolean;
  noColor: boolean;
  fancy: boolean;
  isTTY: boolean;
  mockedTimings: boolean;
  columns: number;
  rows: number;
  // Paths in errors are shown relative to this: The directory of your shell
  // (`INIT_CWD` when run via an npm script). Terminals like iTerm2 can then
  // open them when clicked.
  pathsRelativeTo: AbsolutePath;
};

export function makeTerminal({
  cwd,
  env,
  getNow,
  stdin,
  stdout,
  stderr,
  logDebug,
}: {
  cwd: AbsolutePath;
  env: Env;
  getNow: GetNow;
  stdin: ReadStream;
  stdout: WriteStream;
  stderr: WriteStream;
  logDebug: (message: string) => void;
}): Terminal {
  const noColor = getEnvValue(env, NO_COLOR) !== undefined;
  // The old Windows console does not support emoji, and does not answer
  // terminal queries. Windows Terminal (tested with version 1.24) and the VS
  // Code terminal (tested with version 1.146) do.
  const isModernTerminal =
    !IS_WINDOWS || WT_SESSION in env || env[TERM_PROGRAM] === "vscode";
  const handleColor = (string: string): string =>
    noColor ? removeColor(string) : string;

  // Keyed by the escapes sent, since different queries get different
  // responses. Missing means not queried.
  const queryTerminalStatuses = new Map<string, QueryTerminalStatus>();
  const defaultOnExit = (): void => {
    // Do nothing.
  };

  let onExit = defaultOnExit;
  let onData: ((data: string) => void) | undefined = undefined;
  let cursorHidden = false;
  // Raw mode might already be enabled (and stdin flowing) by whoever uses
  // elm-watch via the JavaScript API. Then we still need to listen, but should
  // leave raw mode enabled and stdin flowing.
  let listeningToStdin = false;
  let enabledRawMode = false;
  let resumedStdin = false;
  let needsNewline = false;
  // Nested `withSynchronizedOutput` calls must not end the update early.
  let synchronizedOutputDepth = 0;
  const newlineIfNeeded = (): string => {
    if (needsNewline) {
      needsNewline = false;
      return "\n";
    }
    return "";
  };
  // stderr usually goes to the same terminal as stdout, so end the last line
  // on stdout before writing to stderr.
  const endStdoutLine = (): void => {
    if (needsNewline) {
      stdout.write(newlineIfNeeded());
    }
  };
  const exitOnCtrlC = (data: Buffer): void => {
    const string = data.toString("utf8");
    if (string.includes("\x03")) {
      // ctrl+c was pressed (possibly together with other keys).
      onExit();
    } else {
      // This also receives responses to `query`, including late ones
      // arriving after the timeout. `ErrorView.parseKeys` ignores those.
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

  const config: TerminalConfig = {
    debug: __ELM_WATCH_DEBUG in env,
    noColor,
    // Emoji (not supported by the old Windows console) are used as status
    // indicators, which partly rely on color. Use text instead without color.
    fancy: isModernTerminal && !noColor,
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
    pathsRelativeTo: absolutePathFromString(
      cwd,
      getEnvValue(env, INIT_CWD) ?? ".",
    ),
  };

  return {
    write(message) {
      stdout.write(`${newlineIfNeeded()}${handleColor(message)}\n`);
    },
    writeWithoutTrailingNewline(message) {
      stdout.write(`${newlineIfNeeded()}${handleColor(message)}`);
      needsNewline = true;
    },
    writeToStderrMakesALotOfSenseHere(message: string) {
      endStdoutLine();
      stderr.write(`${handleColor(message)}\n`);
    },
    errorTemplate(template) {
      stdout.write(
        `${newlineIfNeeded()}${Errors.toTerminalString(template, config.columns, noColor)}\n`,
      );
    },
    debug(...args) {
      if (config.debug) {
        endStdoutLine();
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
        needsNewline = false;
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
    clearLastLines(numLines: number) {
      if (config.isTTY && numLines > 0) {
        if (needsNewline) {
          // The cursor is at the end of the last line, rather than at the
          // start of the line below it.
          readline.cursorTo(stdout, 0);
          readline.moveCursor(stdout, 0, -(numLines - 1));
          needsNewline = false;
        } else {
          readline.moveCursor(stdout, 0, -numLines);
        }
        readline.clearScreenDown(stdout);
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
      if (stdin.isTTY && config.isTTY && !listeningToStdin) {
        if (!stdin.isRaw) {
          stdin.setRawMode(true);
          enabledRawMode = true;
        }
        // Check before adding the listener, since that resumes stdin too.
        resumedStdin = stdin.readableFlowing !== true;
        stdin.on("data", exitOnCtrlC);
        stdin.resume();
        listeningToStdin = true;
        // We only take keypresses, no typing, so the cursor is just noise.
        stdout.write(HIDE_CURSOR);
        cursorHidden = true;
      }
    },
    isRawMode() {
      // Not `stdin.isRaw`: Whoever uses elm-watch via the JavaScript API might
      // have enabled raw mode without us listening.
      return listeningToStdin;
    },
    reset() {
      onExit = defaultOnExit;
      onData = undefined;
      queryTerminalStatuses.clear();
      if (listeningToStdin) {
        stdin.off("data", exitOnCtrlC);
        listeningToStdin = false;
      }
      if (resumedStdin) {
        stdin.pause();
        resumedStdin = false;
      }
      if (enabledRawMode) {
        stdin.setRawMode(false);
        enabledRawMode = false;
      }
      if (cursorHidden) {
        stdout.write(SHOW_CURSOR);
        cursorHidden = false;
      }
      // Don’t leave the shell prompt (or anything else) on the same line as
      // the last thing we printed.
      stdout.write(newlineIfNeeded());
    },
    async query(escapes: string, isDone: (stdin: string) => boolean) {
      // Raw mode is needed to read the response without it being echoed. A TTY
      // is needed so we don’t write the escapes into a file or pipe.
      if (!stdin.isRaw || !config.isTTY) {
        return undefined;
      }
      // Save the old Windows console the timeout.
      if (!isModernTerminal) {
        return undefined;
      }

      const run = async (): Promise<string | undefined> => {
        const callbacks: Array<(stdin: string | undefined) => void> = [];
        const querying: QueryTerminalStatus = { tag: "Querying", callbacks };
        queryTerminalStatuses.set(escapes, querying);
        const result = await queryTerminalHelper({
          timeoutMs: queryTerminalTimeoutMs,
          stdin,
          stdout,
          escapes,
          isDone,
        });
        // Don’t cache the result if `reset` was called during the query.
        if (queryTerminalStatuses.get(escapes) === querying) {
          queryTerminalStatuses.set(escapes, {
            tag: "Queried",
            stdin: result,
            date: getNow(),
          });
        }
        for (const callback of callbacks) {
          callback(result);
        }
        return result;
      };

      const status = queryTerminalStatuses.get(escapes);

      if (status === undefined) {
        return run();
      }

      switch (status.tag) {
        case "Querying": {
          const { callbacks } = status;
          return new Promise<string | undefined>((resolve) => {
            callbacks.push(resolve);
          });
        }

        case "Queried":
          return getNow().getTime() - status.date.getTime() <=
            queryTerminalMaxAgeMs
            ? status.stdin
            : run();
      }
    },
    withSynchronizedOutput: (callback) => {
      if (!config.isTTY) {
        callback();
        return;
      }
      if (synchronizedOutputDepth === 0) {
        stdout.write(BEGIN_SYNC_UPDATE);
      }
      synchronizedOutputDepth++;
      try {
        callback();
      } finally {
        synchronizedOutputDepth--;
        if (synchronizedOutputDepth === 0) {
          stdout.write(END_SYNC_UPDATE);
        }
      }
    },
    config,
  };
}

type QueryTerminalStatus =
  | { tag: "Queried"; stdin: string | undefined; date: Date }
  | { tag: "Querying"; callbacks: Array<(stdin: string | undefined) => void> };

async function queryTerminalHelper({
  timeoutMs,
  stdin,
  stdout,
  escapes,
  isDone,
}: {
  timeoutMs: number;
  stdin: ReadStream;
  stdout: WriteStream;
  escapes: string;
  isDone: (stdin: string) => boolean;
}): Promise<string | undefined> {
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
    }, timeoutMs);
  });
}
