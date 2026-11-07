import type { AllowedHost } from "./AllowedHosts";
import type { NonEmptyArray } from "./NonEmptyArray";
import type { Port } from "./Port";
import type {
  AbsolutePath,
  CompilationMode,
  ElmWatchJsonPath,
  RunMode,
} from "./Types";
import type { WebSocketUrl } from "./WebSocketUrl";

// The validated configuration, regardless of where it came from.
export type Config = {
  // Relative paths are resolved from here, and elm-stuff/elm-watch/ lives here.
  root: AbsolutePath;
  source: ConfigSource;
  targets: NonEmptyArray<Target>;
  port: Port | undefined;
  webSocketUrl: WebSocketUrl | undefined;
  staticFilesDir: string | undefined;
  allowedHosts: Array<AllowedHost>;
};

export type ConfigSource =
  | {
      tag: "ElmWatchJson";
      elmWatchJsonPath: ElmWatchJsonPath;
    }
  | {
      tag: "Options";
    };

export type Target = {
  name: string;
  inputs: NonEmptyArray<string>;
  output: string;
  postprocess: PostprocessFunction | undefined;
};

// The return value is validated when the function is called.
export type PostprocessFunction = (
  code: string,
  info: { compilationMode: CompilationMode; runMode: RunMode },
) => unknown;
