import * as Decode from "tiny-decoders";

import { NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath } from "./Types";

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L412-L431
// Lowercase means “dull” and uppercase means “vivid”:
// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L369-L391
export type Color = ReturnType<typeof Color>;
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
export type MessageChunk = ReturnType<typeof MessageChunk>;
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
      ...style,
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
export type Problem = ReturnType<typeof Problem>;
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

export type GeneralError = ReturnType<typeof GeneralError>;
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
