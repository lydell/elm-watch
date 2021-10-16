import * as path from "path";
import { DecoderError, repr } from "tiny-decoders";

import * as ElmWatchJson from "./ElmWatchJson";
import {
  bold,
  dim,
  Env,
  IS_WINDOWS,
  join,
  JsonError,
  unknownErrorToString,
} from "./Helpers";
import {
  isNonEmptyArray,
  mapNonEmptyArray,
  NonEmptyArray,
} from "./NonEmptyArray";
import { AbsolutePath, absolutePathFromString, Cwd } from "./PathHelpers";
import { Port } from "./Port";
import {
  UncheckedInputPath,
  WriteOutputErrorReasonForWriting,
} from "./Project";
import { Command, ExitReason } from "./Spawn";
import { JsonPath } from "./SpawnElm";
import {
  CliArg,
  ElmJsonPath,
  ElmWatchJsonPath,
  ElmWatchNodeScriptPath,
  ElmWatchStuffJsonPath,
  InputPath,
  OutputPath,
  RunMode,
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
    case "ElmWatchJsonPath":
      return location.theElmWatchJsonPath.absolutePath;
    case "ElmWatchStuffJsonPath":
      return location.theElmWatchStuffJsonPath.absolutePath;
    case "OutputPath":
      return dim(`Target: ${location.targetName}`);
    case "ElmWatchNodeScriptPath":
      return location.theElmWatchNodeScriptPath.absolutePath;
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

"postprocess": ["elm-watch-node"]

You need to specify a JavaScript file to run as well, like so:

"postprocess": ["elm-watch-node", "postprocess.js"]
`;
}

export function elmWatchNodeImportError(
  scriptPath: ElmWatchNodeScriptPath,
  error: unknown
): ErrorTemplate {
  const code: unknown = (error as { code: unknown } | undefined)?.code;
  const errorString: string =
    // `import()` is used for real (since it supports both CJS and MJS).
    // In Jest tests its seems to be impossible to use `import()` so we have to
    // support `require()` too.
    code === "ERR_MODULE_NOT_FOUND" || // `import()`
    code === "MODULE_NOT_FOUND" // `require()`
      ? (error as { message: string }).message
      : unknownErrorToString(error);

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
  const keysMessage =
    "default" in imported
      ? ""
      : `
These are the keys of ${bold("imported")}:

${JSON.stringify(Object.keys(imported), null, 2)}
      `;

  return fancyError("MISSING POSTPROCESS DEFAULT EXPORT", scriptPath)`
I imported your postprocess file:

${printElmWatchNodeImportCommand(scriptPath)}

I expected ${bold("imported.default")} to be a function, but it isn't!

typeof imported.default === ${JSON.stringify(typeof imported.default)}

${keysMessage}
`;
}

export function elmWatchNodeRunError(
  scriptPath: ElmWatchNodeScriptPath,
  args: Array<string>,
  error: unknown
): ErrorTemplate {
  const errorString = unknownErrorToString(error);

  return fancyError("POSTPROCESS RUN ERROR", scriptPath)`
I tried to run your postprocess command:

${printElmWatchNodeImportCommand(scriptPath)}
${printElmWatchNodeRunCommand(args)}

But that resulted in this error:

${errorString}
`;
}

export function elmWatchNodeBadReturnValue(
  scriptPath: ElmWatchNodeScriptPath,
  args: Array<string>,
  returnValue: unknown
): ErrorTemplate {
  return fancyError("INVALID POSTPROCESS RESULT", scriptPath)`
I ran your postprocess command:

${printElmWatchNodeImportCommand(scriptPath)}
${printElmWatchNodeRunCommand(args)}

I expected ${bold("result")} to be a string, but it is:

${repr(returnValue)}
`;
}

export function elmMakeJsonParseError(
  outputPath: OutputPath,
  error: JsonError,
  jsonPath: JsonPath,
  command: Command
): ErrorTemplate {
  return fancyError("TROUBLE WITH JSON REPORT", outputPath)`
I ran the following commands:

${printCommand(command)}

I seem to have gotten some JSON back as expected,
but I ran into an error when decoding it:

${printJsonError(error)}

${printJsonPath(jsonPath)}
`;
}

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
  error: Error
): ErrorTemplate {
  return fancyError("TROUBLE READING OUTPUT", outputPath)`
I managed to compile your code. Then I tried to read the output:

${outputPath.theOutputPath.absolutePath}

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

${outputPath.theOutputPath.absolutePath}

${printWriteOutputErrorReasonForWriting(reasonForWriting)}

${error.message}
`;
}

function printWriteOutputErrorReasonForWriting(
  reasonForWriting: WriteOutputErrorReasonForWriting
): string {
  switch (reasonForWriting) {
    case "InjectWebSocketClient":
      return `
I injected code for hot reloading, and then tried to write that back to the file
but I encountered this error:
      `;

    case "Postprocess":
      return `
After running your postprocess command, I tried to write the result of that
back to the file but I encountered this error:
      `;
  }
}

export function writeProxyOutputError(
  outputPath: OutputPath,
  error: Error
): ErrorTemplate {
  return fancyError("TROUBLE WRITING DUMMY OUTPUT", outputPath)`
There are no websocket connections for this output, so I only typecheck the
code. That went well. Then I tried to write a dummy output file here:

${outputPath.theOutputPath.absolutePath}

Doing so I encountered this error:

${error.message}
`;
}

export function portConflict(port: Port): string {
  return `
In your elm-watch.json you have this:

"port": ${JSON.stringify(port.thePort)}

But something else seems to already be running on that port!

You need to either find and stop that other thing, switch to another port or
remove "port" from elm-watch.json (which will use an arbitrary available port.)
  `.trim();
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
  `.trim()
    : "";

  return `
The compiled JavaScript code running in the browser says it is for this target:

${targetName}

But I can't find that target in elm-watch.json!

These targets are available in elm-watch.json:

${join(
  enabledOutputs.map((outputPath) => outputPath.targetName),
  "\n"
)}

${extra}

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

export function webSocketUnsupportedDataType(): string {
  return `
The compiled JavaScript code running in the browser seems to have sent a message that isn't a string!

The elm-watch web socket server can only handle string messages.

The web socket code I generate is supposed to always send messages with the correct JSON format, so something is up here.
  `.trim();
}

export function webSocketDecodeError(error: JsonError): string {
  return `
The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

${printJsonError(error)}

The web socket code I generate is supposed to always send string messages, so something is up here.
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

export function printStdio(stdout: string, stderr: string): string {
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
`.trim();
}

function printJsonPath(jsonPath: JsonPath): string {
  switch (jsonPath.tag) {
    case "AbsolutePath":
      return `
I wrote the JSON to this file so you can inspect it:

${jsonPath.absolutePath}
      `.trim();

    case "WritingJsonFailed":
      return `
I tried to write the JSON to this file:

${jsonPath.attemptedPath.absolutePath}

${bold("But that failed too:")}

${jsonPath.error.message}
      `.trim();
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
  const truncated = args.map((arg, index) =>
    index === 0 ? truncate(arg) : arg
  );
  return `const result = await imported.default(${JSON.stringify(truncated)})`;
}

function truncate(string: string): string {
  const roughLimit = 20;
  const half = Math.floor(roughLimit / 2);
  return string.length <= roughLimit
    ? string
    : `${string.slice(0, half)}...${string.slice(-half)}`;
}

function printJsonError(error: JsonError): string {
  return error instanceof DecoderError ? error.format() : error.message;
}
