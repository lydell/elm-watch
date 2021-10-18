import * as path from "path";
import { Worker } from "worker_threads";

import { Env, toError } from "./Helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import { absoluteDirname, AbsolutePath } from "./PathHelpers";
import { Command, ExitReason, spawn } from "./Spawn";
import {
  CompilationMode,
  ElmWatchJsonPath,
  ElmWatchNodeScriptPath,
  OutputPath,
  RunMode,
} from "./Types";

export const ELM_WATCH_NODE = "elm-watch-node";

export type Postprocess =
  | {
      tag: "NoPostprocess";
    }
  | {
      tag: "Postprocess";
      postprocessArray: NonEmptyArray<string>;
    };

export type PostprocessResult =
  | PostprocessError
  | {
      tag: "Success";
      code: Buffer;
    };

export type PostprocessError =
  | {
      tag: "CommandNotFoundError";
      command: Command;
    }
  | {
      tag: "ElmWatchNodeBadReturnValue";
      scriptPath: ElmWatchNodeScriptPath;
      args: Array<string>;
      returnValue: UnknownValueAsString;
      stdout: string;
      stderr: string;
    }
  | {
      tag: "ElmWatchNodeDefaultExportNotFunction";
      scriptPath: ElmWatchNodeScriptPath;
      imported: UnknownValueAsString;
      typeofDefault: string;
      stdout: string;
      stderr: string;
    }
  | {
      tag: "ElmWatchNodeImportError";
      scriptPath: ElmWatchNodeScriptPath;
      error: UnknownValueAsString;
      stdout: string;
      stderr: string;
    }
  | {
      tag: "ElmWatchNodeMissingScript";
    }
  | {
      tag: "ElmWatchNodeRunError";
      scriptPath: ElmWatchNodeScriptPath;
      args: Array<string>;
      error: UnknownValueAsString;
      stdout: string;
      stderr: string;
    }
  | {
      tag: "OtherSpawnError";
      error: Error;
      command: Command;
    }
  | {
      tag: "PostprocessNonZeroExit";
      exitReason: ExitReason;
      stdout: string;
      stderr: string;
      command: Command;
    }
  | {
      tag: "PostprocessStdinWriteError";
      error: Error;
      command: Command;
    };

// It’s not possible to send any value between workers and the main thread. We
// just show unknown values (such as caught errors and return values) in error
// messages, so we can seralize them in the worker instead. This type helps
// making sure we remember to do that correctly.
export type UnknownValueAsString = {
  tag: "UnknownValueAsString";
  value: string;
};

export async function runPostprocess({
  env,
  elmWatchJsonPath,
  compilationMode,
  runMode,
  outputPath: output,
  postprocessArray,
  code,
  postprocessWorkerPool,
}: {
  env: Env;
  elmWatchJsonPath: ElmWatchJsonPath;
  compilationMode: CompilationMode;
  runMode: RunMode;
  outputPath: OutputPath;
  postprocessArray: NonEmptyArray<string>;
  postprocessWorkerPool: PostprocessWorkerPool;
  code: Buffer | string;
}): Promise<PostprocessResult> {
  const commandName = postprocessArray[0];
  const userArgs = postprocessArray.slice(1);
  const extraArgs = [output.targetName, compilationMode, runMode];
  const cwd = absoluteDirname(elmWatchJsonPath.theElmWatchJsonPath);

  if (commandName === ELM_WATCH_NODE) {
    return postprocessWorkerPool
      .getOrCreateAvailableWorker()
      .postprocess({ cwd, userArgs, extraArgs, code: code.toString("utf8") });
  }

  const command: Command = {
    command: commandName,
    args: [...userArgs, ...extraArgs],
    options: { cwd, env },
    stdin: code,
  };

  const spawnResult = await spawn(command);

  switch (spawnResult.tag) {
    case "CommandNotFoundError":
    case "OtherSpawnError":
      return spawnResult;

    case "StdinWriteError":
      return {
        tag: "PostprocessStdinWriteError",
        error: spawnResult.error,
        command: spawnResult.command,
      };

    case "Exit": {
      const { exitReason } = spawnResult;

      if (!(exitReason.tag === "ExitCode" && exitReason.exitCode === 0)) {
        const stdout = spawnResult.stdout.toString("utf8");
        const stderr = spawnResult.stderr.toString("utf8");
        return {
          tag: "PostprocessNonZeroExit",
          exitReason,
          stdout,
          stderr,
          command,
        };
      }

      return { tag: "Success", code: spawnResult.stdout };
    }
  }
}

// Keeps track of several `PostprocessWorker`s. We don’t need to think about
// limiting here – that is done in `Compile.getOutputActions`.
export class PostprocessWorkerPool {
  private workers: Array<PostprocessWorker> = [];

  constructor(private onUnexpectedError: (error: Error) => void) {}

  getOrCreateAvailableWorker(): PostprocessWorker {
    const existingWorker = this.workers.find((worker) => worker.isIdle());
    if (existingWorker === undefined) {
      const newWorker = new PostprocessWorker(this.onUnexpectedError);
      this.workers.push(newWorker);
      return newWorker;
    } else {
      return existingWorker;
    }
  }

  async terminate(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.terminate()));
    this.workers.length = 0;
  }
}

export type ElmWatchNodeArgs = {
  cwd: AbsolutePath;
  userArgs: Array<string>;
  extraArgs: Array<string>;
  code: string;
};

type PostprocessWorkerStatus =
  | {
      tag: "Busy";
      resolve: (result: PostprocessResult) => void;
      reject: (error: Error) => void;
    }
  | {
      tag: "Idle";
    }
  | {
      tag: "Terminated";
    };

export type MessageToWorker = {
  tag: "StartPostprocess";
  args: ElmWatchNodeArgs;
};

export type MessageFromWorker = {
  tag: "PostprocessDone";
  result:
    | { tag: "Reject"; error: unknown }
    | { tag: "Resolve"; value: PostprocessResult };
};

class PostprocessWorker {
  private worker = new Worker(path.join(__dirname, "PostprocessWorker"), {
    stdout: true,
    stderr: true,
  });

  private status: PostprocessWorkerStatus = { tag: "Idle" };

  constructor(private onUnexpectedError: (error: Error) => void) {
    const stdout: Array<Buffer> = [];
    const stderr: Array<Buffer> = [];

    this.worker.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });

    this.worker.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });

    this.worker.on("error", (error) => {
      if (this.status.tag !== "Terminated") {
        this.status = { tag: "Terminated" };
        this.onUnexpectedError(error);
      }
    });

    this.worker.on("messageerror", (error) => {
      if (this.status.tag !== "Terminated") {
        this.status = { tag: "Terminated" };
        this.onUnexpectedError(error);
      }
    });

    this.worker.on("exit", (exitCode) => {
      if (this.status.tag !== "Terminated") {
        this.status = { tag: "Terminated" };
        this.onUnexpectedError(
          new Error(
            `PostprocessWorker unexpectedly exited, with exit code ${exitCode}.`
          )
        );
      }
    });

    this.worker.on("message", (message: MessageFromWorker) => {
      switch (message.tag) {
        case "PostprocessDone":
          switch (this.status.tag) {
            case "Idle":
              this.status = { tag: "Terminated" };
              this.onUnexpectedError(
                new Error(
                  `PostprocessWorker unexpectedly received a ${JSON.stringify(
                    message.tag
                  )} message from the worker while being "Idle" instead of the expected "Busy".`
                )
              );
              break;

            case "Busy":
              switch (message.result.tag) {
                case "Resolve": {
                  const result = message.result.value;
                  this.status.resolve(
                    "stdout" in result
                      ? {
                          ...result,
                          stdout: Buffer.concat(stdout).toString("utf8"),
                          stderr: Buffer.concat(stderr).toString("utf8"),
                        }
                      : result
                  );
                  break;
                }
                case "Reject":
                  this.status.reject(toError(message.result.error));
                  break;
              }
              this.status = { tag: "Idle" };
              break;

            case "Terminated":
              break;
          }

          stdout.length = 0;
          stderr.length = 0;
      }
    });
  }

  private postMessage(message: MessageToWorker): void {
    this.worker.postMessage(message);
  }

  isIdle(): boolean {
    return this.status.tag === "Idle";
  }

  async postprocess(args: ElmWatchNodeArgs): Promise<PostprocessResult> {
    switch (this.status.tag) {
      case "Idle":
        return new Promise((resolve, reject) => {
          this.status = { tag: "Busy", resolve, reject };
          this.postMessage({ tag: "StartPostprocess", args });
        });

      case "Busy":
      case "Terminated":
        throw new Error(
          `Cannot call PostprocessWorker#postprocess because \`this.status === ${JSON.stringify(
            this.status
          )}\` instead of the expected ${JSON.stringify(this.status)}.`
        );
    }
  }

  async terminate(): Promise<void> {
    if (this.status.tag !== "Terminated") {
      this.status = { tag: "Terminated" };
      await this.worker.terminate();
    }
  }
}
