import { isNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import type { CliArg, CompilationMode, RunMode } from "./Types";

type ParseArgsResult =
  | {
      tag: "Success";
      compilationMode: CompilationMode;
      targetsSubstrings: Array<string>;
    }
  | {
      tag: "UnknownFlags";
      unknownFlags: NonEmptyArray<CliArg>;
    }
  | { tag: "DebugOptimizeClash" }
  | { tag: "DebugOptimizeForHot" };

export function parseArgs(
  runMode: RunMode,
  args: Array<CliArg>
): ParseArgsResult {
  let debug = false;
  let optimize = false;
  const unknownFlags: Array<CliArg> = [];
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
        if (arg.theArg.startsWith("-")) {
          unknownFlags.push(arg);
        } else {
          targetsSubstrings.push(arg.theArg);
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

  if (isNonEmptyArray(unknownFlags)) {
    return {
      tag: "UnknownFlags",
      unknownFlags,
    };
  }

  return {
    tag: "Success",
    compilationMode: debug ? "debug" : optimize ? "optimize" : "standard",
    targetsSubstrings,
  };
}
