import * as ElmWatchJson from "./ElmWatchJson";
import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import type { CliArg, CompilationMode, RunMode } from "./Types";

type ParseArgsResult =
  | {
      tag: "BadArgs";
      badArgs: NonEmptyArray<CliArg>;
    }
  | {
      tag: "Success";
      compilationMode: CompilationMode;
      targetsSubstrings: Array<string>;
    }
  | { tag: "DebugOptimizeClash" }
  | { tag: "DebugOptimizeForHot" };

export function parseArgs(
  runMode: RunMode,
  args: Array<CliArg>
): ParseArgsResult {
  let debug = false;
  let optimize = false;
  const badArgs: Array<CliArg> = [];
  const targetsSubstrings: Array<string> = [];

  for (const arg of args) {
    switch (arg.theArg) {
      case "--debug":
        debug = true;
        break;

      case "--optimize":
        optimize = true;
        break;

      default:
        if (ElmWatchJson.isValidTargetSubstring(arg.theArg)) {
          targetsSubstrings.push(arg.theArg);
        } else {
          badArgs.push(arg);
        }
    }
  }

  switch (runMode) {
    case "hot":
      if (debug || optimize) {
        return { tag: "DebugOptimizeForHot" };
      }
      break;

    case "make":
      if (debug && optimize) {
        return { tag: "DebugOptimizeClash" };
      }
      break;
  }

  if (isNonEmptyArray(badArgs)) {
    return {
      tag: "BadArgs",
      badArgs,
    };
  }

  return {
    tag: "Success",
    compilationMode: debug ? "debug" : optimize ? "optimize" : "standard",
    targetsSubstrings,
  };
}
