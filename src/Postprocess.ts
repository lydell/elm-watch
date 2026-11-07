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

export type PostprocessResult =
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
// whatever it results in.
export function runPostprocess({
  postprocess,
  code,
  compilationMode,
  runMode,
}: {
  postprocess: PostprocessToRun;
  code: Buffer | string;
  compilationMode: CompilationMode;
  runMode: RunMode;
}): { promise: Promise<PostprocessResult>; kill: () => void } {
  let resolveKilled: (result: PostprocessResult) => void = () => {
    // Replaced below.
  };
  const killed = new Promise<PostprocessResult>((resolve) => {
    resolveKilled = resolve;
  });

  const run = async (): Promise<PostprocessResult> => {
    let returnValue;
    try {
      returnValue = await postprocess.postprocessFunction(
        code.toString("utf8"),
        { compilationMode, runMode },
      );
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
    promise: Promise.race([run(), killed]),
    kill: () => {
      resolveKilled({ tag: "Killed" });
    },
  };
}
