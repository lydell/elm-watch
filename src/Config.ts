import type { AllowedHost } from "./AllowedHosts.ts";
import type { Host } from "./Host.ts";
import type { NonEmptyArray } from "./NonEmptyArray.ts";
import type { Port } from "./Port.ts";
import type {
  Cwd,
  AbsolutePath,
  CompilationMode,
  ElmWatchJsonPath,
  RunMode,
} from "./Types.ts";
import type { WebSocketUrl } from "./WebSocketUrl.ts";

// The validated configuration, regardless of where it came from.
export type Config = {
  // Relative paths are resolved from here, and elm-stuff/elm-watch/ lives here.
  root: AbsolutePath;
  source: ConfigSource;
  targets: NonEmptyArray<Target>;
  port: Port | undefined;
  host: Host | undefined;
  webSocketUrl: WebSocketUrl | undefined;
  staticFilesDir: string | undefined;
  allowedHosts: Array<AllowedHost>;
};

export type ConfigSource =
  | {
      tag: "ElmWatchJson";
      elmWatchJsonPath: ElmWatchJsonPath;
      // elm-watch.json was found by looking for it in this directory and up.
      cwd: Cwd;
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
