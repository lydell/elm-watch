#!/usr/bin/env node

import { Command, CommanderError } from "commander";
import type { Readable, Writable } from "stream";

type Env = Record<string, string | undefined>;

export type ReadStream = Readable & {
  isTTY: boolean;
  setRawMode: (mode: boolean) => void;
};

export type WriteStream = Writable & {
  isTTY: boolean;
};

type Options = {
  cwd?: string;
  env?: Env;
  stdin?: ReadStream;
  stdout?: WriteStream;
  stderr?: WriteStream;
};

export default async function elmWatchCli(
  args: Array<string>,
  // istanbul ignore next
  {
    // cwd = process.cwd(),
    // env = process.env,
    // stdin = process.stdin,
    stdout = process.stdout,
    stderr = process.stderr,
  }: Options = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const program = new Command();

    program
      .allowExcessArguments(false)
      .exitOverride((error) => {
        throw error;
      })
      .configureOutput({
        writeOut: (str) => {
          stdout.write(str);
        },
        writeErr: (str) => {
          stderr.write(str);
        },
      })
      .name("elm-watch")
      .option("--debug", "Turn on Elm’s debugger.")
      .option(
        "--optimize",
        "Turn on optimizations to make code smaller and faster."
      )
      .option("--output <file>", "Specify the name of the resulting JS file.")
      .version("%VERSION%", "--version", "Print version and exit")
      .helpOption("-h, --help", "Show help.")
      .addHelpCommand("help [command]", "Show help.");

    program
      .command("make [files...]")
      .description("Compile Elm code into JS.")
      .action((files) => {
        const options = program.opts();
        console.log("make", options, files);
        resolve(0);
      });

    program
      .command("watch [files...]")
      .description("Also recompile whenever your Elm files change.")
      .action((files) => {
        const options = program.opts();
        console.log("watch", options, files);
        resolve(0);
      });

    program
      .command("hot [files...]")
      .description("Also reload the compiled JS in the browser.")
      .action((files) => {
        const options = program.opts();
        console.log("hot", options, files);
        resolve(0);
      });

    try {
      program.parse(args, { from: "user" });
    } catch (error) {
      if (error instanceof CommanderError) {
        resolve(error.exitCode);
      } else {
        reject(error);
      }
    }
  });
}

// istanbul ignore if
if (require.main === module) {
  elmWatchCli(process.argv.slice(2)).then(
    (exitCode) => {
      process.exit(exitCode);
    },
    (error: Error) => {
      process.stderr.write(
        `Unexpected error:\n${error.stack ?? error.message}\n`
      );
      process.exit(1);
    }
  );
}
