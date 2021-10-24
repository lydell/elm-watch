import * as Decode from "tiny-decoders";

export type WebSocketToClientMessage = ReturnType<
  typeof WebSocketToClientMessage
>;
export const WebSocketToClientMessage = Decode.fieldsUnion("tag", {
  StatusChanged: Decode.fieldsAuto({
    tag: () => "StatusChanged" as const,
    status: Decode.fieldsUnion("tag", {
      AlreadyUpToDate: Decode.fieldsAuto({
        tag: () => "AlreadyUpToDate" as const,
      }),
      Busy: Decode.fieldsAuto({
        tag: () => "Busy" as const,
      }),
      CompileError: Decode.fieldsAuto({
        tag: () => "CompileError" as const,
      }),
      ClientError: Decode.fieldsAuto({
        tag: () => "ClientError" as const,
        message: Decode.string,
      }),
    }),
  }),
  SuccessfullyCompiled: Decode.fieldsAuto({
    tag: () => "SuccessfullyCompiled" as const,
    code: Decode.string,
  }),
});

export type WebSocketToServerMessage = ReturnType<
  typeof WebSocketToServerMessage
>;
export const WebSocketToServerMessage = Decode.fieldsUnion("tag", {
  ChangeCompilationMode: Decode.fieldsAuto({
    tag: () => "ChangeCompilationMode" as const,
    compilationMode: Decode.stringUnion({
      debug: null,
      standard: null,
      optimize: null,
    }),
  }),
});
