import type { AllowedHost } from "./AllowedHosts";
import type { NonEmptyArray } from "./NonEmptyArray";
import type { Port } from "./Port";
import type { AbsolutePath, ElmWatchJsonPath } from "./Types";
import type { WebSocketUrl } from "./WebSocketUrl";

// The validated configuration, regardless of where it came from.
export type Config = {
  // Relative paths are resolved from here, and elm-stuff/elm-watch/ lives here.
  root: AbsolutePath;
  elmWatchJsonPath: ElmWatchJsonPath;
  targets: Record<string, Target>;
  postprocess: NonEmptyArray<string> | undefined;
  port: Port | undefined;
  webSocketUrl: WebSocketUrl | undefined;
  serve: string | undefined;
  allowedHosts: Array<AllowedHost>;
};

export type Target = {
  inputs: NonEmptyArray<string>;
  output: string;
};
