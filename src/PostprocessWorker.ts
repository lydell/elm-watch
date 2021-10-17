import { MessagePort, parentPort } from "worker_threads";

import { isNonEmptyArray } from "./NonEmptyArray";
import { absolutePathFromString } from "./PathHelpers";
import type {
  ElmWatchNodeArgs,
  MessageFromWorker,
  MessageToWorker,
  PostprocessResult,
} from "./Postprocess";
import type { ElmWatchNodeScriptPath } from "./Types";

type PortWrapper = {
  postMessage: (message: MessageFromWorker) => void;
  on: MessagePort["on"];
};

function main(port: PortWrapper): void {
  port.on("messageerror", (error) => {
    throw error;
  });

  port.on("message", (message: MessageToWorker) => {
    switch (message.tag) {
      case "StartPostprocess":
        elmWatchNode(message.args).then(
          (result) => {
            port.postMessage({
              tag: "PostprocessDone",
              result: { tag: "Resolve", value: result },
            });
          },
          (error: unknown) => {
            port.postMessage({
              tag: "PostprocessDone",
              result: { tag: "Reject", error },
            });
          }
        );
        break;
    }
  });
}

async function elmWatchNode({
  cwd,
  userArgs,
  extraArgs,
  code,
}: ElmWatchNodeArgs): Promise<PostprocessResult> {
  if (!isNonEmptyArray(userArgs)) {
    return { tag: "ElmWatchNodeMissingScript" };
  }

  const scriptPath: ElmWatchNodeScriptPath = {
    tag: "ElmWatchNodeScriptPath",
    theElmWatchNodeScriptPath: absolutePathFromString(cwd, userArgs[0]),
  };

  let imported;
  try {
    imported = (await import(
      scriptPath.theElmWatchNodeScriptPath.absolutePath
    )) as Record<string, unknown>;
  } catch (unknownError) {
    return {
      tag: "ElmWatchNodeImportError",
      scriptPath,
      error: unknownError,
    };
  }

  if (typeof imported.default !== "function") {
    return {
      tag: "ElmWatchNodeDefaultExportNotFunction",
      scriptPath,
      imported,
    };
  }

  const args = [code.toString("utf8"), ...userArgs.slice(1), ...extraArgs];

  let returnValue: unknown;
  try {
    returnValue = (await imported.default(args)) as unknown;
  } catch (unknownError) {
    return {
      tag: "ElmWatchNodeRunError",
      scriptPath,
      args,
      error: unknownError,
    };
  }

  if (typeof returnValue !== "string") {
    return {
      tag: "ElmWatchNodeBadReturnValue",
      scriptPath,
      args,
      returnValue,
    };
  }

  return { tag: "Success", code: Buffer.from(returnValue) };
}

if (parentPort === null) {
  throw new Error("PostprocessWorker.ts: worker_threads.parentPort is null!");
}

main(parentPort);
