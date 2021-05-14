import type { DecoderError } from "tiny-decoders";

import * as ElmToolingJson from "./ElmToolingJson";
import { bold, join } from "./helpers";
import type { NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath, absolutePathFromString, Cwd } from "./path-helpers";
import type { CliArg, ElmToolingJsonPath } from "./types";

const elmToolingJson = bold("elm-tooling.json");

export function readAsJson(
  elmToolingJsonPath: ElmToolingJsonPath,
  error: Error
): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath.theElmToolingJsonPath.absolutePath}

${bold("But I had trouble reading it as JSON:")}

${error.message}
  `.trim();
}

export function decode(
  elmToolingJsonPath: ElmToolingJsonPath,
  error: DecoderError
): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath.theElmToolingJsonPath.absolutePath}

${bold("But I had trouble with the JSON inside:")}

${error.format()}
  `.trim();
}

export function elmToolingJsonNotFound(cwd: Cwd, args: Array<CliArg>): string {
  const example = ElmToolingJson.example(
    cwd,
    {
      tag: "ElmToolingJsonPath",
      theElmToolingJsonPath: absolutePathFromString(
        cwd.path,
        "elm-tooling.json"
      ),
    },
    args
  );

  return `
I read inputs, outputs and options from ${elmToolingJson}.

${bold("But I couldn’t find one!")}

You need to create one with JSON like this:

${example}
  `.trim();
}

export function badArgs(
  cwd: Cwd,
  elmToolingJsonPath: ElmToolingJsonPath,
  args: Array<CliArg>,
  theBadArgs: NonEmptyArray<CliArg>
): string {
  return `
${bold(
  "I only accept JS file paths as arguments, but I got some that don’t look like that:"
)}

${join(
  theBadArgs.map((arg) => arg.theArg),
  "\n"
)}

You either need to remove those arguments or move them to the ${elmToolingJson} I found here:

${elmToolingJsonPath.theElmToolingJsonPath.absolutePath}

For example, you could add some JSON like this:

${ElmToolingJson.example(cwd, elmToolingJsonPath, args)}
  `.trim();
}

export function unknownOutputs(
  elmToolingJsonPath: ElmToolingJsonPath,
  knownOutputs: NonEmptyArray<string>,
  theUnknownOutputs: NonEmptyArray<string>
): string {
  return `
I read inputs, outputs and options from ${elmToolingJson}.

I found an ${elmToolingJson} here:

${elmToolingJsonPath.theElmToolingJsonPath.absolutePath}

It contains these outputs:

${join(knownOutputs, "\n")}

${bold("But those don’t include these outputs you asked me to build:")}

${join(theUnknownOutputs, "\n")}

Is something misspelled? (You need to type them exactly the same.)
Or do you need to add some more outputs?
  `.trim();
}

export function noCommonRoot(paths: NonEmptyArray<AbsolutePath>): string {
  return `
I could not find a common ancestor for these paths:

${join(
  paths.map((thePath) => thePath.absolutePath),
  "\n"
)}

${bold("Files on different drives is not supported.")}
  `.trim();
}
