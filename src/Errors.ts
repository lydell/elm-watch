import { ExecException } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as Codec from "tiny-decoders";
import * as url from "url";

import * as ElmMakeError from "./ElmMakeError";
import * as ElmWatchJson from "./ElmWatchJson";
import { ELM_WATCH_OPEN_EDITOR, Env } from "./Env";
import {
  bold as boldTerminal,
  dim as dimTerminal,
  join as joinString,
  RESET_COLOR,
  toError,
} from "./Helpers";
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
import * as Theme from "./Theme";
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

function bold(string: string): Piece {
  return { tag: "Bold", text: string };
}

function dim(string: string): Piece {
  return { tag: "Dim", text: string };
}

function text(string: string): Piece {
  return { tag: "Text", text: string.trim() };
}

function number(num: number): Piece {
  return { tag: "Text", text: num.toString() };
}

function join(array: Array<string>, separator: string): Piece {
  return text(joinString(array, separator));
}

function json(data: unknown, indent?: number): Piece {
  return {
    tag: "Text",
    text:
      indent === undefined
        ? Codec.JSON.stringify(Codec.unknown, data)
        : Codec.JSON.stringify(Codec.unknown, data, indent),
  };
}

function joinTemplate(
  array: Array<Piece | Template>,
  separator: string,
): Template {
  return template(
    ["", ...Array.from({ length: array.length - 1 }, () => separator), ""],
    ...array,
  );
}

const elmJson = bold("elm.json");
const elmWatchJson = bold("elm-watch.json");
const elmWatchStuffJson = bold("elm-stuff/elm-watch/stuff.json");

type FancyErrorLocation =
  | ElmJsonPath
  | ElmWatchJsonPath
  | ElmWatchNodeScriptPath
  | ElmWatchStuffJsonPath
  | OutputPath
  | {
      tag: "FileWithLineAndColumn";
      file: AbsolutePath;
      line: number;
      column: number;
    }
  | { tag: "NoLocation" };

type Piece =
  | {
      tag: "ElmStyle";
      text: string;
      bold: boolean;
      underline: boolean;
      color?: ElmMakeError.Color;
    }
  | { tag: "Bold"; text: string }
  | { tag: "Dim"; text: string }
  | { tag: "Text"; text: string };

type Template = (
  width: number,
  renderPiece: (piece: Piece) => string,
) => string;

export type ErrorTemplate = (
  width: number,
  renderPiece: (piece: Piece) => string,
) => ErrorTemplateData;

type ErrorTemplateData = {
  title: string;
  location: ErrorLocation | undefined;
  content: string;
};

type ErrorLocation =
  | {
      tag: "FileOnly";
      file: AbsolutePath;
    }
  | {
      tag: "FileWithLineAndColumn";
      file: AbsolutePath;
      line: number;
      column: number;
    }
  | {
      tag: "Target";
      targetName: string;
    };

export const fancyError =
  (title: string, location: FancyErrorLocation) =>
  (strings: ReadonlyArray<string>, ...values: Array<Piece | Template>) =>
  (
    width: number,
    renderPiece: (piece: Piece) => string,
  ): ErrorTemplateData => ({
    title,
    location: fancyToPlainErrorLocation(location),
    content: template(strings, ...values)(width, renderPiece),
  });

export const template =
  (strings: ReadonlyArray<string>, ...values: Array<Piece | Template>) =>
  (width: number, renderPiece: (piece: Piece) => string): string =>
    joinString(
      strings.flatMap((string, index) => {
        const value = values[index] ?? text("");
        return [
          string,
          typeof value === "function"
            ? value(width, renderPiece)
            : renderPiece(value),
        ];
      }),
      "",
    ).trim();

export function toTerminalString(
  errorTemplate: ErrorTemplate,
  width: number,
  noColor: boolean,
): string {
  const renderPiece = noColor
    ? (piece: Piece): string => piece.text
    : renderPieceForTerminal;

  const { title, location, content } = errorTemplate(width, renderPiece);
  const prefix = `-- ${title} `;
  const line = "-".repeat(Math.max(0, width - prefix.length));
  const titleWithSeparator = renderPiece(bold(`${prefix}${line}`));

  return joinString(
    [
      titleWithSeparator,
      ...(location === undefined
        ? []
        : [renderPiece(renderErrorLocation(location))]),
      "",
      content,
    ],
    "\n",
  );
}

export function toPlainString(errorTemplate: ErrorTemplate): string {
  return toTerminalString(errorTemplate, DEFAULT_COLUMNS, true);
}

export function toHtml(
  errorTemplate: ErrorTemplate,
  theme: Theme.Theme,
  noColor: boolean,
): {
  title: string;
  location: ErrorLocation | undefined;
  htmlContent: string;
} {
  const renderPiece = (piece: Piece): string =>
    noColor ? piece.text : renderPieceToHtml(piece, theme);

  const { title, location, content } = errorTemplate(
    DEFAULT_COLUMNS,
    renderPiece,
  );
  return { title, location, htmlContent: content };
}

function renderPieceForTerminal(piece: Piece): string {
  switch (piece.tag) {
    case "Bold":
      return boldTerminal(piece.text);
    case "Dim":
      return dimTerminal(piece.text);
    case "ElmStyle":
      return (
        (piece.bold ? /* v8 ignore next */ "\x1B[1m" : "") +
        (piece.underline ? "\x1B[4m" : "") +
        (piece.color === undefined
          ? ""
          : Theme.COLOR_TO_TERMINAL_ESCAPE[piece.color]) +
        piece.text +
        RESET_COLOR
      );
    case "Text":
      return piece.text;
  }
}

function renderPieceToHtml(piece: Piece, theme: Theme.Theme): string {
  switch (piece.tag) {
    case "Bold":
      return `<b>${escapeHtml(piece.text)}</b>`;
    case "Dim":
      return `<span style="opacity: 0.6">${escapeHtml(piece.text)}</span>`;
    case "ElmStyle":
      return (
        (piece.bold ? /* v8 ignore next */ "<b>" : "") +
        (piece.underline ? "<u>" : "") +
        (piece.color === undefined
          ? ""
          : `<span style="color: ${theme.palette[piece.color]}">`) +
        escapeHtml(piece.text) +
        (piece.color === undefined ? "" : "</span>") +
        (piece.underline ? "</u>" : "") +
        (piece.bold ? /* v8 ignore next */ "</b>" : "")
      );
    case "Text":
      return escapeHtml(piece.text);
  }
}

function escapeHtml(string: string): string {
  return string.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      /* v8 ignore start */
      default:
        return match;
      /* v8 ignore stop */
    }
  });
}

function fancyToPlainErrorLocation(
  location: FancyErrorLocation,
): ErrorLocation | undefined {
  switch (location.tag) {
    case "ElmJsonPath":
      return { tag: "FileOnly", file: location.theElmJsonPath };
    case "ElmWatchJsonPath":
      return { tag: "FileOnly", file: location.theElmWatchJsonPath };
    case "ElmWatchStuffJsonPath":
      return { tag: "FileOnly", file: location.theElmWatchStuffJsonPath };
    case "OutputPath":
      return { tag: "Target", targetName: location.targetName };
    case "ElmWatchNodeScriptPath":
      return {
        tag: "FileOnly",
        file: {
          tag: "AbsolutePath",
          absolutePath: url.fileURLToPath(
            location.theElmWatchNodeScriptFileUrl,
          ),
        },
      };
    case "FileWithLineAndColumn":
      return location;
    case "NoLocation":
      return undefined;
  }
}

function renderErrorLocation(location: ErrorLocation): Piece {
  switch (location.tag) {
    case "FileOnly":
      return text(location.file.absolutePath);
    case "FileWithLineAndColumn":
      return text(
        `${location.file.absolutePath}:${location.line}:${location.column}`,
      );
    case "Target":
      return dim(`Target: ${location.targetName}`);
  }
}

export function readElmWatchJson(
  elmWatchJsonPath: ElmWatchJsonPath,
  error: Error,
): ErrorTemplate {
  return fancyError("TROUBLE READING elm-watch.json", elmWatchJsonPath)`
I read inputs, outputs and options from ${elmWatchJson}.

${bold("I had trouble reading it:")}

${text(error.message)}
`;
}

export function decodeElmWatchJson(
  elmWatchJsonPath: ElmWatchJsonPath,
  error: Codec.DecoderError,
): ErrorTemplate {
  return fancyError("INVALID elm-watch.json FORMAT", elmWatchJsonPath)`
I read inputs, outputs and options from ${elmWatchJson}.

${bold("I had trouble with the JSON inside:")}

${printJsonError(error)}
`;
}

export function elmWatchJsonNotFound(
  cwd: Cwd,
  args: Array<CliArg>,
): ErrorTemplate {
  const example = ElmWatchJson.example(
    cwd,
    {
      tag: "ElmWatchJsonPath",
      theElmWatchJsonPath: absolutePathFromString(cwd.path, "elm-watch.json"),
    },
    ElmWatchJson.parseArgsLikeElmMake(args),
  );

  return fancyError("elm-watch.json NOT FOUND", { tag: "NoLocation" })`
I read inputs, outputs and options from ${elmWatchJson}.

${bold("But I couldn't find one!")}

You need to create one with JSON like this:

${text(example)}
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
  theUnknownFlags: NonEmptyArray<CliArg>,
): ErrorTemplate {
  const elmMakeParsed = ElmWatchJson.parseArgsLikeElmMake(args);

  const extra =
    elmMakeParsed.output !== undefined
      ? template`
It looks like your arguments might fit in an ${bold("elm make")} command.
If so, you could try moving them to the ${elmWatchJson} I found here:

${text(elmWatchJsonPath.theElmWatchJsonPath.absolutePath)}

For example, you could add some JSON like this:

${text(ElmWatchJson.example(cwd, elmWatchJsonPath, elmMakeParsed))}
  `
      : text("");

  return fancyError("UNEXPECTED FLAGS", { tag: "NoLocation" })`
${printRunModeArgsHelp(runMode)}

But you provided these flag-looking args:

${join(
  theUnknownFlags.map((arg) => arg.theArg),
  "\n",
)}

Try removing those extra flags!

${extra}
`;
}

function printRunModeArgsHelp(runMode: RunMode): Template {
  switch (runMode) {
    case "make":
      return template`The ${bold(
        runMode,
      )} command only accepts the flags ${bold("--debug")} and ${bold(
        "--optimize",
      )}.`;

    case "hot":
      return template`The ${bold(
        runMode,
      )} command only accepts no flags at all.`;
  }
}

export function unknownTargetsSubstrings(
  elmWatchJsonPath: ElmWatchJsonPath,
  knownTargets: NonEmptyArray<string>,
  theUnknownTargetsSubstrings: NonEmptyArray<string>,
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
  paths: NonEmptyArray<AbsolutePath>,
): ErrorTemplate {
  return fancyError("NO COMMON ROOT", { tag: "NoLocation" })`
I could not find a common ancestor for these paths:

${join(
  mapNonEmptyArray(paths, (thePath) => thePath.absolutePath),
  "\n",
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
  }>,
): ErrorTemplate {
  const extra = isNonEmptyArray(foundElmJsonPaths)
    ? template`
Note that I did find an ${elmJson} for some inputs:

${join(
  mapNonEmptyArray(
    foundElmJsonPaths,
    ({ inputPath, elmJsonPath }) =>
      `${inputPath.originalString}\n-> ${elmJsonPath.theElmJsonPath.absolutePath}`,
  ),
  "\n\n",
)}

Make sure that one single ${elmJson} covers all the inputs together!
      `
    : text("");

  return fancyError("elm.json NOT FOUND", outputPath)`
I could not find an ${elmJson} for these inputs:

${join(
  mapNonEmptyArray(inputs, (inputPath) => inputPath.originalString),
  "\n",
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
  }>,
): ErrorTemplate {
  return fancyError("NO UNIQUE elm.json", outputPath)`
I went looking for an ${elmJson} for your inputs, but I found more than one!

${join(
  mapNonEmptyArray(
    theNonUniqueElmJsonPaths,
    ({ inputPath, elmJsonPath }) =>
      `${inputPath.originalString}\n-> ${elmJsonPath.theElmJsonPath.absolutePath}`,
  ),
  "\n\n",
)}

It doesn't make sense to compile Elm files from different projects into one output.

Either split this target, or move the inputs to the same project with the same
${elmJson}.
`;
}

export function inputsNotFound(
  outputPath: OutputPath,
  inputs: NonEmptyArray<UncheckedInputPath>,
): ErrorTemplate {
  return fancyError("INPUTS NOT FOUND", outputPath)`
You asked me to compile these inputs:

${joinTemplate(
  mapNonEmptyArray(
    inputs,
    (inputPath) =>
      template`${text(inputPath.originalString)} ${dim(
        `(${inputPath.theUncheckedInputPath.absolutePath})`,
      )}`,
  ),
  "\n",
)}

${bold("But they don't exist!")}

Is something misspelled? Or do you need to create them?
`;
}

export function inputsFailedToResolve(
  outputPath: OutputPath,
  inputs: NonEmptyArray<{ inputPath: UncheckedInputPath; error: Error }>,
): ErrorTemplate {
  return fancyError("INPUTS FAILED TO RESOLVE", outputPath)`
I start by checking if the inputs you give me exist,
but doing so resulted in errors!

${join(
  mapNonEmptyArray(
    inputs,
    ({ inputPath, error }) => `${inputPath.originalString}:\n${error.message}`,
  ),
  "\n\n",
)}

${bold("That's all I know, unfortunately!")}
`;
}

export function duplicateInputs(
  outputPath: OutputPath,
  duplicates: NonEmptyArray<{
    inputs: NonEmptyArray<InputPath>;
    resolved: AbsolutePath;
  }>,
): ErrorTemplate {
  const isSymlink = (inputPath: InputPath): boolean =>
    inputPath.theInputPath.absolutePath !== inputPath.realpath.absolutePath;

  const hasSymlink = duplicates.some(({ inputs }) => inputs.some(isSymlink));

  const symlinkText = hasSymlink
    ? "Note that at least one of the inputs seems to be a symlink. They can be tricky!"
    : "";

  return fancyError("DUPLICATE INPUTS", outputPath)`
Some of your inputs seem to be duplicates!

${joinTemplate(
  mapNonEmptyArray(duplicates, ({ inputs, resolved }) =>
    joinTemplate(
      [
        ...mapNonEmptyArray(inputs, (inputPath) =>
          isSymlink(inputPath)
            ? template`${text(inputPath.originalString)} ${dim("(symlink)")}`
            : text(inputPath.originalString),
        ),
        text(`-> ${resolved.absolutePath}`),
      ],
      "\n",
    ),
  ),
  "\n\n",
)}

Make sure every input is listed just once!

${text(symlinkText)}
`;
}

export function duplicateOutputs(
  elmWatchJsonPath: ElmWatchJsonPath,
  duplicates: NonEmptyArray<{
    originalOutputPathStrings: NonEmptyArray<string>;
    absolutePath: AbsolutePath;
  }>,
): ErrorTemplate {
  return fancyError("DUPLICATE OUTPUTS", elmWatchJsonPath)`
Some of your outputs seem to be duplicates!

${joinTemplate(
  mapNonEmptyArray(duplicates, ({ originalOutputPathStrings, absolutePath }) =>
    join(
      [...originalOutputPathStrings, `-> ${absolutePath.absolutePath}`],
      "\n",
    ),
  ),
  "\n\n",
)}

Make sure every output is listed just once!
`;
}

export function elmNotFoundError(
  location: ElmJsonPath | OutputPath,
  command: Command,
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
  command: Command,
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
  command: Command,
): ErrorTemplate {
  return fancyError("TROUBLE SPAWNING COMMAND", location)`
I tried to execute ${bold(command.command)}, but I ran into an error!

${text(error.message)}

This happened when trying to run the following commands:

${printCommand(command)}
`;
}

export function unexpectedElmMakeOutput(
  outputPath: OutputPath,
  exitReason: ExitReason,
  stdout: string,
  stderr: string,
  command: Command,
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
  command: Command,
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
  command: Command,
): ErrorTemplate {
  return fancyError("POSTPROCESS STDIN TROUBLE", location)`
I tried to run your postprocess command:

${printCommand(command)}

Trying to write to its ${bold("stdin")}, I got an error!
${bold("Did you forget to read stdin, maybe?")}

Note: If you don't need stdin in some case, you can pipe it to stdout!

This is the error message I got:

${text(error.message)}
`;
}

export function postprocessNonZeroExit(
  outputPath: OutputPath,
  exitReason: ExitReason,
  stdout: string,
  stderr: string,
  command: Command,
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
  elmWatchJsonPath: ElmWatchJsonPath,
): ErrorTemplate {
  return fancyError("MISSING POSTPROCESS SCRIPT", elmWatchJsonPath)`
You have specified this in ${elmWatchJson}:

"postprocess": [${json(ELM_WATCH_NODE)}]

You need to specify a JavaScript file to run as well, like so:

"postprocess": [${json(ELM_WATCH_NODE)}, "postprocess.js"]
`;
}

export function elmWatchNodeImportError(
  scriptPath: ElmWatchNodeScriptPath,
  error: UnknownValueAsString,
  stdout: string,
  stderr: string,
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
  stderr: string,
): ErrorTemplate {
  // This is in a variable to avoid a regex in scripts/Build.ts removing the line.
  const moduleExports = text("module.exports");
  return fancyError("MISSING POSTPROCESS DEFAULT EXPORT", scriptPath)`
I imported your postprocess file:

${printElmWatchNodeImportCommand(scriptPath)}

I expected ${bold("imported.default")} to be a function, but it isn't!

typeof imported.default === ${json(typeofDefault)}

${bold("imported")} is:

${printUnknownValueAsString(imported)}

Here is a sample function to get you started:

// CJS
${moduleExports} = async function postprocess({ code, targetName, compilationMode }) {
  return code;
};

// MJS
export default async function postprocess({ code, targetName, compilationMode }) {
  return code;
};

${printElmWatchNodeStdio(stdout, stderr)}
`;
}

export function elmWatchNodeRunError(
  scriptPath: ElmWatchNodeScriptPath,
  args: ElmWatchNodePublicArgs,
  error: UnknownValueAsString,
  stdout: string,
  stderr: string,
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
  stderr: string,
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

export type ElmMakeCrashBeforeError =
  | {
      tag: "Json";
      length: number;
    }
  | {
      tag: "Text";
      text: string;
    };

function printElmMakeCrashBeforeError(
  beforeError: ElmMakeCrashBeforeError,
): Template {
  switch (beforeError.tag) {
    case "Json":
      return template`I got back ${number(
        beforeError.length,
      )} characters of JSON, but then Elm crashed with this error:`;

    case "Text":
      return beforeError.text === ""
        ? template`Elm crashed with this error:`
        : template`Elm printed this text:

${text(beforeError.text)}

Then it crashed with this error:`;
  }
}

export function elmMakeCrashError(
  outputPath: OutputPath | { tag: "NoLocation" },
  beforeError: ElmMakeCrashBeforeError,
  error: string,
  command: Command,
): ErrorTemplate {
  return fancyError("ELM CRASHED", outputPath)`
I ran the following commands:

${printCommand(command)}

${printElmMakeCrashBeforeError(beforeError)}

${text(error)}
`;
}

export function elmMakeJsonParseError(
  outputPath: OutputPath | { tag: "NoLocation" },
  error: Codec.DecoderError,
  errorFilePath: ErrorFilePath,
  command: Command,
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

export function elmMakeGeneralError(
  outputPath: OutputPath,
  elmJsonPath: ElmJsonPath,
  error: ElmMakeError.GeneralError,
  extraError: string | undefined,
): ErrorTemplate {
  return fancyError(
    error.title,
    generalErrorPath(outputPath, elmJsonPath, error.path),
  )`
${text(extraError ?? "")}

${joinTemplate(error.message.map(renderMessageChunk), "")}
`;
}

function generalErrorPath(
  outputPath: OutputPath,
  elmJsonPath: ElmJsonPath,
  errorPath: ElmMakeError.GeneralError["path"],
): ElmJsonPath | OutputPath {
  switch (errorPath.tag) {
    case "NoPath":
      return outputPath;
    case "elm.json":
      return elmJsonPath;
  }
}

export function elmMakeProblem(
  filePath: AbsolutePath,
  problem: ElmMakeError.Problem,
  extraError: string | undefined,
): ErrorTemplate {
  return fancyError(problem.title, {
    tag: "FileWithLineAndColumn",
    file: filePath,
    line: problem.region.start.line,
    column: problem.region.start.column,
  })`
${text(extraError ?? "")}

${joinTemplate(problem.message.map(renderMessageChunk), "")}
`;
}

function renderMessageChunk(chunk: ElmMakeError.MessageChunk): Piece {
  switch (chunk.tag) {
    case "UnstyledText":
      // This does not use `text()` since that function trims whitespace.
      return { tag: "Text", text: chunk.string };
    case "StyledText":
      return {
        tag: "ElmStyle",
        text: chunk.string,
        bold: chunk.bold,
        underline: chunk.underline,
        color: chunk.color,
      };
  }
}

export function stuckInProgressState(
  outputPath: OutputPath,
  state: string,
): ErrorTemplate {
  return fancyError("STUCK IN PROGRESS", outputPath)`
I thought that all outputs had finished compiling, but my inner state says
this target is still in the ${bold(state)} phase.

${bold("This is not supposed to ever happen.")}
`;
}

export function creatingDummyFailed(
  elmJsonPath: ElmJsonPath,
  error: Error,
): ErrorTemplate {
  return fancyError("FILE SYSTEM TROUBLE", elmJsonPath)`
I tried to make sure that all packages are installed. To do that, I need to
create a temporary dummy .elm file but that failed:

${text(error.message)}
`;
}

export function elmInstallError(
  elmJsonPath: ElmJsonPath,
  title: string,
  message: string,
): ErrorTemplate {
  return fancyError(title, elmJsonPath)`
${text(message)}
`;
}

export function readElmJson(
  elmJsonPath: ElmJsonPath,
  error: Error,
): ErrorTemplate {
  return fancyError("TROUBLE READING elm.json", elmJsonPath)`
I read "source-directories" from ${elmJson} when figuring out all Elm files that
your inputs depend on.

${bold("I had trouble reading it:")}

${text(error.message)}

(I still managed to compile your code, but the watcher will not work properly
and "postprocess" was not run.)
`;
}

export function decodeElmJson(
  elmJsonPath: ElmJsonPath,
  error: Codec.DecoderError,
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

export function readElmWatchStuffJson(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath,
  error: Error,
): ErrorTemplate {
  return fancyError(
    "TROUBLE READING elm-stuff/elm-watch/stuff.json",
    elmWatchStuffJsonPath,
  )`
I read stuff from ${elmWatchStuffJson} to remember some things between runs.

${bold("I had trouble reading it:")}

${text(error.message)}

This file is created by elm-watch, so reading it should never fail really.
You could try removing that file (it contains nothing essential).
`;
}

export function decodeElmWatchStuffJson(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath,
  error: Codec.DecoderError,
): ErrorTemplate {
  return fancyError(
    "INVALID elm-stuff/elm-watch/stuff.json FORMAT",
    elmWatchStuffJsonPath,
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
  error: Error,
): ErrorTemplate {
  return fancyError(
    "TROUBLE WRITING elm-stuff/elm-watch/stuff.json",
    elmWatchStuffJsonPath,
  )`
I write stuff to ${elmWatchStuffJson} to remember some things between runs.

${bold("I had trouble writing that file:")}

${text(error.message)}

The file contains nothing essential, but something weird is going on.
`;
}

export function importWalkerFileSystemError(
  outputPath: OutputPath,
  error: Error,
): ErrorTemplate {
  return fancyError("TROUBLE READING ELM FILES", outputPath)`
When figuring out all Elm files that your inputs depend on I read a lot of Elm files.
Doing so I encountered this error:

${text(error.message)}

(I still managed to compile your code, but the watcher will not work properly
and "postprocess" was not run.)
`;
}

export function needsToWriteProxyFileReadError(
  outputPath: OutputPath,
  error: Error,
  triedPath: AbsolutePath,
): ErrorTemplate {
  return fancyError("TROUBLE CHECKING OUTPUT", outputPath)`
I managed to typecheck your code. Then I tried to read part of the previous output,
to see if I need to write a dummy output file there:

${text(triedPath.absolutePath)}

Doing so I encountered this error:

${text(error.message)}
`;
}

export function readOutputError(
  outputPath: OutputPath,
  error: Error,
  triedPath: AbsolutePath,
): ErrorTemplate {
  return fancyError("TROUBLE READING OUTPUT", outputPath)`
I managed to compile your code. Then I tried to read the output:

${text(triedPath.absolutePath)}

Doing so I encountered this error:

${text(error.message)}
`;
}

export function writeOutputError(
  outputPath: OutputPath,
  error: Error,
  reasonForWriting: WriteOutputErrorReasonForWriting,
): ErrorTemplate {
  return fancyError("TROUBLE WRITING OUTPUT", outputPath)`
I managed to compile your code and read the generated file:

${text(outputPath.temporaryOutputPath.absolutePath)}

${printWriteOutputErrorReasonForWriting(reasonForWriting)}

${text(outputPath.theOutputPath.absolutePath)}

But I encountered this error:

${text(error.message)}
`;
}

function printWriteOutputErrorReasonForWriting(
  reasonForWriting: WriteOutputErrorReasonForWriting,
): Piece {
  switch (reasonForWriting) {
    case "InjectWebSocketClient":
      return text(
        "I injected code for hot reloading, and then tried to write that to the output path:",
      );

    case "Postprocess":
      return text(
        "After running your postprocess command, I tried to write the result of that to the output path:",
      );
  }
}

export function writeProxyOutputError(
  outputPath: OutputPath,
  error: Error,
): ErrorTemplate {
  return fancyError("TROUBLE WRITING DUMMY OUTPUT", outputPath)`
There are no WebSocket connections for this target, so I only typecheck the
code. That went well. Then I tried to write a dummy output file here:

${text(outputPath.theOutputPath.absolutePath)}

Doing so I encountered this error:

${text(error.message)}
`;
}

export function portConflictForNoPort(error: Error): ErrorTemplate {
  return fancyError("PORT CONFLICT", { tag: "NoLocation" })`
I ask the operating system for an arbitrary available port for the
web socket server.

The operating system is supposed to always be able to find an available port,
but it looks like that wasn't the case this time!

This is the error message I got:

${text(error.message)}
  `;
}

export function portConflictForPersistedPort(
  elmWatchStuffJsonPath: ElmWatchStuffJsonPath,
  port: Port,
): ErrorTemplate {
  return fancyError("PORT CONFLICT", elmWatchStuffJsonPath)`
I ask the operating system for an arbitrary available port for the
web socket server.

I then save the port I got to ${elmWatchStuffJson}. Otherwise I would
get a new port number on each restart, which means that if you had tabs
open in the browser they would try to connect to the old port number.

I tried to use such a saved port number from a previous run (or from previous
configuration). But now that port (${number(port.thePort)}) wasn't available!

Most likely you already have elm-watch running somewhere else! If so,
find it and use that, or kill it.

If not, something else could have started using port ${number(port.thePort)}
(though it's not very likely.) Then you can either try to find what that is,
or remove ${elmWatchStuffJson} here:

${text(elmWatchStuffJsonPath.theElmWatchStuffJsonPath.absolutePath)}

Then I will ask the operating system for a new arbitrary available port.
  `;
}

export function portConflictForPortFromConfig(
  elmWatchJsonPath: ElmWatchJsonPath,
  port: Port,
): ErrorTemplate {
  return fancyError("PORT CONFLICT", elmWatchJsonPath)`
In your ${elmWatchJson} you have this:

"port": ${json(port.thePort)}

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

${text(error.message)}
  `;
}

export function webSocketBadUrl(
  expectedStart: string,
  actualUrlString: string,
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
  error: Codec.DecoderError,
  actualUrlString: string,
): string {
  return `
I ran into trouble parsing the web socket connection URL parameters:

${printJsonError(error).text}

The URL looks like this:

${actualUrlString}

The web socket code I generate is supposed to always connect using a correct URL, so something is up here. Maybe the JavaScript code running in the browser was compiled with an older version of elm-watch? If so, try reloading the page.
  `;
}

export function webSocketWrongVersion(
  expectedVersion: string,
  actualVersion: string,
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
  disabledOutputs: Array<OutputPath>,
): string {
  const extra = isNonEmptyArray(disabledOutputs)
    ? `

These targets are also available in elm-watch.json, but are not enabled (because of the CLI arguments passed):

${joinString(
  mapNonEmptyArray(disabledOutputs, (outputPath) => outputPath.targetName),
  "\n",
)}
  `.trimEnd()
    : "";

  return `
The compiled JavaScript code running in the browser says it is for this target:

${targetName}

But I can't find that target in elm-watch.json!

These targets are available in elm-watch.json:

${joinString(
  enabledOutputs.map((outputPath) => outputPath.targetName),
  "\n",
)}${extra}

Maybe this target used to exist in elm-watch.json, but you removed or changed it?
If so, try reloading the page.
  `.trim();
}

export function webSocketTargetDisabled(
  targetName: string,
  enabledOutputs: Array<OutputPath>,
  disabledOutputs: Array<OutputPath>,
): string {
  return `
The compiled JavaScript code running in the browser says it is for this target:

${targetName}

That target does exist in elm-watch.json, but isn't enabled.

These targets are enabled via CLI arguments:

${joinString(
  enabledOutputs.map((outputPath) => outputPath.targetName),
  "\n",
)}

These targets exist in elm-watch.json but aren't enabled:

${joinString(
  disabledOutputs.map((outputPath) => outputPath.targetName),
  "\n",
)}

If you want to have this target compiled, restart elm-watch either with more CLI arguments or no CLI arguments at all!
  `.trim();
}

export function webSocketDecodeError(error: Codec.DecoderError): string {
  return `
The compiled JavaScript code running in the browser seems to have sent a message that the web socket server cannot recognize!

${printJsonError(error).text}

The web socket code I generate is supposed to always send correct messages, so something is up here.
  `.trim();
}

export function openEditorCommandFailed({
  error,
  command,
  cwd,
  timeout,
  env,
  stdout,
  stderr,
}: {
  error: ExecException;
  command: string;
  cwd: AbsolutePath;
  timeout: number;
  env: Env;
  stdout: string;
  stderr: string;
}): string {
  /* v8 ignore start */
  const errorReason =
    error.killed === true
      ? `The command took too long to run, and was killed after ${timeout} ms.`
      : error.code !== undefined
        ? `The command exited with code ${error.code}.`
        : // istanbul ignore next
          "The command failed for an unknown reason.";
  return `
I ran your command for opening an editor (set via the ${ELM_WATCH_OPEN_EDITOR} environment variable):

${commandToPresentationName(["cd", cwd.absolutePath])}
${command}

I ran the command with these extra environment variables:

${Codec.JSON.stringify(Codec.unknown, env, 2)}

${errorReason}

${printStdio(stdout, stderr)(DEFAULT_COLUMNS, (piece) => piece.text)}
  `.trim();
}

export function printPATH(env: Env, isWindows: boolean): Template {
  if (isWindows) {
    return printPATHWindows(env);
  }

  const { PATH } = env;

  if (PATH === undefined) {
    return template`I can't find any program, because process.env.PATH is undefined!`;
  }

  const pathList = PATH.split(path.delimiter);

  return template`
This is what the PATH environment variable looks like:

${join(pathList, "\n")}
  `;
}

function printPATHWindows(env: Env): Template {
  const pathEntries = Object.entries(env).flatMap(([key, value]) =>
    key.toUpperCase() === "PATH" && value !== undefined
      ? [[key, value] as const]
      : [],
  );

  if (!isNonEmptyArray(pathEntries)) {
    return template`I can't find any program, because I can't find any PATH-like environment variables!`;
  }

  if (pathEntries.length === 1) {
    const [key, value] = pathEntries[0];
    return template`
This is what the ${text(key)} environment variable looks like:

${join(value.split(path.delimiter), "\n")}
    `;
  }

  const pathEntriesString = join(
    pathEntries.map(([key, value]) =>
      joinString([`${key}:`, ...value.split(path.delimiter)], "\n"),
    ),
    "\n\n",
  );

  return template`
You seem to have several PATH-like environment variables set. The last one
should be the one that is actually used, but it's better to have a single one!

${pathEntriesString}
  `;
}

function printCommand(command: Command): Piece {
  const stdin =
    command.stdin === undefined
      ? ""
      : `${commandToPresentationName([
          "printf",
          truncate(command.stdin.toString("utf8")),
        ])} | `;
  return text(`
${commandToPresentationName(["cd", command.options.cwd.absolutePath])}
${stdin}${commandToPresentationName([command.command, ...command.args])}
`);
}

function commandToPresentationName(command: NonEmptyArray<string>): string {
  return joinString(
    command.map((part) =>
      part === ""
        ? "''"
        : joinString(
            part
              .split(/(')/)
              .map((subPart) =>
                subPart === ""
                  ? ""
                  : subPart === "'"
                    ? "\\'"
                    : /^[\w.,:/=@%+-]+$/.test(subPart)
                      ? subPart
                      : `'${subPart}'`,
              ),
            "",
          ),
    ),
    " ",
  );
}

function printExitReason(exitReason: ExitReason): Piece {
  switch (exitReason.tag) {
    case "ExitCode":
      return text(`exit ${exitReason.exitCode}`);
    case "Signal":
      return text(`signal ${exitReason.signal}`);
    case "Unknown":
      return text("unknown exit reason");
  }
}

export function printStdio(stdout: string, stderr: string): Template {
  return stdout !== "" && stderr === ""
    ? limitStdio(stdout)
    : stdout === "" && stderr !== ""
      ? limitStdio(stderr)
      : stdout === "" && stderr === ""
        ? template`${dim("(no output)")}`
        : template`
STDOUT:
${limitStdio(stdout)}

STDERR:
${limitStdio(stderr)}
`;
}

function printElmWatchNodeStdio(stdout: string, stderr: string): Template {
  return stdout === "" && stderr === ""
    ? template``
    : template`
STDOUT:
${limitStdio(stdout)}

STDERR:
${limitStdio(stderr)}
`;
}

// Limit `string` to take at most 100 lines of terminal (roughly).
// It doesn’t need to be precise. As long as we don’t print megabytes of
// JavaScript that completely destroys the error message we’re good.
const limitStdio =
  (string: string) =>
  (width: number, renderPiece: (piece: Piece) => string) => {
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
          `${line.slice(0, take)} ${renderPiece(
            dim(left === 1 ? "1 more character" : `${left} more characters`),
          )}`,
        );
        usedLines += available;
        break;
      } else {
        result.push(line);
        usedLines += count;
      }
    }

    const joined = joinString(result, "\n");
    const left = lines.length - result.length;

    return left > 0
      ? `${joined}\n${renderPiece(
          dim(left === 1 ? "1 more line" : `${left} more lines`),
        )}`
      : joined;
  };

function printErrorFilePath(errorFilePath: ErrorFilePath): Template {
  switch (errorFilePath.tag) {
    case "AbsolutePath":
      return template`
I wrote that to this file so you can inspect it:

${text(errorFilePath.absolutePath)}
      `;

    case "WritingErrorFileFailed":
      return template`
I tried to write that to this file:

${text(errorFilePath.attemptedPath.absolutePath)}

${bold("But that failed too:")}

${text(errorFilePath.error.message)}
      `;

    case "ErrorFileBadContent":
      return template`
I wrote this error to a file so you can inspect and possibly report it more easily.

This is the data that caused the error:

${text(errorFilePath.content)}
      `;
  }
}

function printUnknownValueAsString(value: UnknownValueAsString): Piece {
  switch (value.tag) {
    case "UnknownValueAsString":
      return text(value.value);
  }
}

function printElmWatchNodeImportCommand(
  scriptPath: ElmWatchNodeScriptPath,
): Template {
  return template`const imported = await import(${json(
    scriptPath.theElmWatchNodeScriptFileUrl,
  )})`;
}

function printElmWatchNodeRunCommand(args: ElmWatchNodePublicArgs): Template {
  const truncated = {
    ...args,
    code: truncate(args.code),
  };
  return template`const result = await imported.default(${json(truncated, 2)})`;
}

function truncate(string: string): string {
  const roughLimit = 20;
  const half = Math.floor(roughLimit / 2);
  /* v8 ignore start */
  return string.length <= roughLimit
    ? string
    : `${string.slice(0, half)}...${string.slice(-half)}`;
  /* v8 ignore stop */
}

function printJsonError(error: Codec.DecoderError): Piece {
  return text(Codec.format(error));
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
    `elm-watch-${name}-${sha256(hash)}.txt`,
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
