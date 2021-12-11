import * as Decode from "tiny-decoders";

import { CompilationMode } from "../src/Types";

export type StatusChanged = ReturnType<typeof StatusChanged>;
const StatusChanged = Decode.fieldsAuto({
  tag: () => "StatusChanged" as const,
  status: Decode.fieldsUnion("tag", {
    AlreadyUpToDate: Decode.fieldsAuto({
      tag: () => "AlreadyUpToDate" as const,
    }),
    Busy: Decode.fieldsAuto({
      tag: () => "Busy" as const,
      compilationMode: CompilationMode,
    }),
    CompileError: Decode.fieldsAuto({
      tag: () => "CompileError" as const,
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
});

export type WebSocketToClientMessage = ReturnType<
  typeof WebSocketToClientMessage
>;
export const WebSocketToClientMessage = Decode.fieldsUnion("tag", {
  StatusChanged,
  SuccessfullyCompiled,
});

export type WebSocketToServerMessage = ReturnType<
  typeof WebSocketToServerMessage
>;
export const WebSocketToServerMessage = Decode.fieldsUnion("tag", {
  ChangedCompilationMode: Decode.fieldsAuto({
    tag: () => "ChangedCompilationMode" as const,
    compilationMode: CompilationMode,
  }),
  FocusedTab: Decode.fieldsAuto({
    tag: () => "FocusedTab" as const,
  }),
  ReachedIdleState: Decode.fieldsAuto({
    tag: () => "ReachedIdleState" as const,
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
      return `#${JSON.stringify(shortMessage)}\n${message.code}`;
    }

    default:
      return JSON.stringify(message);
  }
}

export function decodeWebSocketToClientMessage(
  message: string
): WebSocketToClientMessage {
  if (message.startsWith("#")) {
    const newlineIndexRaw = message.indexOf("\n");
    const newlineIndex =
      newlineIndexRaw === -1 ? message.length : newlineIndexRaw;
    const jsonString = message.slice(1, newlineIndex);
    const code = message.slice(newlineIndex + 1);
    const parsed = SuccessfullyCompiled(JSON.parse(jsonString));
    return { ...parsed, code };
  } else {
    return WebSocketToClientMessage(JSON.parse(message));
  }
}
