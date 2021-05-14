import * as Decode from "tiny-decoders";

import { NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath } from "./path-helpers";

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L412-L431
// Lowercase means “dull” and uppercase means “vivid”:
// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L369-L391
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

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/builder/src/Reporting/Exit/Help.hs#L94-L109
export type ElmMakeError = ReturnType<typeof ElmMakeError>;
export const ElmMakeError = Decode.fieldsUnion("type", {
  error: Decode.fieldsAuto({
    tag: () => "GeneralError" as const,
    // This can be just "elm.json" (not absolute) when elm.json contains `"type": "invalid"`.
    path: Decode.nullable(Decode.string, undefined),
    title: Decode.string,
    message: Decode.array(MessageChunk),
  }),
  "compile-errors": Decode.fieldsAuto({
    tag: () => "CompileErrors" as const,
    errors: NonEmptyArray(CompileError),
  }),
});
