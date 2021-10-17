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
      returnValue: unknown;
    }
  | {
      tag: "ElmWatchNodeDefaultExportNotFunction";
      scriptPath: ElmWatchNodeScriptPath;
      imported: Record<string, unknown>;
    }
  | {
      tag: "ElmWatchNodeImportError";
      scriptPath: ElmWatchNodeScriptPath;
      error: unknown;
    }
  | {
      tag: "ElmWatchNodeMissingScript";
    }
  | {
      tag: "ElmWatchNodeRunError";
      scriptPath: ElmWatchNodeScriptPath;
      args: Array<string>;
      error: unknown;
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
      .postprocess({ cwd, userArgs, extraArgs, code });
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
    return (
      this.workers.find((worker) => worker.isIdle()) ??
      new PostprocessWorker(this.onUnexpectedError)
    );
  }
}

export type ElmWatchNodeArgs = {
  cwd: AbsolutePath;
  userArgs: Array<string>;
  extraArgs: Array<string>;
  code: Buffer | string;
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
  private worker = new Worker(path.join(__dirname, "PostprocessWorker"));

  private status: PostprocessWorkerStatus = { tag: "Idle" };

  constructor(private onUnexpectedError: (error: Error) => void) {
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
                case "Resolve":
                  this.status.resolve(message.result.value);
                  break;
                case "Reject":
                  this.status.reject(toError(message.result.error));
                  break;
              }
              this.status = { tag: "Idle" };
              break;

            case "Terminated":
              break;
          }
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
