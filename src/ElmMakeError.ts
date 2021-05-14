import * as Decode from "tiny-decoders";

export type ElmMakeError = ReturnType<typeof ElmMakeError>;
export const ElmMakeError = Decode.fieldsUnion("type", {
  error: Decode.fieldsAuto({
    tag: () => "GeneralError" as const,
  }),
  "compile-errors": Decode.fieldsAuto({
    tag: () => "CompileErrors" as const,
    errors: Decode.array((x) => x),
  }),
});
