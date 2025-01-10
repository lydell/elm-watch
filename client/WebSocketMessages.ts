import * as Codec from "tiny-decoders";

import { NonEmptyArray } from "../src/NonEmptyArray";
import { AbsolutePath, BrowserUiPosition, CompilationMode } from "../src/Types";

export type OpenEditorError = Codec.Infer<typeof OpenEditorError>;
const OpenEditorError = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("EnvNotSet"),
  },
  {
    tag: Codec.tag("CommandFailed"),
    message: Codec.string,
  },
]);

export type ErrorLocation = Codec.Infer<typeof ErrorLocation>;
const ErrorLocation = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("FileOnly"),
    file: AbsolutePath,
  },
  {
    tag: Codec.tag("FileWithLineAndColumn"),
    file: AbsolutePath,
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
});

export type StatusChange = Codec.Infer<typeof StatusChange>;
const StatusChange = Codec.taggedUnion("tag", [
  {
    tag: Codec.tag("AlreadyUpToDate"),
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
  },
  {
    tag: Codec.tag("Busy"),
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
  },
  {
    tag: Codec.tag("CompileError"),
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
    openErrorOverlay: Codec.boolean,
    errors: Codec.array(CompileError),
    foregroundColor: Codec.string,
    backgroundColor: Codec.string,
  },
  {
    tag: Codec.tag("ElmJsonError"),
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
  browserUiPosition: BrowserUiPosition,
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
    tag: Codec.tag("FocusedTabAcknowledged"),
  },
  {
    tag: Codec.tag("OpenEditorFailed"),
    error: OpenEditorError,
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
    tag: Codec.tag("SuccessfullyCompiled"),
    ...SuccessfullyCompiledFields,
  },
  {
    tag: Codec.tag("SuccessfullyCompiledButRecordFieldsChanged"),
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
    tag: Codec.tag("ChangedBrowserUiPosition"),
    browserUiPosition: BrowserUiPosition,
  },
  {
    tag: Codec.tag("ChangedOpenErrorOverlay"),
    openErrorOverlay: Codec.boolean,
  },
  {
    tag: Codec.tag("FocusedTab"),
  },
  {
    tag: Codec.tag("PressedOpenEditor"),
    file: AbsolutePath,
    line: Codec.number,
    column: Codec.number,
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
  const messageResult = Codec.string.decoder(data);
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
