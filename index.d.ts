import type * as http from "http";
import type * as https from "https";
import type * as stream from "stream";

export type NonEmptyArray<T> = [T, ...Array<T>];

export type RunMode = "hot" | "make";

export type CompilationMode = "debug" | "standard" | "optimize";

export type ReadStream = stream.Readable & {
  isTTY: boolean;
  isRaw: boolean;
  setRawMode: (mode: boolean) => void;
};

export type WriteStream = stream.Writable & {
  isTTY: boolean;
  columns?: number;
};

export type CreateServer = (listeners: {
  onRequest: http.RequestListener;
  onUpgrade: (
    req: InstanceType<typeof http.IncomingMessage>,
    socket: stream.Duplex,
    head: Buffer,
  ) => void;
  // `onRequest` and `onUpgrade` only accept requests for allowed hosts (to
  // protect against DNS rebinding attacks). Use this to do the same check in
  // your own request handlers, before for example proxying a request.
  isAllowedHost: (req: InstanceType<typeof http.IncomingMessage>) => boolean;
}) =>
  | ReturnType<typeof http.createServer>
  | ReturnType<typeof https.createServer>;

// Transforms Elm’s JavaScript output. Runs in the same thread as elm-watch, so
// avoid heavy synchronous work (a minifier that runs on its own thread, like
// SWC, is fine). If it throws, the error is shown just like a compilation error.
export type Postprocess = (
  code: string,
  info: {
    compilationMode: CompilationMode;
    runMode: RunMode;
  },
) => string | Promise<string>;

// Opens a file in your editor. `file` is an absolute path. `line` and `column`
// start at 1. If it throws (or rejects), the error is shown in the browser.
export type OpenEditor = (location: {
  file: string;
  line: number;
  column: number;
}) => void | Promise<void>;

export type Target = {
  // Displayed in the terminal UI. Must be unique.
  name: string;
  // `.elm` files, relative to `root`.
  inputs: NonEmptyArray<string>;
  // A `.js` file, relative to `root`.
  output: string;
  postprocess?: Postprocess | undefined;
};

export type Options = {
  runMode: RunMode;

  // In "make" mode: The compilation mode for all targets.
  // In "hot" mode: The compilation mode for targets you haven’t switched to
  // another compilation mode in the browser UI.
  // Default: "standard".
  compilationMode?: CompilationMode | undefined;

  // Absolute path. Relative paths in the options are resolved from here, and
  // elm-watch keeps its state in `elm-stuff/elm-watch/` inside it.
  // Usually: `import.meta.dirname`.
  root: string;

  // At least one target is required. (This is not `NonEmptyArray<Target>`,
  // to make it easy to `.filter()` targets.)
  targets: Array<Target>;

  // Port for the HTTP and WebSocket server.
  // Default: An arbitrary available port, re-using the one from last time if possible.
  port?: number | undefined;

  // The host for the HTTP and WebSocket server to listen on, as in Node.js’
  // `server.listen(port, host)`. Use "0.0.0.0" to expose the server on the
  // local network (to test on your phone, for example).
  // Default: "127.0.0.1" (only your computer).
  host?: string | undefined;

  // A directory of static files to serve, relative to `root`. CSS files in it
  // are hot reloaded.
  staticFilesDir?: string | undefined;

  // A URL starting with `ws:` or `wss:`, for customizing how the browser
  // connects to elm-watch.
  webSocketUrl?: string | undefined;

  // Extra host names that the server accepts requests for.
  allowedHosts?: Array<string> | undefined;

  createServer?: CreateServer | undefined;

  // Called when you click an error location in the browser UI.
  openEditor?: OpenEditor | undefined;

  // Abort to make elm-watch exit (in "hot" mode). Like for SIGTERM, running
  // `elm` processes are allowed to finish first. The promise returned by
  // `elmWatch()` then resolves to 0.
  signal?: AbortSignal | undefined;

  // Defaults to the corresponding `process` things.
  env?: Record<string, string | undefined> | undefined;
  stdin?: ReadStream | undefined;
  stdout?: WriteStream | undefined;
  stderr?: WriteStream | undefined;
};

// Resolves to an exit code.
export declare function elmWatch(options: Options): Promise<number>;
