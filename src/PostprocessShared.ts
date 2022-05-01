import { Command, ExitReason } from "./Spawn";
import {
  AbsolutePath,
  CompilationMode,
  ElmWatchNodeScriptPath,
  RunMode,
} from "./Types";

export const ELM_WATCH_NODE = "elm-watch-node";

export type ElmWatchNodeInternalArgs = {
  cwd: AbsolutePath;
  code: string;
  targetName: string;
  compilationMode: CompilationMode;
  runMode: RunMode;
  userArgs: Array<string>;
};

export type ElmWatchNodePublicArgs = {
  code: string;
  targetName: string;
  compilationMode: CompilationMode;
  runMode: RunMode;
  argv: Array<string>;
};

export type MessageToWorker = {
  tag: "StartPostprocess";
  args: ElmWatchNodeInternalArgs;
};

export type MessageFromWorker = {
  tag: "PostprocessDone";
  result:
    | { tag: "Reject"; error: unknown }
    | { tag: "Resolve"; value: PostprocessResult<string> };
};

export type PostprocessResult<Code = Buffer> =
  | PostprocessError
  | {
      tag: "Success";
      code: Code;
    };

export type PostprocessError =
  | {
      tag: "CommandNotFoundError";
      command: Command;
    }
  | {
      tag: "ElmWatchNodeBadReturnValue";
      scriptPath: ElmWatchNodeScriptPath;
      args: ElmWatchNodePublicArgs;
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
      args: ElmWatchNodePublicArgs;
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
// messages, so we can serialize them in the worker instead. This type helps
// making sure we remember to do that correctly.
export type UnknownValueAsString = {
  tag: "UnknownValueAsString";
  value: string;
};
