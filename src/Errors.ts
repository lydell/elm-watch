import type { DecoderError } from "tiny-decoders";

import * as ElmToolingJson from "./ElmToolingJson";
import { bold, dim, join } from "./helpers";
import { mapNonEmptyArray, NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath, absolutePathFromString, Cwd } from "./path-helpers";
import { UncheckedInputPath } from "./State";
import type {
  CliArg,
  ElmJsonPath,
  ElmToolingJsonPath,
  InputPath,
} from "./types";

const elmToolingJson = bold("elm-tooling.json");

export function readElmToolingJsonAsJson(
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

export function decodeElmToolingJson(
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

${bold("But I couldn't find one!")}

You need to create one with JSON like this:

${example}
  `.trim();
}

export function debugOptimizeForHot(): string {
  const make = bold("elm-watch make");
  const hot = bold("elm-watch hot");
  return `
${bold("--debug")} and ${bold("--optimize")} only make sense for ${make}.
When using ${hot}, you can switch mode in the browser.
  `.trim();
}

export function debugOptimizeClash(): string {
  return `
${bold("--debug")} and ${bold("--optimize")} cannot be used at the same time.
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
  "I only accept JS file paths as arguments, but I got some that don't look like that:"
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

${bold("But those don't include these outputs you asked me to build:")}

${join(theUnknownOutputs, "\n")}

Is something misspelled? (You need to type them exactly the same.)
Or do you need to add some more outputs?
  `.trim();
}

export function noCommonRoot(paths: NonEmptyArray<AbsolutePath>): string {
  return `
I could not find a common ancestor for these paths:

${join(
  mapNonEmptyArray(paths, (thePath) => thePath.absolutePath),
  "\n"
)}

${bold("Compiling files on different drives is not supported.")}
  `.trim();
}

export function elmJsonNotFound(inputs: NonEmptyArray<InputPath>): string {
  return `
I could not find an ${bold("elm.json")} for these inputs:

${join(
  mapNonEmptyArray(inputs, (inputPath) => inputPath.originalString),
  "\n"
)}

Has it gone missing? Maybe run ${bold("elm init")} to create one?
  `.trim();
}

export function nonUniqueElmJsonPaths(
  theNonUniqueElmJsonPaths: NonEmptyArray<{
    inputPath: InputPath;
    elmJsonPath: ElmJsonPath;
  }>
): string {
  return `
I went looking for an ${bold("elm.json")} for your inputs,
but I found more than one!

${join(
  mapNonEmptyArray(
    theNonUniqueElmJsonPaths,
    ({ inputPath, elmJsonPath }) =>
      `${inputPath.originalString}\n-> ${elmJsonPath.theElmJsonPath.absolutePath}`
  ),
  "\n\n"
)}

It doesn't make sense to compile Elm files from different projects into one output.

Either split this output, or move the inputs to the same project with the same
${bold("elm.json")}.
  `.trim();
}

export function inputsNotFound(
  inputs: NonEmptyArray<UncheckedInputPath>
): string {
  return `
You asked me to compile these inputs:

${join(
  mapNonEmptyArray(
    inputs,
    (inputPath) =>
      `${inputPath.originalString} ${dim(
        `(${inputPath.theUncheckedInputPath.absolutePath})`
      )}`
  ),
  "\n"
)}

${bold("But they don't exist!")}

Is something misspelled? Or do you need to create them?
  `.trim();
}

export function inputsFailedToResolve(
  inputs: NonEmptyArray<{ inputPath: UncheckedInputPath; error: Error }>
): string {
  return `
I start by checking if the inputs you give me exist,
but doing so resulted in errors!

${join(
  mapNonEmptyArray(
    inputs,
    ({ inputPath, error }) => `${inputPath.originalString}:\n${error.message}`
  ),
  "\n\n"
)}

${bold("That's all I know, unfortunately!")}
  `.trim();
}

export function duplicateInputs(
  duplicates: NonEmptyArray<{
    inputs: NonEmptyArray<InputPath>;
    resolved: AbsolutePath;
  }>
): string {
  const isSymlink = (inputPath: InputPath): boolean =>
    inputPath.theInputPath.absolutePath !== inputPath.realpath.absolutePath;

  const hasSymlink = duplicates.some(({ inputs }) => inputs.some(isSymlink));

  const symlinkText = hasSymlink
    ? `\nNote that at least one of the inputs seem to be a symlink. They can be tricky!`
    : "";

  return `
Some of your inputs seem to be duplicates!

${join(
  mapNonEmptyArray(duplicates, ({ inputs, resolved }) =>
    join(
      [
        ...mapNonEmptyArray(inputs, (inputPath) =>
          isSymlink(inputPath)
            ? `${inputPath.originalString} ${dim("(symlink)")}`
            : inputPath.originalString
        ),
        `-> ${resolved.absolutePath}`,
      ],
      "\n"
    )
  ),
  "\n\n"
)}

Make sure every input is listed just once!${symlinkText}
  `.trim();
}
