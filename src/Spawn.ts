import * as childProcess from "child_process";

import { Env, IS_WINDOWS } from "./helpers";
import { AbsolutePath } from "./path-helpers";

export type SpawnResult =
  | {
      tag: "CommandNotFoundError";
      command: Command;
    }
  | {
      tag: "Exit";
      exitReason: ExitReason;
      stdout: string;
      stderr: string;
      command: Command;
    }
  | {
      tag: "OtherSpawnError";
      error: Error;
      command: Command;
    };

export type Command = {
  command: string;
  args: Array<string>;
  options: {
    cwd: AbsolutePath;
    env: Env;
  };
};

export async function spawn(command: Command): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = childProcess.spawn(
      IS_WINDOWS ? cmdEscapeMetaChars(command.command) : command.command,
      IS_WINDOWS ? command.args.map(cmdEscapeArg) : command.args,
      {
        ...command.options,
        cwd: command.options.cwd.absolutePath,
        shell: IS_WINDOWS,
      }
    );

    let stdout = "";
    let stderr = "";

    child.on("error", (error: Error & { code?: string }) => {
      resolve(
        error.code === "ENOENT"
          ? { tag: "CommandNotFoundError", command }
          : { tag: "OtherSpawnError", error, command }
      );
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode, signal) => {
      resolve({
        tag: "Exit",
        exitReason: exitReason(exitCode, signal),
        stdout,
        stderr,
        command,
      });
    });
  });
}

function cmdEscapeMetaChars(arg: string): string {
  // https://qntm.org/cmd
  return arg.replace(/[()%!^"<>&|;, ]/g, "^$&");
}

function cmdEscapeArg(arg: string): string {
  // https://qntm.org/cmd
  return cmdEscapeMetaChars(
    `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`
  );
}

export type ExitReason =
  | {
      tag: "ExitCode";
      exitCode: number;
    }
  | {
      tag: "Signal";
      signal: NodeJS.Signals;
    }
  | {
      tag: "Unknown";
    };

function exitReason(
  exitCode: number | null,
  signal: NodeJS.Signals | null
): ExitReason {
  return exitCode !== null
    ? { tag: "ExitCode", exitCode }
    : signal !== null
    ? { tag: "Signal", signal }
    : { tag: "Unknown" };
}
