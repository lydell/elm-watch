import * as Help from "./Help";
import type { Env, ReadStream, WriteStream } from "./Helpers";
import { makeLogger } from "./Logger";
import { absolutePathFromString, Cwd } from "./PathHelpers";
import { run } from "./Run";
import { OnIdle } from "./Types";

type Options = {
  cwd?: string;
  env?: Env;
  stdin?: ReadStream;
  stdout?: WriteStream;
  stderr?: WriteStream;
  onIdle?: OnIdle;
};

export async function elmWatchCli(
  args: Array<string>,
  // istanbul ignore next
  {
    cwd: cwdString = process.cwd(),
    env = process.env,
    // stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
    onIdle,
  }: Options = {}
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
    logger.log(Help.render());
    return 0;
  }

  switch (args[0]) {
    case undefined:
    case "help":
      logger.log(Help.render());
      return 0;

    case "make":
    case "hot":
      return run(
        cwd,
        env,
        logger,
        onIdle,
        args[0],
        args.slice(1).map((arg) => ({ tag: "CliArg", theArg: arg }))
      );

    default:
      logger.error(`Unknown command: ${args[0]}`);
      return 1;
  }
}

// istanbul ignore if
if (require.main === module) {
  elmWatchCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: Error) => {
      process.stderr.write(
        `Unexpected error:\n${error.stack ?? error.message}\n`
      );
      process.exitCode = 1;
    }
  );
}
