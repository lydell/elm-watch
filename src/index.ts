import * as http from "http";

import { Env } from "./Env";
import * as Help from "./Help";
import { ReadStream, unknownErrorToString, WriteStream } from "./Helpers";
import { HotKillManager } from "./Hot";
import { init } from "./Init";
import { makeLogger } from "./Logger";
import { absolutePathFromString } from "./PathHelpers";
import { PostprocessWorkerPool } from "./Postprocess";
import { run } from "./Run";
import {
  CliArg,
  CreateServer,
  Cwd,
  GetNow,
  markAsAbsolutePath,
  markAsCliArg,
  markAsCwd,
} from "./Types";

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
  hotKillManager?: HotKillManager;
};

export default async function elmWatchCli(
  args: Array<string>,
  {
    cwd: cwdString = process.cwd(),
    env = process.env,
    stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    createServer = ({ onRequest, onUpgrade }) =>
      http.createServer(onRequest).on("upgrade", onUpgrade),
    logDebug = (message) => stderr.write(`${message}\n`),
    hotKillManager = { kill: undefined },
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
      return new Promise((resolve, reject) => {
        const doIt = async (): Promise<number> => {
          let result;
          do {
            result = await run(
              cwd,
              env,
              logger,
              getNow,
              createServer,
              runMode,
              restArgs,
              result === undefined ? [] : result.restartReasons,
              result === undefined
                ? new PostprocessWorkerPool(reject)
                : result.postprocessWorkerPool,
              result === undefined ? undefined : result.webSocketState,
              hotKillManager,
            );
          } while (result.tag === "Restart");
          switch (result.tag) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            case "Exit":
              return result.exitCode;
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
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            if (stdin.setRawMode !== undefined && stdin.isRaw) {
              stdin.setRawMode(false);
            }
          });
      });
    }

    default:
      logger.write(`Unknown command: ${args[0]}`);
      return 1;
  }
}

/* v8 ignore start */
if (require.main === module) {
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
