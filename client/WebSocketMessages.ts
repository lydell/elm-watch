import * as Codec from "tiny-decoders";

import { EditorPresetId } from "../src/Editor.ts";
import { NonEmptyArray } from "../src/NonEmptyArray.ts";
import { AbsolutePath, CompilationMode } from "../src/Types.ts";

const nonNegativeIntCodec = Codec.flatMap(Codec.number, {
  decoder: (value) =>
    Number.isInteger(value) && value >= 0
      ? { tag: "Valid", value }
      : {
          tag: "DecoderError",
          error: {
            tag: "custom",
            path: [],
            message: "Expected a non-negative integer",
            got: value,
          },
        },
  encoder: (value) => value,
});

export type OpenEditorError = Codec.Infer<typeof OpenEditorError>;
const OpenEditorError = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("InvalidFilePath"),
    message: Codec.string,
  },
  {
    tag: Codec.tag("CommandFailed"),
    message: Codec.string,
  },
]);

// The `ELM_WATCH_OPEN_EDITOR` environment variable, if set. It is used for
// opening error locations unless an editor preset has been chosen.
export type OpenEditorEnv = Codec.Infer<typeof OpenEditorEnv>;
const OpenEditorEnv = Codec.taggedUnion("tag", [
  {
    // Set to a URL template (see `Editor.ts`). The browser opens the URL.
    tag: Codec.tag("Url"),
    template: Codec.string,
  },
  {
    // Set to a command (or an invalid URL). The browser sends
    // `PressedOpenEditor` to the server, which runs the command (or shows an
    // error).
    tag: Codec.tag("Server"),
  },
]);

export type ErrorLocation = Codec.Infer<typeof ErrorLocation>;
const ErrorLocation = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("FileOnly"),
    file: AbsolutePath,
    // Relative to the directory of the shell elm-watch was started from.
    relativeFile: Codec.string,
  },
  {
    tag: Codec.tag("FileWithLineAndColumn"),
    file: AbsolutePath,
    relativeFile: Codec.string,
    line: Codec.number,
    column: Codec.number,
  },
  {
    tag: Codec.tag("Target"),
    targetName: Codec.string,
  },
]);

export type CompileError = Codec.Infer<typeof CompileError>;
const CompileError = Codec.fields({
  title: Codec.string,
  location: Codec.field(ErrorLocation, { optional: true }),
  htmlContent: Codec.string,
  htmlContentCollapsed: Codec.field(Codec.string, { optional: true }),
});

export type StatusChange = Codec.Infer<typeof StatusChange>;
const StatusChange = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("AlreadyUpToDate"),
    compilationMode: CompilationMode,
  },
  {
    tag: Codec.tag("Busy"),
    compilationMode: CompilationMode,
  },
  {
    tag: Codec.tag("CompileError"),
    compilationMode: CompilationMode,
    errors: Codec.array(CompileError),
  },
  {
    tag: Codec.tag("TargetError"),
    error: Codec.string,
  },
  {
    tag: Codec.tag("ClientError"),
    message: Codec.string,
  },
]);

const SuccessfullyCompiledFields = {
  code: Codec.string,
  elmCompiledTimestamp: Codec.number,
  compilationMode: CompilationMode,
};

const SuccessfullyCompiled = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("SuccessfullyCompiled"),
    ...SuccessfullyCompiledFields,
  },
]);

export type WebSocketToClientMessage = Codec.Infer<
  typeof WebSocketToClientMessage
>;
export const WebSocketToClientMessage = Codec.taggedUnion("tag", [
  {
    // Errors from outside elm-watch (such as from esbuild). Sent to all
    // targets, and shown regardless of the target’s status.
    tag: Codec.tag("ExternalErrors"),
    sources: Codec.array(
      Codec.fields({
        source: Codec.string,
        errors: Codec.array(CompileError),
      }),
    ),
  },
  {
    tag: Codec.tag("FocusedTabAcknowledged"),
  },
  {
    tag: Codec.tag("OpenEditorFailed"),
    error: OpenEditorError,
  },
  {
    // Sent when connecting, and to everyone when someone chooses an editor.
    tag: Codec.tag("OpenEditorSetupChanged"),
    // The editor preset chosen in the browser UI or the terminal. Takes
    // precedence over `env`.
    preset: Codec.nullOr(EditorPresetId),
    env: Codec.nullOr(OpenEditorEnv),
  },
  {
    tag: Codec.tag("StaticFilesChanged"),
    changedFileUrlPaths: NonEmptyArray(Codec.string),
  },
  {
    tag: Codec.tag("StaticFilesMayHaveChangedWhileDisconnected"),
  },
  {
    tag: Codec.tag("StatusChanged"),
    status: StatusChange,
  },
  {
    // The terminal colors (or the default theme’s, if the terminal didn’t
    // respond), for the error overlay and the browser UI panel. Sent when
    // connecting, when the tab is focused, and before errors.
    tag: Codec.tag("TerminalColors"),
    foregroundColor: Codec.string,
    backgroundColor: Codec.string,
  },
  {
    tag: Codec.tag("SuccessfullyCompiled"),
    ...SuccessfullyCompiledFields,
  },
  {
    tag: Codec.tag("SuccessfullyCompiledInOptimizeMode"),
  },
]);

export type WebSocketToServerMessage = Codec.Infer<
  typeof WebSocketToServerMessage
>;
export const WebSocketToServerMessage = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("ChangedCompilationMode"),
    compilationMode: CompilationMode,
  },
  {
    // Stored in elm-stuff/elm-watch/stuff.json. `null` forgets the choice.
    tag: Codec.tag("ChoseEditor"),
    editor: Codec.nullOr(EditorPresetId),
  },
  {
    tag: Codec.tag("FocusedTab"),
  },
  {
    tag: Codec.tag("PressedOpenEditor"),
    file: AbsolutePath,
    // Disallow negative numbers since they might be parsed as command line flags
    // in the user’s command, potentially causing something unwanted.
    line: nonNegativeIntCodec,
    column: nonNegativeIntCodec,
  },
]);

export function encodeWebSocketToClientMessage(
  message: WebSocketToClientMessage,
): string {
  switch (message.tag) {
    // Optimization: Avoid encoding megabytes of JS code as a JSON string.
    // With a large Elm app, `JSON.stringify` + `JSON.parse` can time ~40 ms.
    case "SuccessfullyCompiled": {
      const shortMessage = { ...message, code: "" };
      return `//${Codec.JSON.stringify(SuccessfullyCompiled, shortMessage)}\n${
        message.code
      }`;
    }

    default:
      return Codec.JSON.stringify(WebSocketToClientMessage, message);
  }
}

export function decodeWebSocketToClientMessage(
  data: unknown,
): Codec.DecoderResult<WebSocketToClientMessage> {
  // `SuccessfullyCompiled` is sent as a binary message (see `webSocketSend` in Hot.ts).
  const messageResult = Codec.string.decoder(
    isArrayBuffer(data) ? new TextDecoder().decode(data) : data,
  );
  if (messageResult.tag === "DecoderError") {
    return messageResult;
  }
  const message = messageResult.value;
  if (message.startsWith("//")) {
    const newlineIndexRaw = message.indexOf("\n");
    const newlineIndex =
      newlineIndexRaw === -1 ? message.length : newlineIndexRaw;
    const jsonString = message.slice(2, newlineIndex);
    const parseResult = Codec.JSON.parse(SuccessfullyCompiled, jsonString);
    switch (parseResult.tag) {
      case "DecoderError":
        return parseResult;
      case "Valid":
        return { tag: "Valid", value: { ...parseResult.value, code: message } };
    }
  } else {
    return Codec.JSON.parse(WebSocketToClientMessage, message);
  }
}

// `instanceof ArrayBuffer` does not work if the `WebSocket` comes from another realm.
function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}
