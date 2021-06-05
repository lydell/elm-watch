import * as path from "path";
import getPathKey from "path-key";
import { DecoderError } from "tiny-decoders";

import * as ElmToolingJson from "./ElmToolingJson";
import { bold, dim, Env, join } from "./Helpers";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { AbsolutePath, absolutePathFromString, Cwd } from "./PathHelpers";
import { ElmWatchNodeResult } from "./Postprocess";
import { Command, ExitReason } from "./Spawn";
import { JsonPath } from "./SpawnElm";
import { UncheckedInputPath } from "./State";
import {
  CliArg,
  ElmJsonPath,
  ElmToolingJsonPath,
  ElmWatchNodeScriptPath,
  InputPath,
  OutputPath,
} from "./Types";

const elmJson = bold("elm.json");
const elmToolingJson = bold("elm-tooling.json");

type FancyErrorLocation =
  | ElmJsonPath
  | ElmToolingJsonPath
  | ElmWatchNodeScriptPath
  | OutputPath
  | { tag: "Custom"; location: string }
  | { tag: "NoLocation" };

export const fancyError =
  (title: string, location: FancyErrorLocation) =>
  (strings: TemplateStringsArray, ...values: Array<string>) =>
  (width: number): string => {
    const content = join(
      strings.flatMap((string, index) => [
        string,
        (values[index] ?? "").trim(),
      ]),
      ""
    ).trim();

    const prefix = `-- ${title} `;
    const line = "-".repeat(width - prefix.length);
    const titleWithSeparator = bold(`${prefix}${line}`);
    const maybeLocation = fancyErrorLocation(location);

    return join(
      [
        titleWithSeparator,
        ...(maybeLocation === undefined ? [] : [maybeLocation]),
        "",
        content,
      ],
      "\n"
    );
  };

function fancyErrorLocation(location: FancyErrorLocation): string | undefined {
  switch (location.tag) {
    case "ElmJsonPath":
      return location.theElmJsonPath.absolutePath;
    case "ElmToolingJsonPath":
      return location.theElmToolingJsonPath.absolutePath;
    case "OutputPath":
      return dim(`When compiling: ${location.originalString}`);
    case "NullOutputPath":
      return dim("When compiling to /dev/null");
    case "ElmWatchNodeScriptPath":
      return location.theElmWatchNodeScriptPath.absolutePath;
    case "Custom":
      return location.location;
    case "NoLocation":
      return undefined;
  }
}

export type ErrorTemplate = (width: number) => string;

export function readElmToolingJsonAsJson(
  elmToolingJsonPath: ElmToolingJsonPath,
  error: Error
): ErrorTemplate {
  return fancyError("TROUBLE READING elm-tooling.json", elmToolingJsonPath)`
I read inputs, outputs and options from ${elmToolingJson}.

${bold("I had trouble reading it as JSON:")}

${error.message}
`;
}

export function decodeElmToolingJson(
  elmToolingJsonPath: ElmToolingJsonPath,
  error: DecoderError
): ErrorTemplate {
  return fancyError("INVALID elm-tooling.json FORMAT", elmToolingJsonPath)`
I read inputs, outputs and options from ${elmToolingJson}.

${bold("I had trouble with the JSON inside:")}

${error.format()}
`;
}

export function elmToolingJsonNotFound(
  cwd: Cwd,
  args: Array<CliArg>
): ErrorTemplate {
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

  return fancyError("elm-tooling.json NOT FOUND", { tag: "NoLocation" })`
I read inputs, outputs and options from ${elmToolingJson}.

${bold("But I couldn't find one!")}

You need to create one with JSON like this:

${example}
`;
}

export function debugOptimizeForHot(): ErrorTemplate {
  const make = bold("elm-watch make");
  const hot = bold("elm-watch hot");
  return fancyError("REDUNDANT FLAGS", { tag: "NoLocation" })`
${bold("--debug")} and ${bold("--optimize")} only make sense for ${make}.
When using ${hot}, you can switch mode in the browser.
`;
}

export function debugOptimizeClash(): ErrorTemplate {
  return fancyError("CLASHING FLAGS", { tag: "NoLocation" })`
${bold("--debug")} and ${bold("--optimize")} cannot be used at the same time.
`;
}

export function badArgs(
  cwd: Cwd,
  elmToolingJsonPath: ElmToolingJsonPath,
  args: Array<CliArg>,
  theBadArgs: NonEmptyArray<CliArg>
): ErrorTemplate {
  return fancyError("UNEXPECTED ARGUMENTS", { tag: "NoLocation" })`
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
`;
}

export function unknownOutputs(
  elmToolingJsonPath: ElmToolingJsonPath,
  knownOutputs: NonEmptyArray<string>,
  theUnknownOutputs: NonEmptyArray<string>
): ErrorTemplate {
  return fancyError("UNKNOWN OUTPUTS", elmToolingJsonPath)`
I read inputs, outputs and options from ${elmToolingJson}.

It contains these outputs:

${join(knownOutputs, "\n")}

${bold("But those don't include these outputs you asked me to build:")}

${join(theUnknownOutputs, "\n")}

Is something misspelled? (You need to type them exactly the same.)
Or do you need to add some more outputs?
`;
}

// istanbul ignore next
export function noCommonRoot(
  paths: NonEmptyArray<AbsolutePath>
): ErrorTemplate {
  return fancyError("NO COMMON ROOT", { tag: "NoLocation" })`
I could not find a common ancestor for these paths:

${join(
  mapNonEmptyArray(paths, (thePath) => thePath.absolutePath),
  "\n"
)}

${bold("Compiling files on different drives is not supported.")}
`;
}

export function elmJsonNotFound(
  outputPath: OutputPath,
  inputs: NonEmptyArray<InputPath>,
  foundElmJsonPaths: Array<{
    inputPath: InputPath;
    elmJsonPath: ElmJsonPath;
  }>
): ErrorTemplate {
  const extra = isNonEmptyArray(foundElmJsonPaths)
    ? `
Note that I did find an ${elmJson} for some inputs:

${join(
  mapNonEmptyArray(
    foundElmJsonPaths,
    ({ inputPath, elmJsonPath }) =>
      `${inputPath.originalString}\n-> ${elmJsonPath.theElmJsonPath.absolutePath}`
  ),
  "\n\n"
)}

Make sure that one single ${elmJson} covers all the inputs together!
      `
    : "";

  return fancyError("elm.json NOT FOUND", outputPath)`
I could not find an ${elmJson} for these inputs:

${join(
  mapNonEmptyArray(inputs, (inputPath) => inputPath.originalString),
  "\n"
)}

Has it gone missing? Maybe run ${bold("elm init")} to create one?

${extra}
`;
}

export function nonUniqueElmJsonPaths(
  outputPath: OutputPath,
  theNonUniqueElmJsonPaths: NonEmptyArray<{
    inputPath: InputPath;
    elmJsonPath: ElmJsonPath;
  }>
): ErrorTemplate {
  return fancyError("NO UNIQUE elm.json", outputPath)`
I went looking for an ${elmJson} for your inputs, but I found more than one!

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
${elmJson}.
`;
}

export function inputsNotFound(
  outputPath: OutputPath,
  inputs: NonEmptyArray<UncheckedInputPath>
): ErrorTemplate {
  return fancyError("INPUTS NOT FOUND", outputPath)`
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
`;
}

export function inputsFailedToResolve(
  outputPath: OutputPath,
  inputs: NonEmptyArray<{ inputPath: UncheckedInputPath; error: Error }>
): ErrorTemplate {
  return fancyError("INPUTS FAILED TO RESOLVE", outputPath)`
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
`;
}

export function duplicateInputs(
  outputPath: OutputPath,
  duplicates: NonEmptyArray<{
    inputs: NonEmptyArray<InputPath>;
    resolved: AbsolutePath;
  }>
): ErrorTemplate {
  const isSymlink = (inputPath: InputPath): boolean =>
    inputPath.theInputPath.absolutePath !== inputPath.realpath.absolutePath;

  const hasSymlink = duplicates.some(({ inputs }) => inputs.some(isSymlink));

  const symlinkText = hasSymlink
    ? "Note that at least one of the inputs seems to be a symlink. They can be tricky!"
    : "";

  return fancyError("DUPLICATE INPUTS", outputPath)`
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

Make sure every input is listed just once!

${symlinkText}
`;
}

export function elmNotFoundError(
  location: ElmJsonPath | OutputPath,
  command: Command
): ErrorTemplate {
  return fancyError("ELM NOT FOUND", location)`
I tried to execute ${bold(command.command)}, but it does not appear to exist!

This is what the PATH environment variable looks like:

${printPATH(command.options.env)}

Is Elm installed?

Note: If you have installed Elm locally (for example using npm or elm-tooling),
execute elm-watch using npx to make elm-watch automatically pick up that local
installation: ${bold("npx elm-watch")}
`;
}

export function commandNotFoundError(
  outputPath: OutputPath,
  command: Command
): ErrorTemplate {
  return fancyError("COMMAND NOT FOUND", outputPath)`
I tried to execute ${bold(command.command)}, but it does not appear to exist!

This is what the PATH environment variable looks like:

${printPATH(command.options.env)}

Is ${bold(command.command)} installed?
`;
}

// istanbul ignore next
export function otherSpawnError(
  location: ElmJsonPath | OutputPath,
  error: Error,
  command: Command
): ErrorTemplate {
  return fancyError("TROUBLE SPAWNING COMMAND", location)`
I tried to execute ${bold(command.command)}, but I ran into an error!

${error.message}

This happened when trying to run the following commands:

${printCommand(command)}
`;
}

export function unexpectedElmMakeOutput(
  outputPath: OutputPath,
  exitReason: ExitReason,
  stdout: string,
  stderr: string,
  command: Command
): ErrorTemplate {
  return fancyError("UNEXPECTED ELM OUTPUT", outputPath)`
I ran the following commands:

${printCommand(command)}

I expected it to either exit 0 with no output (success),
or exit 1 with JSON on stderr (compile errors).

${bold("But it exited like this:")}

${printExitReason(exitReason)}
${printStdio(stdout, stderr)}
`;
}

export function unexpectedElmInstallOutput(
  elmJsonPath: ElmJsonPath,
  exitReason: ExitReason,
  stdout: string,
  stderr: string,
  command: Command
): ErrorTemplate {
  return fancyError("UNEXPECTED ELM OUTPUT", elmJsonPath)`
I tried to make sure all packages are installed by running the following commands:

${printCommand(command)}

I expected it to either exit 0 with no output (success),
or exit 1 with an error I can recognize (using regex) on stderr.

${bold("But it exited like this:")}

${printExitReason(exitReason)}
${printStdio(stdout, stderr)}
`;
}

export function postprocessNonZeroExit(
  outputPath: OutputPath,
  exitReason: ExitReason,
  stdout: string,
  stderr: string,
  command: Command
): ErrorTemplate {
  return fancyError("POSTPROCESS ERROR", outputPath)`
I ran your postprocess command:

${printCommand(command)}

${bold("It exited with an error:")}

${printExitReason(exitReason)}
${printStdio(stdout, stderr)}
`;
}

export function elmWatchNodeMissingScript(
  elmToolingJsonPath: ElmToolingJsonPath
): ErrorTemplate {
  return fancyError("MISSING POSTPROCESS SCRIPT", elmToolingJsonPath)`
You have specified this in ${elmToolingJson}:

"postprocess": ["elm-watch-node"]

You need to specify a JavaScript file to run as well, like so:

"postprocess": ["elm-watch-node", "postprocess.js"]
`;
}

export function elmWatchNodeImportError(
  scriptPath: ElmWatchNodeScriptPath,
  error: unknown
): ErrorTemplate {
  const errorString: string =
    error instanceof Error
      ? (error as Error & { code?: string }).code === "ERR_MODULE_NOT_FOUND"
        ? error.message
        : error.stack ?? error.message
      : String(error);

  return fancyError("POSTPROCESS IMPORT ERROR", scriptPath)`
I tried to import your postprocess file:

${printElmWatchNodeImportCommand(scriptPath)}

But that resulted in this error:

${errorString}
`;
}

export function elmWatchNodeDefaultExportNotFunction(
  scriptPath: ElmWatchNodeScriptPath,
  imported: Record<string, unknown>
): ErrorTemplate {
  return fancyError("MISSING POSTPROCESS DEFAULT EXPORT", scriptPath)`
I imported your postprocess file:

${printElmWatchNodeImportCommand(scriptPath)}

I expected ${bold("imported.default")} to be a function, but it isn't!

typeof imported.default === ${JSON.stringify(typeof imported.default)}

These are the keys of ${bold("imported")}:

${JSON.stringify(Object.keys(imported), null, 2)}
`;
}

export function elmWatchNodeRunError(
  scriptPath: ElmWatchNodeScriptPath,
  args: Array<string>,
  error: unknown
): ErrorTemplate {
  const errorString: string =
    error instanceof Error ? error.stack ?? error.message : String(error);

  return fancyError("POSTPROCESS RUN ERROR", scriptPath)`
I tried to run your postprocess command:

${printElmWatchNodeImportCommand(scriptPath)}
${printElmWatchNodeRunCommand(args)}

But that resulted in this error:

${errorString}
`;
}

export function elmWatchNodeResultDecodeError(
  scriptPath: ElmWatchNodeScriptPath,
  args: Array<string>,
  error: DecoderError
): ErrorTemplate {
  return fancyError("INVALID POSTPROCESS RESULT", scriptPath)`
I ran your postprocess command:

${printElmWatchNodeImportCommand(scriptPath)}
${printElmWatchNodeRunCommand(args)}

But ${bold("result")} doesn't look like I expected:

${error.format()}
`;
}

export function elmWatchNodePostprocessNonZeroExitCode(
  scriptPath: ElmWatchNodeScriptPath,
  args: Array<string>,
  result: ElmWatchNodeResult
): ErrorTemplate {
  return fancyError("POSTPROCESS ERROR", scriptPath)`
I ran your postprocess command:

${printElmWatchNodeImportCommand(scriptPath)}
${printElmWatchNodeRunCommand(args)}

${bold("It exited with an error:")}

${printExitReason({ tag: "ExitCode", exitCode: result.exitCode })}
${printStdio(result.stdout, result.stderr)}
`;
}

export function elmMakeJsonParseError(
  outputPath: OutputPath,
  error: DecoderError | SyntaxError,
  jsonPath: JsonPath,
  command: Command
): ErrorTemplate {
  return fancyError("TROUBLE WITH JSON REPORT", outputPath)`
I ran the following commands:

${printCommand(command)}

I seem to have gotten some JSON back as expected,
but I ran into an error when decoding it:

${error instanceof DecoderError ? error.format() : error.message}

${printJsonPath(jsonPath)}
`;
}

// istanbul ignore next
export function stuckInProgressState(
  outputPath: OutputPath,
  state: string
): ErrorTemplate {
  return fancyError("STUCK IN PROGRESS", outputPath)`
I thought that all outputs had finished compiling, but my inner state says
this output is still in the ${bold(state)} phase.

${bold("This is not supposed to ever happen.")}
`;
}

export function creatingDummyFailed(
  elmJsonPath: ElmJsonPath,
  error: Error
): ErrorTemplate {
  return fancyError("FILE SYSTEM TROUBLE", elmJsonPath)`
I tried to make sure that all packages are installed. To do that, I need to
create a temporary dummy .elm file but that failed:

${error.message}
`;
}

export function elmInstallError(
  elmJsonPath: ElmJsonPath,
  title: string,
  message: string
): ErrorTemplate {
  return fancyError(title, elmJsonPath)`
${message}
`;
}

function printPATH(env: Env): string {
  const pathKey = getPathKey({ env });
  const { [pathKey]: PATH } = env;

  if (PATH === undefined) {
    return `process.env.${pathKey} is somehow undefined!`;
  }

  const pathList = PATH.split(path.delimiter);

  return join(pathList, "\n");
}

function printCommand(command: Command): string {
  return `
${commandToPresentationName(["cd", command.options.cwd.absolutePath])}
${commandToPresentationName([command.command, ...command.args])}
`;
}

function commandToPresentationName(command: NonEmptyArray<string>): string {
  return join(
    command.map((part) =>
      part === ""
        ? "''"
        : join(
            part
              .split(/(')/)
              .map((subPart) =>
                subPart === ""
                  ? ""
                  : subPart === "'"
                  ? "\\'"
                  : /^[\w.,:/=@%+-]+$/.test(subPart)
                  ? subPart
                  : `'${subPart}'`
              ),
            ""
          )
    ),
    " "
  );
}

function printExitReason(exitReason: ExitReason): string {
  switch (exitReason.tag) {
    case "ExitCode":
      return `exit ${exitReason.exitCode}`;
    // istanbul ignore next
    case "Signal":
      return `signal ${exitReason.signal}`;
    // istanbul ignore next
    case "Unknown":
      return "unknown exit reason";
  }
}

function printStdio(stdout: string, stderr: string): string {
  return stdout !== "" && stderr === ""
    ? stdout
    : stdout === "" && stderr !== ""
    ? stderr
    : stdout === "" && stderr === ""
    ? "(no output)"
    : `
STDOUT:
${stdout}
STDERR:
${stderr}
`;
}

function printJsonPath(jsonPath: JsonPath): string {
  switch (jsonPath.tag) {
    case "AbsolutePath":
      return `
I wrote the JSON to this file so you can inspect it:

${jsonPath.absolutePath}
      `;

    case "WritingJsonFailed":
      return `
I tried to write the JSON to this file:

${jsonPath.attemptedPath.absolutePath}

${bold("But that failed too:")}

${jsonPath.error.message}
      `;
  }
}

function printElmWatchNodeImportCommand(
  scriptPath: ElmWatchNodeScriptPath
): string {
  const scriptPathString: string =
    scriptPath.theElmWatchNodeScriptPath.absolutePath;
  return `const imported = await import(${JSON.stringify(scriptPathString)})`;
}

function printElmWatchNodeRunCommand(args: Array<string>): string {
  return `const result = await imported.default(${JSON.stringify(args)})`;
}
