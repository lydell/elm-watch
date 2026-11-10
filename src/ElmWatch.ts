import * as http from "http";

import type { Env } from "./Env.ts";
import * as Errors from "./Errors.ts";
import * as Help from "./Help.ts";
import type { ReadStream, WriteStream } from "./Helpers.ts";
import type { HotTestHooks } from "./Hot.ts";
import { init } from "./Init.ts";
import { type Logger, makeLogger } from "./Logger.ts";
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
  signal?: AbortSignal;

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
      return runUntilExit(logger, undefined, (previous) =>
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
          previous.errorViewState,
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
  const isObject = typeof options === "object" && options !== null;

  const {
    env = process.env,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    createServer = defaultCreateServer,
    signal,
    logDebug = (message) => stderr.write(`${message}\n`),
    hotTestHooks = { kill: undefined },
    ...publicOptions
  } = (isObject ? options : {}) as Omit<Options, "cwd">;

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
      ? { env, stdin, stdout, stderr, createServer, signal, ...publicOptions }
      : options,
  );

  switch (decoded.tag) {
    case "DecoderError":
      logger.errorTemplate(Errors.invalidOptions(decoded.error));
      return 1;

    case "Valid":
      return runUntilExit(logger, signal, (previous) =>
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
          errorViewState: previous.errorViewState,
          signal,
          hotTestHooks,
        }),
      );
  }
}

type PreviousRun = Omit<Extract<RunResult, { tag: "Restart" }>, "tag">;

// Restarts elm-watch (for example when elm.json changes) until it exits.
async function runUntilExit(
  logger: Logger,
  signal: AbortSignal | undefined,
  runOnce: (previous: PreviousRun) => Promise<RunResult>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const doIt = async (): Promise<number> => {
      let previous: PreviousRun = {
        restartReasons: [],
        webSocketState: undefined,
        webSocketToken: undefined,
        errorViewState: undefined,
      };
      for (;;) {
        if (signal?.aborted === true) {
          return 0;
        }
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
        // This also shows the cursor again, even if something crashed.
        logger.reset();
      });
  });
}

const defaultCreateServer: CreateServer = ({ onRequest, onUpgrade }) =>
  http.createServer(onRequest).on("upgrade", onUpgrade);
