import * as Codec from "tiny-decoders";

import { NonEmptyArray } from "./NonEmptyArray";
import { AbsolutePath } from "./Types";

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L412-L431
// Lowercase means “dull” and uppercase means “vivid”:
// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L369-L391
export type Color = Codec.Infer<typeof Color>;
const Color = Codec.primitiveUnion([
  "red",
  "RED",
  "magenta",
  "MAGENTA",
  "yellow",
  "YELLOW",
  "green",
  "GREEN",
  "cyan",
  "CYAN",
  "blue",
  "BLUE",
  "black",
  "BLACK",
  "white",
  "WHITE",
]);

type StyledText = Codec.Infer<typeof StyledText>;
const StyledText = Codec.map(
  Codec.fields({
    bold: Codec.boolean,
    underline: Codec.boolean,
    color: Codec.map(Codec.nullOr(Color), {
      decoder: (value) => value ?? undefined,
      encoder: (value) => value ?? null,
    }),
    string: Codec.string,
  }),
  {
    decoder: (value) => ({ tag: "StyledText" as const, ...value }),
    encoder: ({ tag: _tag, ...value }) => value,
  },
);

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Doc.hs#L394-L409
export type MessageChunk = Codec.Infer<typeof MessageChunk>;
const MessageChunk = Codec.flatMap(Codec.multi(["string", "object"]), {
  decoder: (
    value,
  ): Codec.DecoderResult<
    StyledText | { tag: "UnstyledText"; string: string }
  > => {
    switch (value.type) {
      case "string":
        return {
          tag: "Valid",
          value: {
            tag: "UnstyledText" as const,
            string: value.value,
          },
        };
      case "object":
        return StyledText.decoder(value.value);
    }
  },
  encoder: (value) => {
    switch (value.tag) {
      case "UnstyledText":
        return {
          type: "string" as const,
          value: value.string,
        };

      case "StyledText":
        return {
          type: "object" as const,
          value: StyledText.encoder(value),
        };
    }
  },
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L201-L204
const Position = Codec.fields({
  line: Codec.number,
  column: Codec.number,
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L197-L210
const Region = Codec.fields({
  start: Position,
  end: Position,
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L188-L194
export type Problem = Codec.Infer<typeof Problem>;
const Problem = Codec.fields({
  title: Codec.string,
  region: Region,
  message: Codec.array(MessageChunk),
});

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L175-L185
const CompileError = Codec.fields({
  // https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/compiler/src/Reporting/Error.hs#L42
  path: AbsolutePath,
  name: Codec.string,
  problems: NonEmptyArray(Problem),
});

const GeneralErrorPath = Codec.map(
  Codec.nullOr(
    Codec.map(Codec.primitiveUnion(["elm.json"]), {
      decoder: (tag) => ({ tag }),
      encoder: ({ tag }) => tag,
    }),
  ),
  {
    decoder: (value) => value ?? { tag: "NoPath" as const },
    encoder: (value) => (value.tag === "NoPath" ? null : value),
  },
);

export type GeneralError = Extract<ElmMakeError, { tag: "GeneralError" }>;

// https://github.com/elm/compiler/blob/94715a520f499591ac6901c8c822bc87cd1af24f/builder/src/Reporting/Exit/Help.hs#L94-L109
export type ElmMakeError = Codec.Infer<typeof ElmMakeError>;
export const ElmMakeError = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("GeneralError", {
      renameTagFrom: "error",
      renameFieldFrom: "type",
    }),
    // `Nothing` and `Just "elm.json"` are the only values I’ve found in the compiler code base.
    path: GeneralErrorPath,
    title: Codec.string,
    message: Codec.array(MessageChunk),
  },
  {
    tag: Codec.tag("CompileErrors", {
      renameTagFrom: "compile-errors",
      renameFieldFrom: "type",
    }),
    errors: NonEmptyArray(CompileError),
  },
]);
