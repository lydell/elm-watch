import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { DecoderError } from "tiny-decoders";
import * as url from "url";

import * as ElmWatchJson from "./ElmWatchJson";
import { Env } from "./Env";
import { bold, dim, join, JsonError, removeColor, toError } from "./Helpers";
import { IS_WINDOWS } from "./IsWindows";
import { DEFAULT_COLUMNS } from "./Logger";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { absolutePathFromString } from "./PathHelpers";
import { Port } from "./Port";
import {
  ELM_WATCH_NODE,
  ElmWatchNodePublicArgs,
  UnknownValueAsString,
} from "./PostprocessShared";
import { Command, ExitReason } from "./Spawn";
import {
  AbsolutePath,
  CliArg,
  Cwd,
  ElmJsonPath,
  ElmWatchJsonPath,
  ElmWatchNodeScriptPath,
  ElmWatchStuffJsonPath,
  InputPath,
  OutputPath,
  RunMode,
  UncheckedInputPath,
  WriteOutputErrorReasonForWriting,
} from "./Types";

const elmJson = bold("elm.json");
const elmWatchJson = bold("elm-watch.json");
const elmWatchStuffJson = bold("elm-stuff/elm-watch-stuff.json");

type FancyErrorLocation =
  | ElmJsonPath
  | ElmWatchJsonPath
  | ElmWatchNodeScriptPath
  | ElmWatchStuffJsonPath
  | OutputPath
  | { tag: "Custom"; location: string }
  | { tag: "NoLocation" };

export const fancyError =
  (title: string, location: FancyErrorLocation) =>
  (
    strings: TemplateStringsArray,
    ...values: Array<string | ((width: number) => string)>
  ) =>
  (width: number): string => {
    const content = join(
      strings.flatMap((string, index) => {
        const value = values[index] ?? "";
        return [
          string,
          typeof value === "function" ? value(width) : value.trim(),
        ];
      }),
      ""
    ).trim();

    const prefix = `-- ${title} `;
    const line = "-".repeat(Math.max(0, width - prefix.length));
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

export function toPlainString(errorTemplate: ErrorTemplate): string {
  return removeColor(errorTemplate(DEFAULT_COLUMNS));
}

function fancyErrorLocation(location: FancyErrorLocation): string | undefined {
  switch (location.tag) {
    case "ElmJsonPath":
      return location.theElmJsonPath.absolutePath;
    case "ElmWatchJsonPath":
      return location.theElmWatchJsonPath.absolutePath;
    case "ElmWatchStuffJsonPath":
      return location.theElmWatchStuffJsonPath.absolutePath;
    case "OutputPath":
      return dim(`Target: ${location.targetName}`);
    case "ElmWatchNodeScriptPath":
      return url.fileURLToPath(location.theElmWatchNodeScriptFileUrl);
    case "Custom":
      return location.location;
    case "NoLocation":
      return undefined;
  }
}

export type ErrorTemplate = (width: number) => string;

export function readElmWatchJsonAsJson(
  elmWatchJsonPath: ElmWatchJsonPath,
  error: Error
): ErrorTemplate {
  return fancyError("TROUBLE READING elm-watch.json", elmWatchJsonPath)`
I read inputs, outputs and options from ${elmWatchJson}.

${bold("I had trouble reading it as JSON:")}

${error.message}
`;
}

export function decodeElmWatchJson(
  elmWatchJsonPath: ElmWatchJsonPath,
  error: JsonError
): ErrorTemplate {
  return fancyError("INVALID elm-watch.json FORMAT", elmWatchJsonPath)`
I read inputs, outputs and options from ${elmWatchJson}.

${bold("I had trouble with the JSON inside:")}

${printJsonError(error)}
`;
}

export function elmWatchJsonNotFound(
  cwd: Cwd,
  args: Array<CliArg>
): ErrorTemplate {
  const example = ElmWatchJson.example(
    cwd,
    {
      tag: "ElmWatchJsonPath",
      theElmWatchJsonPath: absolutePathFromString(cwd.path, "elm-watch.json"),
    },
    ElmWatchJson.parseArgsLikeElmMake(args)
  );

  return fancyError("elm-watch.json NOT FOUND", { tag: "NoLocation" })`
I read inputs, outputs and options from ${elmWatchJson}.

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

export function unknownFlags(
  cwd: Cwd,
  elmWatchJsonPath: ElmWatchJsonPath,
  runMode: RunMode,
  args: Array<CliArg>,
  theUnknownFlags: NonEmptyArray<CliArg>
): ErrorTemplate {
  const elmMakeParsed = ElmWatchJson.parseArgsLikeElmMake(args);

  const extra =
    elmMakeParsed.output !== undefined
      ? `
It looks like your arguments might fit in an ${bold("elm make")} command.
If so, you could try moving them to the ${elmWatchJson} I found here:

${elmWatchJsonPath.theElmWatchJsonPath.absolutePath}

For example, you could add some JSON like this:

${ElmWatchJson.example(cwd, elmWatchJsonPath, elmMakeParsed)}
  `
      : "";

  return fancyError("UNEXPECTED FLAGS", { tag: "NoLocation" })`
${printRunModeArgsHelp(runMode)}

But you provided these flag-looking args:

${join(
  theUnknownFlags.map((arg) => arg.theArg),
  "\n"
)}

Try removing those extra flags!

${extra}
`;
}

function printRunModeArgsHelp(runMode: RunMode): string {
  switch (runMode) {
    case "make":
      return `The ${bold(runMode)} command only accepts the flags ${bold(
        "--debug"
      )} and ${bold("--optimize")}.`;

    case "hot":
      return `The ${bold(runMode)} command only accepts no flags at all.`;
  }
}

export function unknownTargetsSubstrings(
  elmWatchJsonPath: ElmWatchJsonPath,
  knownTargets: NonEmptyArray<string>,
  theUnknownTargetsSubstrings: NonEmptyArray<string>
): ErrorTemplate {
  return fancyError("UNKNOWN TARGETS SUBSTRINGS", elmWatchJsonPath)`
I read inputs, outputs and options from ${elmWatchJson}.

It contains these targets:

${join(knownTargets, "\n")}

${bold("But none of those match these substrings you gave me:")}

${join(theUnknownTargetsSubstrings, "\n")}

Is something misspelled?
Or do you need to add some more targets?
`;
}

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

Either split this target, or move the inputs to the same project with the same
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

export function duplicateOutputs(
  elmWatchJsonPath: ElmWatchJsonPath,
  duplicates: NonEmptyArray<{
    originalOutputPathStrings: NonEmptyArray<string>;
    absolutePath: AbsolutePath;
  }>
): ErrorTemplate {
  return fancyError("DUPLICATE OUTPUTS", elmWatchJsonPath)`
Some of your outputs seem to be duplicates!

${join(
  mapNonEmptyArray(duplicates, ({ originalOutputPathStrings, absolutePath }) =>
    join(
      [...originalOutputPathStrings, `-> ${absolutePath.absolutePath}`],
      "\n"
    )
  ),
  "\n\n"
)}

Make sure every output is listed just once!
`;
}

export function elmNotFoundError(
  location: ElmJsonPath | OutputPath,
  command: Command
): ErrorTemplate {
  return fancyError("ELM NOT FOUND", location)`
I tried to execute ${bold(command.command)}, but it does not appear to exist!

${printPATH(command.options.env, IS_WINDOWS)}

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

${printPATH(command.options.env, IS_WINDOWS)}

Is ${bold(command.command)} installed?
`;
}

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

export function postprocessStdinWriteError(
  location: ElmJsonPath | OutputPath,
  error: Error,
  command: Command
): ErrorTemplate {
  return fancyError("POSTPROCESS STDIN TROUBLE", location)`
I tried to run your postprocess command:

${printCommand(command)}

Trying to write to its ${bold("stdin")}, I got an error!
${bold("Did you forget to read stdin, maybe?")}

Note: If you don't need stdin in some case, you can pipe it to stdout!

This is the error message I got:

${error.message}
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
  elmWatchJsonPath: ElmWatchJsonPath
): ErrorTemplate {
  return fancyError("MISSING POSTPROCESS SCRIPT", elmWatchJsonPath)`
You have specified this in ${elmWatchJson}:

"postprocess": [${JSON.stringify(ELM_WATCH_NODE)}]

You need to specify a JavaScript file to run as well, like so:

"postprocess": [${JSON.stringify(ELM_WATCH_NODE)}, "postprocess.js"]
`;
}

export function elmWatchNodeImportError(
  scriptPath: ElmWatchNodeScriptPath,
  error: UnknownValueAsString,
  stdout: string,
  stderr: string
): ErrorTemplate {
  return fancyError("POSTPROCESS IMPORT ERROR", scriptPath)`
I tried to import your postprocess file:

${printElmWatchNodeImportCommand(scriptPath)}

But that resulted in this error:

${printUnknownValueAsString(error)}

${printElmWatchNodeStdio(stdout, stderr)}
`;
}

export function elmWatchNodeDefaultExportNotFunction(
  scriptPath: ElmWatchNodeScriptPath,
  imported: UnknownValueAsString,
  typeofDefault: string,
  stdout: string,
  stderr: string
): ErrorTemplate {
  return fancyError("MISSING POSTPROCESS DEFAULT EXPORT", scriptPath)`
I imported your postprocess file:

${printElmWatchNodeImportCommand(scriptPath)}

I expected ${bold("imported.default")} to be a function, but it isn't!

typeof imported.default === ${JSON.stringify(typeofDefault)}

${bold("imported")} is:

${printUnknownValueAsString(imported)}

${printElmWatchNodeStdio(stdout, stderr)}
`;
}

export function elmWatchNodeRunError(
  scriptPath: ElmWatchNodeScriptPath,
  args: ElmWatchNodePublicArgs,
  error: UnknownValueAsString,
  stdout: string,
  stderr: string
): ErrorTemplate {
  return fancyError("POSTPROCESS RUN ERROR", scriptPath)`
I tried to run your postprocess command:

${printElmWatchNodeImportCommand(scriptPath)}
${printElmWatchNodeRunCommand(args)}

But that resulted in this error:

${printUnknownValueAsString(error)}

${printElmWatchNodeStdio(stdout, stderr)}
`;
}

export function elmWatchNodeBadReturnValue(
  scriptPath: ElmWatchNodeScriptPath,
  args: ElmWatchNodePublicArgs,
  returnValue: UnknownValueAsString,
  stdout: string,
  stderr: string
): ErrorTemplate {
  return fancyError("INVALID POSTPROCESS RESULT", scriptPath)`
I ran your postprocess command:

${printElmWatchNodeImportCommand(scriptPath)}
${printElmWatchNodeRunCommand(args)}

I expected ${bold("result")} to be a string, but it is:

${printUnknownValueAsString(returnValue)}

${printElmWatchNodeStdio(stdout, stderr)}
`;
}

export function elmMakeJsonParseError(
  outputPath: OutputPath | { tag: "NoLocation" },
  error: JsonError,
  errorFilePath: ErrorFilePath,
  command: Command
): ErrorTemplate {
  return fancyError("TROUBLE WITH JSON REPORT", outputPath)`
I ran the following commands:

${printCommand(command)}

I seem to have gotten some JSON back as expected,
but I ran into an error when decoding it:

${printJsonError(error)}

${printErrorFilePath(errorFilePath)}
`;
}

export function stuckInProgressState(
  outputPath: OutputPath,
  state: string
): ErrorTemplate {
  return fancyError("STUCK IN PROGRESS", outputPath)`
I thought that all outputs had finished compiling, but my inner state says
this target is still in the ${bold(state)} phase.

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

export function readElmJsonAsJson(
  elmJsonPath: ElmJsonPath,
  error: Error
): ErrorTemplate {
  return fancyError("TROUBLE READING elm.json", elmJsonPath)`
I read "source-directories" from ${elmJson} when figuring out all Elm files that
your inputs depend on.

${bold("I had trouble reading it as JSON:")}

${error.message}

(I still managed to compile your code, but the watcher will not work properly
and "postprocess" was not run.)
`;
}

export function decodeElmJson(
  elmJsonPath: ElmJsonPath,
  error: JsonError
): ErrorTemplate {
  return fancyError("INVALID elm.json FORMAT", elmJsonPath)`
I read "source-directories" from ${elmJson} when figuring out all Elm files that
your inputs depend on.

${bold("I had trouble with the JSON inside:")}

${printJsonError(error)}

(I still managed to compile your code, but the watcher will not work properly
and "postprocess" was not run.)
`;
}

export function readElmWatchStuffJsonAsJson(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath,
  error: Error
): ErrorTemplate {
  return fancyError(
    "TROUBLE READING elm-stuff/elm-watch-stuff.json",
    elmWatchStuffJsonPath
  )`
I read stuff from ${elmWatchStuffJson} to remember some things between runs.

${bold("I had trouble reading it as JSON:")}

${error.message}

This file is created by elm-watch, so reading it should never fail really.
You could try removing that file (it contains nothing essential).
`;
}

export function decodeElmWatchStuffJson(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath,
  error: JsonError
): ErrorTemplate {
  return fancyError(
    "INVALID elm-stuff/elm-watch-stuff.json FORMAT",
    elmWatchStuffJsonPath
  )`
I read stuff from ${elmWatchStuffJson} to remember some things between runs.

${bold("I had trouble with the JSON inside:")}

${printJsonError(error)}

This file is created by elm-watch, so reading it should never fail really.
You could try removing that file (it contains nothing essential).
`;
}

export function elmWatchStuffJsonWriteError(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath,
  error: Error
): ErrorTemplate {
  return fancyError(
    "TROUBLE WRITING elm-stuff/elm-watch-stuff.json",
    elmWatchStuffJsonPath
  )`
I write stuff to ${elmWatchStuffJson} to remember some things between runs.

${bold("I had trouble writing that file:")}

${error.message}

The file contains nothing essential, but something weird is going on.
`;
}

export function importWalkerFileSystemError(
  outputPath: OutputPath,
  error: Error
): ErrorTemplate {
  return fancyError("TROUBLE READING ELM FILES", outputPath)`
When figuring out all Elm files that your inputs depend on I read a lot of Elm files.
Doing so I encountered this error:

${error.message}

(I still managed to compile your code, but the watcher will not work properly
and "postprocess" was not run.)
`;
}

export function readOutputError(
  outputPath: OutputPath,
  error: Error,
  triedPath: AbsolutePath
): ErrorTemplate {
  return fancyError("TROUBLE READING OUTPUT", outputPath)`
I managed to compile your code. Then I tried to read the output:

${triedPath.absolutePath}

Doing so I encountered this error:

${error.message}
`;
}

export function writeOutputError(
  outputPath: OutputPath,
  error: Error,
  reasonForWriting: WriteOutputErrorReasonForWriting
): ErrorTemplate {
  return fancyError("TROUBLE WRITING OUTPUT", outputPath)`
I managed to compile your code and read the generated file:

${outputPath.temporaryOutputPath.absolutePath}

${printWriteOutputErrorReasonForWriting(reasonForWriting)}

${outputPath.theOutputPath.absolutePath}

But I encountered this error:

${error.message}
`;
}

function printWriteOutputErrorReasonForWriting(
  reasonForWriting: WriteOutputErrorReasonForWriting
): string {
  switch (reasonForWriting) {
    case "InjectWebSocketClient":
      return "I injected code for hot reloading, and then tried to write that to the output path:";

    case "Postprocess":
      return "After running your postprocess command, I tried to write the result of that to the output path:";
  }
}

export function writeProxyOutputError(
  outputPath: OutputPath,
  error: Error
): ErrorTemplate {
  return fancyError("TROUBLE WRITING DUMMY OUTPUT", outputPath)`
There are no websocket connections for this target, so I only typecheck the
code. That went well. Then I tried to write a dummy output file here:

${outputPath.theOutputPath.absolutePath}

Doing so I encountered this error:

${error.message}
`;
}

export function portConflictForNoPort(error: Error): ErrorTemplate {
  return fancyError("PORT CONFLICT", { tag: "NoLocation" })`
I ask the operating system for an arbitrary available port for the
web socket server.

The operating system is supposed to always be able to find an available port,
but it looks like that wasn't the case this time!

This is the error message I got:

${error.message}
  `;
}

export function portConflictForPersistedPort(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath,
  port: Port
): ErrorTemplate {
  return fancyError("PORT CONFLICT", elmWatchStuffJsonPath)`
I ask the operating system for an arbitrary available port for the
web socket server.

I then save the port I got to ${elmWatchStuffJson}. Otherwise I would
get a new port number on each restart, which means that if you had tabs
open in the browser they would try to connect to the old port number.

I tried to use such a saved port number from a previous run (or from previous
configuration). But now that port (${port.thePort.toString()}) wasn't available!

Most likely you already have elm-watch running somewhere else! If so,
find it and use that, or kill it.

If not, something else could have started using port ${port.thePort.toString()}
(though it's not very likely.) Then you can either try to find what that is,
or remove ${elmWatchStuffJson} here:

${elmWatchStuffJsonPath.theElmWatchStuffJsonPath.absolutePath}

Then I will ask the operating system for a new arbitrary available port.
  `;
}

export function portConflictForPortFromConfig(
  elmWatchJsonPath: ElmWatchJsonPath,
  port: Port
): ErrorTemplate {
  return fancyError("PORT CONFLICT", elmWatchJsonPath)`
In your ${elmWatchJson} you have this:

"port": ${JSON.stringify(port.thePort)}

But something else seems to already be running on that port!
You might already have elm-watch running somewhere, or it could be a completely
different program.

You need to either find and stop that other thing, switch to another port or
remove "port" from ${elmWatchJson} (which will use an arbitrary available port.)
  `;
}

export function watcherError(error: Error): ErrorTemplate {
  return fancyError("WATCHER ERROR", { tag: "NoLocation" })`
The file watcher encountered an error, which means that it cannot continue.
elm-watch is powered by its file watcher, so I have to exit at this point.

See if this is something you can solve by maybe removing some problematic files
or something!

This is the error message I got:

${error.message}
  `;
}

export function webSocketBadUrl(
  expectedStart: string,
  actualUrlString: string
): string {
  return `
I expected the web socket connection URL to start with:

${expectedStart}

But it looks like this:

${actualUrlString}

The web socket code I generate is supposed to always connect using a correct URL, so something is up here.
  `.trim();
}

export function webSocketParamsDecodeError(
  error: JsonError,
  actualUrlString: string
): string {
  return `
I ran into trouble parsing the web socket connection URL parameters:

${printJsonError(error)}

The URL looks like this:

${actualUrlString}

The web socket code I generate is supposed to always connect using a correct URL, so something is up here. Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
  `.trim();
}

export function webSocketWrongVersion(
  expectedVersion: string,
  actualVersion: string
): string {
  return `
The compiled JavaScript code running in the browser says it was compiled with:

elm-watch ${actualVersion}

But the server is:

elm-watch ${expectedVersion}

Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
  `.trim();
}

export function webSocketTargetNotFound(
  targetName: string,
  enabledOutputs: Array<OutputPath>,
  disabledOutputs: Array<OutputPath>
): string {
  const extra = isNonEmptyArray(disabledOutputs)
    ? `

These targets are also available in elm-watch.json, but are not enabled (because of the CLI arguments passed):

${join(
  mapNonEmptyArray(disabledOutputs, (outputPath) => outputPath.targetName),
  "\n"
)}
  `.trimEnd()
    : "";

  return `
The compiled JavaScript code running in the browser says it is for this target:

${targetName}

But I can't find that target in elm-watch.json!

These targets are available in elm-watch.json:

${join(
  enabledOutputs.map((outputPath) => outputPath.targetName),
  "\n"
)}${extra}

Maybe this target used to exist in elm-watch.json, but you removed or changed it?
  `.trim();
}

export function webSocketTargetDisabled(
  targetName: string,
  enabledOutputs: Array<OutputPath>,
  disabledOutputs: Array<OutputPath>
): string {
  return `
The compiled JavaScript code running in the browser says it is for this target:

${targetName}

That target does exist in elm-watch.json, but isn't enabled.

These targets are enabled via CLI arguments:

${join(
  enabledOutputs.map((outputPath) => outputPath.targetName),
  "\n"
)}

These targets exist in elm-watch.json but aren't enabled:

${join(
  disabledOutputs.map((outputPath) => outputPath.targetName),
  "\n"
)}

If you want to have this target compiled, restart elm-watch either with more CLI arguments or no CLI arguments at all!
  `.trim();
}

export function webSocketDecodeError(error: JsonError): string {
  return `
The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

${printJsonError(error)}

The web socket code I generate is supposed to always send correct messages, so something is up here.
  `.trim();
}

export function printPATH(env: Env, isWindows: boolean): string {
  if (isWindows) {
    return printPATHWindows(env);
  }

  const { PATH } = env;

  if (PATH === undefined) {
    return "I can't find any program, because process.env.PATH is undefined!";
  }

  const pathList = PATH.split(path.delimiter);

  return `
This is what the PATH environment variable looks like:

${join(pathList, "\n")}
  `.trim();
}

function printPATHWindows(env: Env): string {
  const pathEntries = Object.entries(env).flatMap(([key, value]) =>
    key.toUpperCase() === "PATH" && value !== undefined
      ? [[key, value] as const]
      : []
  );

  if (!isNonEmptyArray(pathEntries)) {
    return "I can't find any program, because I can't find any PATH-like environment variables!";
  }

  if (pathEntries.length === 1) {
    const [key, value] = pathEntries[0];
    return `
This is what the ${key} environment variable looks like:

${join(value.split(path.delimiter), "\n")}
    `.trim();
  }

  const pathEntriesString = join(
    pathEntries.map(([key, value]) =>
      join([`${key}:`, ...value.split(path.delimiter)], "\n")
    ),
    "\n\n"
  );

  return `
You seem to have several PATH-like environment variables set. The last one
should be the one that is actually used, but it's better to have a single one!

${pathEntriesString}
  `.trim();
}

function printCommand(command: Command): string {
  const stdin =
    command.stdin === undefined
      ? ""
      : `${commandToPresentationName([
          "printf",
          truncate(command.stdin.toString("utf8")),
        ])} | `;
  return `
${commandToPresentationName(["cd", command.options.cwd.absolutePath])}
${stdin}${commandToPresentationName([command.command, ...command.args])}
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
    case "Signal":
      return `signal ${exitReason.signal}`;
    case "Unknown":
      return "unknown exit reason";
  }
}

export const printStdio =
  (stdout: string, stderr: string) =>
  (width: number): string =>
    stdout !== "" && stderr === ""
      ? limitStdio(stdout, width)
      : stdout === "" && stderr !== ""
      ? limitStdio(stderr, width)
      : stdout === "" && stderr === ""
      ? dim("(no output)")
      : `
STDOUT:
${limitStdio(stdout, width)}

STDERR:
${limitStdio(stderr, width)}
`.trim();

const printElmWatchNodeStdio =
  (stdout: string, stderr: string) =>
  (width: number): string =>
    stdout === "" && stderr === ""
      ? ""
      : `
STDOUT:
${limitStdio(stdout, width)}

STDERR:
${limitStdio(stderr, width)}
`.trim();

// Limit `string` to take at most 100 lines of terminal (roughly).
// It doesn’t need to be precise. As long as we don’t print megabytes of
// JavaScript that completely destroys the error message we’re good.
function limitStdio(string: string, width: number): string {
  const max = 100;
  const lines = string.trimEnd().split("\n");
  const result: Array<string> = [];
  let usedLines = 0;

  for (const line of lines) {
    const count = Math.ceil(line.length / width);
    const available = max - usedLines;
    if (available <= 0) {
      break;
    } else if (count > available) {
      const take = available * width;
      const left = line.length - take;
      result.push(
        `${line.slice(0, take)} ${dim(
          left === 1 ? "1 more character" : `${left} more characters`
        )}`
      );
      usedLines += available;
      break;
    } else {
      result.push(line);
      usedLines += count;
    }
  }

  const joined = join(result, "\n");
  const left = lines.length - result.length;

  return left > 0
    ? `${joined}\n${dim(left === 1 ? "1 more line" : `${left} more lines`)}`
    : joined;
}

function printErrorFilePath(errorFilePath: ErrorFilePath): string {
  switch (errorFilePath.tag) {
    case "AbsolutePath":
      return `
I wrote that to this file so you can inspect it:

${errorFilePath.absolutePath}
      `.trim();

    case "WritingErrorFileFailed":
      return `
I tried to write that to this file:

${errorFilePath.attemptedPath.absolutePath}

${bold("But that failed too:")}

${errorFilePath.error.message}
      `.trim();

    case "ErrorFileBadContent":
      return `
I wrote this error to a file so you can inspect and possibly report it more easily.

This is the data that caused the error:

${errorFilePath.content}
      `.trim();
  }
}

function printUnknownValueAsString(value: UnknownValueAsString): string {
  switch (value.tag) {
    case "UnknownValueAsString":
      return value.value;
  }
}

function printElmWatchNodeImportCommand(
  scriptPath: ElmWatchNodeScriptPath
): string {
  return `const imported = await import(${JSON.stringify(
    scriptPath.theElmWatchNodeScriptFileUrl
  )})`;
}

function printElmWatchNodeRunCommand(args: ElmWatchNodePublicArgs): string {
  const truncated = {
    ...args,
    code: truncate(args.code),
  };
  return `const result = await imported.default(${JSON.stringify(
    truncated,
    null,
    2
  )})`;
}

function truncate(string: string): string {
  const roughLimit = 20;
  const half = Math.floor(roughLimit / 2);
  return string.length <= roughLimit
    ? // istanbul ignore next
      string
    : `${string.slice(0, half)}...${string.slice(-half)}`;
}

function printJsonError(error: JsonError): string {
  return error instanceof DecoderError ? error.format() : error.message;
}

export type ErrorFilePath =
  | AbsolutePath
  | {
      tag: "ErrorFileBadContent";
      content: string;
    }
  | {
      tag: "WritingErrorFileFailed";
      error: Error;
      attemptedPath: AbsolutePath;
    };

export function tryWriteErrorFile({
  cwd,
  name,
  content,
  hash,
}: {
  cwd: AbsolutePath;
  name: string;
  content: string;
  hash: string;
}): ErrorFilePath {
  // The SHA256 is only based on the `hash` string, not the entire error message
  // `content`. This makes the tests easier to update when tweaking the error message.
  const jsonPath = absolutePathFromString(
    cwd,
    `elm-watch-${name}-${sha256(hash)}.txt`
  );
  try {
    fs.writeFileSync(jsonPath.absolutePath, content);
    return jsonPath;
  } catch (unknownError) {
    const error = toError(unknownError);
    return {
      tag: "WritingErrorFileFailed",
      error,
      attemptedPath: jsonPath,
    };
  }
}

function sha256(string: string): string {
  return crypto.createHash("sha256").update(string).digest("hex");
}
