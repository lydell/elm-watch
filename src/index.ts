import * as http from "http";

import type { Env } from "./Env.ts";
import * as Errors from "./Errors.ts";
import * as Help from "./Help.ts";
import {
  type ReadStream,
  unknownErrorToString,
  type WriteStream,
} from "./Helpers.ts";
import type { HotTestHooks } from "./Hot.ts";
import { init } from "./Init.ts";
import { makeLogger } from "./Logger.ts";
import { decodeOptions } from "./Options.ts";
import { absolutePathFromString } from "./PathHelpers.ts";
import { run, runConfig, type RunResult } from "./Run.ts";
import {
  type CliArg,
  type CreateServer,
  type Cwd,
  type GetNow,
  markAsAbsolutePath,
  markAsCliArg,
  markAsCwd,
} from "./Types.ts";

// Note: This must be in sync with index.d.ts, which is used by the npm package.
type Options = {
  cwd?: string;
  env?: Env;
  stdin?: ReadStream;
  stdout?: WriteStream;
  stderr?: WriteStream;
  createServer?: CreateServer;

  // Not exposed in the type annotations in the npm package:
  logDebug?: (message: string) => void;
  hotTestHooks?: HotTestHooks;
};

export default async function elmWatchCli(
  args: Array<string>,
  {
    cwd: cwdString = process.cwd(),
    env = process.env,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    createServer = defaultCreateServer,
    logDebug = (message) => stderr.write(`${message}\n`),
    hotTestHooks = { kill: undefined },
  }: Options = {},
): Promise<number> {
  const getNow: GetNow = () => new Date();
  const logger = makeLogger({
    env,
    getNow,
    stdin,
    stdout,
    stderr,
    logDebug,
  });
  const cwd: Cwd = markAsCwd(
    absolutePathFromString(markAsAbsolutePath(process.cwd()), cwdString),
  );

  const isHelp = args.some(
    (arg) => arg === "-h" || arg === "-help" || arg === "--help",
  );
  if (isHelp) {
    logger.write(Help.render(logger.config));
    return 0;
  }

  const restArgs: Array<CliArg> = args.slice(1).map(markAsCliArg);

  switch (args[0]) {
    case undefined:
    case "help":
      logger.write(Help.render(logger.config));
      return 0;

    case "init":
      return init(cwd, logger, restArgs);

    case "make":
    case "hot": {
      const runMode = args[0];
      return runUntilExit(stdin, (previous) =>
        run(
          cwd,
          env,
          logger,
          getNow,
          createServer,
          runMode,
          restArgs,
          previous.restartReasons,
          previous.webSocketState,
          previous.webSocketToken,
          hotTestHooks,
        ),
      );
    }

    default:
      logger.write(`Unknown command: ${args[0]}`);
      return 1;
  }
}

// Note: The options must be in sync with index.d.ts, which is used by the npm package.
export async function elmWatch(options: unknown): Promise<number> {
  // Not covered by tests: Passing a non-object would print to the real stdout.
  /* v8 ignore start */
  const isObject = typeof options === "object" && options !== null;
  /* v8 ignore stop */

  const {
    env = process.env,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    createServer = defaultCreateServer,
    /* v8 ignore next -- @preserve */
    logDebug = (message) => stderr.write(`${message}\n`),
    hotTestHooks = { kill: undefined },
    ...publicOptions
  } = (isObject ? options : /* v8 ignore next -- @preserve */ {}) as Omit<
    Options,
    "cwd"
  >;

  const getNow: GetNow = () => new Date();
  const logger = makeLogger({
    env,
    getNow,
    stdin,
    stdout,
    stderr,
    logDebug,
  });

  const decoded = decodeOptions(
    isObject
      ? { env, stdin, stdout, stderr, createServer, ...publicOptions }
      : /* v8 ignore next -- @preserve */ options,
  );

  switch (decoded.tag) {
    case "DecoderError":
      logger.errorTemplate(Errors.invalidOptions(decoded.error));
      return 1;

    case "Valid":
      return runUntilExit(stdin, (previous) =>
        runConfig({
          env,
          logger,
          getNow,
          createServer,
          runMode: decoded.runMode,
          compilationMode: decoded.compilationMode,
          targetsSubstrings: [],
          config: decoded.config,
          restartReasons: previous.restartReasons,
          webSocketState: previous.webSocketState,
          webSocketTokenFromPreviousRun: previous.webSocketToken,
          hotTestHooks,
        }),
      );
  }
}

type PreviousRun = Omit<Extract<RunResult, { tag: "Restart" }>, "tag">;

// Restarts elm-watch (for example when elm.json changes) until it exits.
async function runUntilExit(
  stdin: ReadStream,
  runOnce: (previous: PreviousRun) => Promise<RunResult>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const doIt = async (): Promise<number> => {
      let previous: PreviousRun = {
        restartReasons: [],
        webSocketState: undefined,
        webSocketToken: undefined,
      };
      for (;;) {
        const result = await runOnce(previous);
        switch (result.tag) {
          case "Exit":
            return result.exitCode;
          case "Restart":
            previous = result;
            break;
        }
      }
    };
    doIt()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        // Turn off raw mode so that ctrl+c automatically kills things left behind
        // accidentally on the event loop. That’s of course a bug, but if it
        // happens it should at least be possible to exit with a simple ctrl+c.
        // Note: `.setRawMode` is `undefined` when stdin is not a TTY, but this is
        // not reflected in the type definitions.
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        if (stdin.setRawMode !== undefined && stdin.isRaw) {
          stdin.setRawMode(false);
        }
      });
  });
}

const defaultCreateServer: CreateServer = ({ onRequest, onUpgrade }) =>
  http.createServer(onRequest).on("upgrade", onUpgrade);

/* v8 ignore start */
if (import.meta.main) {
  process.title = "elm-watch";
  elmWatchCli(process.argv.slice(2))
    .then((exitCode) => {
      // Let the process exit with this exit code when the event loop is empty.
      process.exitCode = exitCode;
      if (process.stdout.isTTY) {
        process.stdout.write(
          "Exiting elm-watch. Press ctrl+c (again) to force.",
        );
        process.once("exit", () => {
          process.stdout.cursorTo(0);
          process.stdout.clearLine(0);
        });
      }
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `Unexpected error:\n${unknownErrorToString(error)}\n`,
      );
      // Forcefully exit since the watcher might still be running.
      process.exit(1);
    });
}
/* v8 ignore stop */
