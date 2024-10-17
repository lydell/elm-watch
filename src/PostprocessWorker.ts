import * as path from "path";
import * as Codec from "tiny-decoders";
import * as url from "url";
import { MessagePort, parentPort } from "worker_threads";

import { unknownErrorToString } from "./Helpers";
import { isNonEmptyArray } from "./NonEmptyArray";
import {
  ELM_WATCH_NODE,
  ElmWatchNodeInternalArgs,
  ElmWatchNodePublicArgs,
  MessageFromWorker,
  MessageToWorker,
  PostprocessResult,
  UnknownValueAsString,
} from "./PostprocessShared";
import {
  type ElmWatchNodeScriptPath,
  markAsElmWatchNodeScriptPath,
} from "./Types";

// Many errors are typed to always have `stdout` and `stderr`. They are captured
// from the worker in `Postprocess.ts`, not here, though. By including this
// empty stdio we can still use the same type. A bit weird, but it works.
const emptyStdio = {
  stdout: "",
  stderr: "",
};

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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      case "StartPostprocess":
        elmWatchNode(message.args)
          .then((result) => {
            port.postMessage({
              tag: "PostprocessDone",
              result: { tag: "Resolve", value: result },
            });
          })
          .catch((error: unknown) => {
            port.postMessage({
              tag: "PostprocessDone",
              result: { tag: "Reject", error },
            });
          });
        break;
    }
  });
}

async function elmWatchNode({
  cwd,
  code,
  targetName,
  compilationMode,
  runMode,
  userArgs,
}: ElmWatchNodeInternalArgs): Promise<PostprocessResult> {
  if (!isNonEmptyArray(userArgs)) {
    return { tag: "ElmWatchNodeMissingScript" };
  }

  const scriptPath: ElmWatchNodeScriptPath = markAsElmWatchNodeScriptPath(
    url.pathToFileURL(path.resolve(cwd, userArgs[0])).toString(),
  );

  let imported;
  try {
    imported = (await import(scriptPath)) as Record<string, unknown>;
  } catch (unknownError) {
    return {
      tag: "ElmWatchNodeImportError",
      scriptPath,
      error: unknownValueAsString(unknownError, importErrorToString),
      ...emptyStdio,
    };
  }

  if (typeof imported["default"] !== "function") {
    return {
      tag: "ElmWatchNodeDefaultExportNotFunction",
      scriptPath,
      imported: unknownValueAsString(
        // To/from entries is needed. Otherwise `repr` prints `"Module"`.
        Object.fromEntries(Object.entries(imported)),
        (value) => Codec.repr(value, { maxObjectChildren: 10 }),
      ),
      typeofDefault: typeof imported["default"],
      ...emptyStdio,
    };
  }

  const args: ElmWatchNodePublicArgs = {
    code,
    targetName,
    compilationMode,
    runMode,
    // Mimic `process.argv`: ["node", "/absolute/path/to/script", "arg1", "arg2", "..."].
    argv: [ELM_WATCH_NODE, url.fileURLToPath(scriptPath), ...userArgs.slice(1)],
  };

  let returnValue: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    returnValue = (await imported["default"](args)) as unknown;
  } catch (unknownError) {
    return {
      tag: "ElmWatchNodeRunError",
      scriptPath,
      args,
      error: unknownValueAsString(unknownError, unknownErrorToString),
      ...emptyStdio,
    };
  }

  if (typeof returnValue !== "string") {
    return {
      tag: "ElmWatchNodeBadReturnValue",
      scriptPath,
      args,
      returnValue: unknownValueAsString(returnValue, Codec.repr),
      ...emptyStdio,
    };
  }

  return { tag: "Success", code: returnValue };
}

function unknownValueAsString(
  value: unknown,
  toString: (value: unknown) => string,
): UnknownValueAsString {
  return {
    tag: "UnknownValueAsString",
    value: toString(value),
  };
}

function importErrorToString(error: unknown): string {
  const code: unknown = (error as { code: unknown } | undefined)?.code;
  return code === "ERR_MODULE_NOT_FOUND"
    ? (error as { message: string }).message
    : unknownErrorToString(error);
}

if (parentPort === null) {
  throw new Error("PostprocessWorker.ts: worker_threads.parentPort is null!");
}

main(parentPort);
