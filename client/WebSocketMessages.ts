import * as Decode from "tiny-decoders";

import { BrowserUiPosition, CompilationMode } from "../src/Types";

const FocusedTabAcknowledged = Decode.fieldsAuto({
  tag: () => "FocusedTabAcknowledged" as const,
});

export type CompileError = ReturnType<typeof CompileError>;
const CompileError = Decode.fieldsAuto({
  title: Decode.string,
  location: Decode.optional(Decode.string),
  content: Decode.string,
});

export type StatusChanged = ReturnType<typeof StatusChanged>;
const StatusChanged = Decode.fieldsAuto({
  tag: () => "StatusChanged" as const,
  status: Decode.fieldsUnion("tag", {
    AlreadyUpToDate: Decode.fieldsAuto({
      tag: () => "AlreadyUpToDate" as const,
      compilationMode: CompilationMode,
      browserUiPosition: BrowserUiPosition,
    }),
    Busy: Decode.fieldsAuto({
      tag: () => "Busy" as const,
      compilationMode: CompilationMode,
      browserUiPosition: BrowserUiPosition,
    }),
    CompileError: Decode.fieldsAuto({
      tag: () => "CompileError" as const,
      compilationMode: CompilationMode,
      browserUiPosition: BrowserUiPosition,
      errors: Decode.array(CompileError),
      foregroundColor: Decode.string,
      backgroundColor: Decode.string,
    }),
    ClientError: Decode.fieldsAuto({
      tag: () => "ClientError" as const,
      message: Decode.string,
    }),
  }),
});

const SuccessfullyCompiled = Decode.fieldsAuto({
  tag: () => "SuccessfullyCompiled" as const,
  code: Decode.string,
  elmCompiledTimestamp: Decode.number,
  compilationMode: CompilationMode,
  browserUiPosition: BrowserUiPosition,
});

const SuccessfullyCompiledButRecordFieldsChanged = Decode.fieldsAuto({
  tag: () => "SuccessfullyCompiledButRecordFieldsChanged" as const,
});

export type WebSocketToClientMessage = ReturnType<
  typeof WebSocketToClientMessage
>;
export const WebSocketToClientMessage = Decode.fieldsUnion("tag", {
  FocusedTabAcknowledged,
  StatusChanged,
  SuccessfullyCompiled,
  SuccessfullyCompiledButRecordFieldsChanged,
});

export type WebSocketToServerMessage = ReturnType<
  typeof WebSocketToServerMessage
>;
export const WebSocketToServerMessage = Decode.fieldsUnion("tag", {
  ChangedCompilationMode: Decode.fieldsAuto({
    tag: () => "ChangedCompilationMode" as const,
    compilationMode: CompilationMode,
  }),
  ChangedBrowserUiPosition: Decode.fieldsAuto({
    tag: () => "ChangedBrowserUiPosition" as const,
    browserUiPosition: BrowserUiPosition,
  }),
  FocusedTab: Decode.fieldsAuto({
    tag: () => "FocusedTab" as const,
  }),
});

export function encodeWebSocketToClientMessage(
  message: WebSocketToClientMessage
): string {
  switch (message.tag) {
    // Optimization: Avoid encoding megabytes of JS code as a JSON string.
    // With a large Elm app, `JSON.stringify` + `JSON.parse` can time ~40 ms.
    case "SuccessfullyCompiled": {
      const shortMessage = { ...message, code: "" };
      return `//${JSON.stringify(shortMessage)}\n${message.code}`;
    }

    default:
      return JSON.stringify(message);
  }
}

export function decodeWebSocketToClientMessage(
  message: string
): WebSocketToClientMessage {
  if (message.startsWith("//")) {
    const newlineIndexRaw = message.indexOf("\n");
    const newlineIndex =
      newlineIndexRaw === -1 ? message.length : newlineIndexRaw;
    const jsonString = message.slice(2, newlineIndex);
    const parsed = SuccessfullyCompiled(JSON.parse(jsonString));
    return { ...parsed, code: message };
  } else {
    return WebSocketToClientMessage(JSON.parse(message));
  }
}
