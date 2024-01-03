import type {
  createServer as createHttpServer,
  IncomingMessage,
  RequestListener,
} from "http";
import type { createServer as createHttpsServer } from "https";
import type { Duplex } from "stream";
import * as Decode from "tiny-decoders";

export type AbsolutePath = ReturnType<typeof AbsolutePath>;
export const AbsolutePath = Decode.fieldsAuto({
  tag: () => "AbsolutePath" as const,
  absolutePath: Decode.string,
});

export type Cwd = { tag: "Cwd"; path: AbsolutePath };

export type RunMode = "hot" | "make";

export type CompilationMode = ReturnType<typeof CompilationMode>;
export const CompilationMode = Decode.stringUnion({
  debug: null,
  standard: null,
  optimize: null,
});

export type CompilationModeWithProxy = CompilationMode | "proxy";

export type BrowserUiPosition = ReturnType<typeof BrowserUiPosition>;
export const BrowserUiPosition = Decode.stringUnion({
  TopLeft: null,
  TopRight: null,
  BottomLeft: null,
  BottomRight: null,
});

// If the user has enabled the simple static file server.
export type StaticFilesDir = {
  tag: "StaticFilesDir";
  theStaticFilesDir: AbsolutePath;
};

// elm-watch.json
export type ElmWatchJsonPath = {
  tag: "ElmWatchJsonPath";
  theElmWatchJsonPath: AbsolutePath;
};

// elm.json
export type ElmJsonPath = {
  tag: "ElmJsonPath";
  theElmJsonPath: AbsolutePath;
};

// elm-stuff/elm-watch/
export type ElmWatchStuffDir = {
  tag: "ElmWatchStuffDir";
  theElmWatchStuffDir: AbsolutePath;
};

// elm-stuff/elm-watch/stuff.json
export type ElmWatchStuffJsonPath = {
  tag: "ElmWatchStuffJsonPath";
  theElmWatchStuffJsonPath: AbsolutePath;
};

// applications: "source-directories": [...]
// packages: src
export type SourceDirectory = {
  tag: "SourceDirectory";
  theSourceDirectory: AbsolutePath;
};

// src/Main.elm
export type InputPath = {
  tag: "InputPath";
  theInputPath: AbsolutePath;
  originalString: string;
  // The Elm compiler even resolves symlinks when looking for duplicate inputs.
  realpath: AbsolutePath;
};

// src/Main.elm, but unchecked
export type UncheckedInputPath = {
  tag: "UncheckedInputPath";
  theUncheckedInputPath: AbsolutePath;
  originalString: string;
};

// build/main.js
export type OutputPath = {
  tag: "OutputPath";
  theOutputPath: AbsolutePath;
  temporaryOutputPath: AbsolutePath;
  originalString: string;
  targetName: string;
};

// "postprocess": ["elm-watch-node", "postprocess.js"]
//                                    ^^^^^^^^^^^^^^
export type ElmWatchNodeScriptPath = {
  tag: "ElmWatchNodeScriptPath";
  // This is a `string` rather than a `URL` to avoid worker serialization stuff.
  theElmWatchNodeScriptFileUrl: string;
};

export type CliArg = {
  tag: "CliArg";
  theArg: string;
};

export type WriteOutputErrorReasonForWriting =
  | "InjectWebSocketClient"
  | "Postprocess";

export type GetNow = () => Date;

export type CreateServer = (listeners: {
  onRequest: RequestListener;
  onUpgrade: (
    req: InstanceType<typeof IncomingMessage>,
    socket: Duplex,
    head: Buffer
  ) => void;
}) =>
  | ReturnType<typeof createHttpServer>
  | ReturnType<typeof createHttpsServer>;

export function equalsInputPath(
  elmFile: AbsolutePath,
  inputPath: InputPath
): boolean {
  return (
    inputPath.theInputPath.absolutePath === elmFile.absolutePath ||
    inputPath.realpath.absolutePath === elmFile.absolutePath
  );
}
