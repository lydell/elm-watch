import * as Codec from "../src/Codec";
import { AbsolutePath, BrowserUiPosition, CompilationMode } from "../src/Types";

export type OpenEditorError = Codec.Infer<typeof OpenEditorError>;
const OpenEditorError = Codec.fieldsUnion("tag", (tag) => [
  {
    tag: tag("EnvNotSet"),
  },
  {
    tag: tag("CommandFailed"),
    message: Codec.string,
  },
]);

export type ErrorLocation = Codec.Infer<typeof ErrorLocation>;
const ErrorLocation = Codec.fieldsUnion("tag", (tag) => [
  {
    tag: tag("FileOnly"),
    file: AbsolutePath,
  },
  {
    tag: tag("FileWithLineAndColumn"),
    file: AbsolutePath,
    line: Codec.number,
    column: Codec.number,
  },
  {
    tag: tag("Target"),
    targetName: Codec.string,
  },
]);

export type CompileError = Codec.Infer<typeof CompileError>;
const CompileError = Codec.fields({
  title: Codec.string,
  location: Codec.optional(ErrorLocation),
  htmlContent: Codec.string,
});

export type StatusChange = Codec.Infer<typeof StatusChange>;
const StatusChange = Codec.fieldsUnion("tag", (tag) => [
  {
    tag: tag("AlreadyUpToDate"),
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
  },
  {
    tag: tag("Busy"),
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
  },
  {
    tag: tag("CompileError"),
    compilationMode: CompilationMode,
    browserUiPosition: BrowserUiPosition,
    openErrorOverlay: Codec.boolean,
    errors: Codec.array(CompileError),
    foregroundColor: Codec.string,
    backgroundColor: Codec.string,
  },
  {
    tag: tag("ElmJsonError"),
    error: Codec.string,
  },
  {
    tag: tag("ClientError"),
    message: Codec.string,
  },
]);

const SuccessfullyCompiledFields = {
  code: Codec.string,
  elmCompiledTimestamp: Codec.number,
  compilationMode: CompilationMode,
  browserUiPosition: BrowserUiPosition,
};

const SuccessfullyCompiled = Codec.fieldsUnion("tag", (tag) => [
  {
    tag: tag("SuccessfullyCompiled"),
    ...SuccessfullyCompiledFields,
  },
]);

export type WebSocketToClientMessage = Codec.Infer<
  typeof WebSocketToClientMessage
>;
export const WebSocketToClientMessage = Codec.fieldsUnion("tag", (tag) => [
  {
    tag: tag("FocusedTabAcknowledged"),
  },
  {
    tag: tag("OpenEditorFailed"),
    error: OpenEditorError,
  },
  {
    tag: tag("StatusChanged"),
    status: StatusChange,
  },
  {
    tag: tag("SuccessfullyCompiled"),
    ...SuccessfullyCompiledFields,
  },
  {
    tag: tag("SuccessfullyCompiledButRecordFieldsChanged"),
  },
]);

export type WebSocketToServerMessage = Codec.Infer<
  typeof WebSocketToServerMessage
>;
export const WebSocketToServerMessage = Codec.fieldsUnion("tag", (tag) => [
  {
    tag: tag("ChangedCompilationMode"),
    compilationMode: CompilationMode,
  },
  {
    tag: tag("ChangedBrowserUiPosition"),
    browserUiPosition: BrowserUiPosition,
  },
  {
    tag: tag("ChangedOpenErrorOverlay"),
    openErrorOverlay: Codec.boolean,
  },
  {
    tag: tag("FocusedTab"),
  },
  {
    tag: tag("PressedOpenEditor"),
    file: AbsolutePath,
    line: Codec.number,
    column: Codec.number,
  },
]);

export function encodeWebSocketToClientMessage(
  message: WebSocketToClientMessage
): string {
  switch (message.tag) {
    // Optimization: Avoid encoding megabytes of JS code as a JSON string.
    // With a large Elm app, `JSON.stringify` + `JSON.parse` can time ~40 ms.
    case "SuccessfullyCompiled": {
      const shortMessage = { ...message, code: "" };
      return `//${Codec.stringify(SuccessfullyCompiled, shortMessage)}\n${
        message.code
      }`;
    }

    default:
      return Codec.stringify(WebSocketToClientMessage, message);
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
    const parsed = SuccessfullyCompiled.decoder(JSON.parse(jsonString));
    return { ...parsed, code: message };
  } else {
    return WebSocketToClientMessage.decoder(JSON.parse(message));
  }
}
