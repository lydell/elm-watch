import * as Codec from "tiny-decoders";

import type { PostprocessFunction } from "./Config.ts";
import { unknownErrorToString } from "./Helpers.ts";
import type { CompilationMode, RunMode } from "./Types.ts";

export type Postprocess =
  | {
      tag: "NoPostprocess";
    }
  | {
      tag: "Postprocess";
      postprocessFunction: PostprocessFunction;
    };

export type PostprocessToRun = Extract<Postprocess, { tag: "Postprocess" }>;

type PostprocessResult =
  | PostprocessError
  | {
      tag: "Killed";
    }
  | {
      tag: "Success";
      code: string;
    };

export type PostprocessError =
  | {
      tag: "PostprocessFunctionBadReturnValue";
      returnValue: string;
    }
  | {
      tag: "PostprocessFunctionError";
      error: string;
    };

// A function cannot be killed. Instead, we stop waiting for it and ignore
// whatever it results in. `run` is separate from creating `kill`, so that the
// caller can update the status first: A synchronous function does all of its
// work inside the `run()` call.
export function runPostprocess({
  postprocess,
  code,
  compilationMode,
  runMode,
}: {
  postprocess: PostprocessToRun;
  code: string;
  compilationMode: CompilationMode;
  runMode: RunMode;
}): { run: () => Promise<PostprocessResult>; kill: () => void } {
  let resolveKilled: (result: PostprocessResult) => void = () => {
    // Replaced below.
  };
  const killed = new Promise<PostprocessResult>((resolve) => {
    resolveKilled = resolve;
  });

  const runFunction = async (): Promise<PostprocessResult> => {
    let returnValue;
    try {
      returnValue = await postprocess.postprocessFunction(code, {
        compilationMode,
        runMode,
      });
    } catch (error) {
      return {
        tag: "PostprocessFunctionError",
        error: unknownErrorToString(error),
      };
    }
    return typeof returnValue === "string"
      ? { tag: "Success", code: returnValue }
      : {
          tag: "PostprocessFunctionBadReturnValue",
          returnValue: Codec.repr(returnValue),
        };
  };

  return {
    run: () => Promise.race([runFunction(), killed]),
    kill: () => {
      resolveKilled({ tag: "Killed" });
    },
  };
}
