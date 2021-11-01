import * as Decode from "tiny-decoders";

import { ErrorTemplate, fancyError } from "./Errors";
import { join, RESET_COLOR } from "./Helpers";
import { NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath, ElmJsonPath, OutputPath } from "./Types";

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L412-L431
// Lowercase means “dull” and uppercase means “vivid”:
// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L369-L391
type Color = ReturnType<typeof Color>;
const Color = Decode.stringUnion({
  red: null,
  RED: null,
  magenta: null,
  MAGENTA: null,
  yellow: null,
  YELLOW: null,
  green: null,
  GREEN: null,
  cyan: null,
  CYAN: null,
  blue: null,
  BLUE: null,
  black: null,
  BLACK: null,
  white: null,
  WHITE: null,
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L394-L409
type MessageChunk = ReturnType<typeof MessageChunk>;
const MessageChunk = Decode.multi({
  string: (string) => ({
    tag: "UnstyledText" as const,
    string,
  }),
  object: Decode.chain(
    Decode.fieldsAuto({
      bold: Decode.boolean,
      underline: Decode.boolean,
      color: Decode.nullable(Color, undefined),
      string: Decode.string,
    }),
    (style) => ({
      tag: "StyledText" as const,
      style,
    })
  ),
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L201-L204
const Position = Decode.fieldsAuto({
  line: Decode.number,
  column: Decode.number,
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L197-L210
const Region = Decode.fieldsAuto({
  start: Position,
  end: Position,
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L188-L194
type Problem = ReturnType<typeof Problem>;
const Problem = Decode.fieldsAuto({
  title: Decode.string,
  region: Region,
  message: Decode.array(MessageChunk),
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L175-L185
const CompileError = Decode.fieldsAuto({
  // https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L42
  path: Decode.chain(
    Decode.string,
    (string): AbsolutePath => ({
      tag: "AbsolutePath",
      absolutePath: string,
    })
  ),
  name: Decode.string,
  problems: NonEmptyArray(Problem),
});

type GeneralError = ReturnType<typeof GeneralError>;
const GeneralError = Decode.fieldsAuto({
  tag: () => "GeneralError" as const,
  // `Nothing` and `Just "elm.json"` are the only values I’ve found in the compiler code base.
  path: Decode.nullable(
    Decode.chain(
      Decode.stringUnion({
        "elm.json": null,
      }),
      (tag) => ({ tag })
    ),
    { tag: "NoPath" as const }
  ),
  title: Decode.string,
  message: Decode.array(MessageChunk),
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/builder/src/Reporting/Exit/Help.hs#L94-L109
export type ElmMakeError = ReturnType<typeof ElmMakeError>;
export const ElmMakeError = Decode.fieldsUnion("type", {
  error: GeneralError,
  "compile-errors": Decode.fieldsAuto({
    tag: () => "CompileErrors" as const,
    errors: NonEmptyArray(CompileError),
  }),
});

export function renderGeneralError(
  outputPath: OutputPath,
  elmJsonPath: ElmJsonPath,
  error: GeneralError
): ErrorTemplate {
  return fancyError(
    error.title,
    generalErrorPath(outputPath, elmJsonPath, error.path)
  )`
${join(error.message.map(renderMessageChunk), "")}
  `;
}

function generalErrorPath(
  outputPath: OutputPath,
  elmJsonPath: ElmJsonPath,
  path: GeneralError["path"]
): ElmJsonPath | OutputPath {
  switch (path.tag) {
    case "NoPath":
      return outputPath;
    case "elm.json":
      return elmJsonPath;
  }
}

export function renderProblem(
  filePath: AbsolutePath,
  problem: Problem
): ErrorTemplate {
  const location = join(
    [
      filePath.absolutePath,
      problem.region.start.line.toString(),
      problem.region.start.column.toString(),
    ],
    ":"
  );
  return fancyError(problem.title, { tag: "Custom", location })`
${join(problem.message.map(renderMessageChunk), "")}
`;
}

function renderMessageChunk(chunk: MessageChunk): string {
  switch (chunk.tag) {
    case "UnstyledText":
      return chunk.string;

    case "StyledText": {
      const { style } = chunk;
      return (
        (style.bold ? /* istanbul ignore next */ "\x1B[1m" : "") +
        (style.underline ? "\x1B[4m" : "") +
        (style.color === undefined ? "" : renderColor(style.color)) +
        style.string +
        RESET_COLOR
      );
    }
  }
}

//https://github.com/chalk/ansi-styles/blob/cd0b0cb59337bfd7d3669b2d0fcde7ff661a83a6/index.js#L25-L42
function renderColor(color: Color): string {
  // istanbul ignore next
  switch (color) {
    case "red":
      return "\x1B[31m";
    case "RED":
      return "\x1B[91m";
    case "magenta":
      return "\x1B[35m";
    case "MAGENTA":
      return "\x1B[95m";
    case "yellow":
      return "\x1B[33m";
    case "YELLOW":
      return "\x1B[93m";
    case "green":
      return "\x1B[32m";
    case "GREEN":
      return "\x1B[92m";
    case "cyan":
      return "\x1B[36m";
    case "CYAN":
      return "\x1B[96m";
    case "blue":
      return "\x1B[34m";
    case "BLUE":
      return "\x1B[94m";
    case "black":
      return "\x1B[30m";
    case "BLACK":
      return "\x1B[90m";
    case "white":
      return "\x1B[37m";
    case "WHITE":
      return "\x1B[97m";
  }
}
