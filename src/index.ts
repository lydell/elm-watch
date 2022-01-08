import * as Help from "./Help";
import { Env, ReadStream, unknownErrorToString, WriteStream } from "./Helpers";
import { init } from "./Init";
import { makeLogger } from "./Logger";
import { absolutePathFromString } from "./PathHelpers";
import { PostprocessWorkerPool } from "./Postprocess";
import { run } from "./Run";
import { CliArg, Cwd, GetNow } from "./Types";

type Options = {
  cwd: string;
  env: Env;
  stdin: ReadStream;
  stdout: WriteStream;
  stderr: WriteStream;
  getNow: GetNow;
};

export async function elmWatchCli(
  args: Array<string>,
  {
    cwd: cwdString,
    env,
    // stdin,
    stdout,
    stderr,
    getNow,
  }: Options
): Promise<number> {
  const logger = makeLogger({ env, stdout, stderr });
  const cwd: Cwd = {
    tag: "Cwd",
    path: absolutePathFromString(
      { tag: "AbsolutePath", absolutePath: process.cwd() },
      cwdString
    ),
  };

  const isHelp = args.some(
    (arg) => arg === "-h" || arg === "-help" || arg === "--help"
  );
  if (isHelp) {
    logger.log(
      Help.render({ fancy: logger.fancy, isTTY: logger.raw.stdout.isTTY })
    );
    return 0;
  }

  const restArgs: Array<CliArg> = args
    .slice(1)
    .map((arg) => ({ tag: "CliArg", theArg: arg }));

  switch (args[0]) {
    case undefined:
    case "help":
      logger.log(
        Help.render({ fancy: logger.fancy, isTTY: logger.raw.stdout.isTTY })
      );
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
              runMode,
              restArgs,
              result === undefined ? [] : result.restartReasons,
              result === undefined
                ? new PostprocessWorkerPool(reject)
                : result.postprocessWorkerPool,
              result === undefined ? undefined : result.webSocketState
            );
          } while (result.tag === "Restart");
          switch (result.tag) {
            case "Exit":
              return result.exitCode;
          }
        };
        doIt().then(resolve, reject);
      });
    }

    default:
      logger.error(`Unknown command: ${args[0]}`);
      return 1;
  }
}

// istanbul ignore if
if (require.main === module) {
  elmWatchCli(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    getNow: () => new Date(),
  }).then(
    (exitCode) => {
      // Let the process exit with this exit code when the event loop is empty.
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      process.stderr.write(
        `Unexpected error:\n${unknownErrorToString(error)}\n`
      );
      // Forcefully exit since the watcher might still be running.
      process.exit(1);
    }
  );
}
